/** 小规模约束求解：自动折痕角度未知，以非树、非自动折痕共享边两端闭合误差为残差，
 *  使用 Levenberg–Marquardt（阻尼最小二乘）求解，前向差分提供雅可比。
 *  自动边被生成树优先放在闭环位置（见 fold.ts），其角度不参与传播而由残差反解；
 *  运动延续时传入上一可靠步的解作为热启动，从而跟踪同一运动分支。 */

import { lusolve, squeeze, type Matrix } from 'mathjs';
import type { FoldGraph } from './types';
import { isTraversable, propagate } from './fold';

/** 自动边允许的有向角范围：山折 M ≥ 0、谷折 V ≤ 0，F/U 不限。 */
export function boundsForEdge(graph: FoldGraph, e: number): [number, number] {
  const lim = Math.PI - 1e-3;
  switch (graph.creases[e].assignment) {
    case 'M': return [0, lim];
    case 'V': return [-lim, 0];
    default: return [-lim, lim];
  }
}

/** 全工具统一的“约束已闭合/收敛”容差（闭环裂缝的最大尺度）。
 *  延续接受步与 evaluateConfiguration 的收敛判定必须使用同一阈值，
 *  否则会出现“路径到达目标、页面却报未收敛”。 */
export const CLOSURE_TOLERANCE = 2.5e-3;

export interface SolveOptions {
  /** 未知量（自动边）的起始猜测；延续求解时传上一步的解 */
  initial?: number[];
  maxIter?: number;
  tol?: number;
  /** 只做很少迭代的收紧步（延续中使用） */
  fast?: boolean;
  /** 软正则：把未知量拉向 nominal（对应延拓的预测值），用于欠约束机构
   *  选择最小范数分支、抑制零空间内的数值跳变。 */
  nominal?: number[];
  regWeight?: number;
}

export interface SolveResult {
  converged: boolean;
  angles: number[];
  residual: number;
  iterations: number;
  /** 实际参与残差的闭环边索引 */
  closureEdges: number[];
}

/** 一次完整求解。signedAngles 为全部边的有向角初值；autoEdges 为待求边索引。 */
export function solveAutoAngles(
  graph: FoldGraph,
  signedAngles: number[],
  autoEdges: number[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter = options.maxIter ?? (options.fast ? 20 : 60);
  const tol = options.tol ?? 5e-4;

  // 初始未知量（来自热启动或当前折痕角），残差与闭环边均以“未知量填入后、
  // 全部折痕上树”的传播为准，这样自动角落在闭环边时也有正确的几何反馈。
  let x = autoEdges.map((e, i) => {
    const raw = options.initial ? options.initial[i] : signedAngles[e];
    const [lo, hi] = boundsForEdge(graph, e);
    return Math.min(hi, Math.max(lo, raw));
  });
  const bounds = autoEdges.map((e) => boundsForEdge(graph, e));

  const fillAngles = (unknowns: number[]): number[] => {
    const angles = signedAngles.slice();
    autoEdges.forEach((e, i) => {
      angles[e] = unknowns[i];
    });
    return angles;
  };

  const closureEdges = propagate(graph, fillAngles(x))
    .closureGaps.map((g) => g.edge)
    .filter((e) => isTraversable(graph.creases[e].assignment));

  if (autoEdges.length === 0 || closureEdges.length === 0) {
    // 无未知量，或没有闭环可约束（纯树结构）：用全部折痕树评估闭合质量
    const base = propagate(graph, signedAngles);
    const residual = maxGap(base.closureGaps);
    return {
      converged: residual <= tol,
      angles: signedAngles.slice(),
      residual,
      iterations: 0,
      closureEdges: base.closureGaps.map((g) => g.edge),
    };
  }

  const regWeight = options.regWeight ?? 0;
  const nominal = options.nominal ?? x.slice();

  /** 完整最小二乘残差：几何闭合 + 零空间正则（拉向名义预测值）。 */
  const evaluate = (unknowns: number[]): number[] => {
    const res = propagate(graph, fillAngles(unknowns));
    const closure = closureResiduals(graph, res, closureEdges);
    if (regWeight > 0) {
      for (let i = 0; i < unknowns.length; i++) {
        closure.push(regWeight * (unknowns[i] - nominal[i]));
      }
    }
    return closure;
  };

  /** 只含几何闭合残差的范数，用于收敛判定与对外报告。 */
  const closureNorm = (unknowns: number[]): number => {
    const res = propagate(graph, fillAngles(unknowns));
    return norm(closureResiduals(graph, res, closureEdges));
  };

  let r = evaluate(x);
  let residualNorm = closureNorm(x);
  let lambda = 1e-3;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    if (residualNorm <= tol) break;    // 前向差分雅可比 (m × n)
    const n = x.length;
    const eps = 1e-5;
    const J: number[][] = Array.from({ length: r.length }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] += eps;
      const rp = evaluate(xp);
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / eps;
    }

    // JtJ + λ diag(JtJ), 右端 Jᵀr；近奇异时加大对角阻尼以保持数值稳定
    const Jt = transpose(J);
    const JtJ = matMul(Jt, J);
    const Jtr = matVec(Jt, r);
    const A = JtJ.map((row, i) =>
      row.map((v, j) => (i === j ? v + lambda * Math.max(v, 1e-4) : v)),
    );

    let step: number[] | null = null;
    try {
      const sol = lusolve(A as unknown as Matrix, Jtr);
      const arr = squeeze(sol) as unknown as number | number[];
      step = (Array.isArray(arr) ? arr : [arr]) as number[];
    } catch {
      step = null;
    }

    if (step && step.every((v) => Number.isFinite(v))) {
      // 限制单步步长，避免越过 π 或在近共面处分叉跳变；同时投影到 M/V 符号边界
      const maxStep = Math.max(...step.map(Math.abs), 0);
      const scale = maxStep > 0.35 ? 0.35 / maxStep : 1;
      const xNew = x.map((v, i) => {
        const cand = v - step[i] * scale;
        return Math.min(bounds[i][1], Math.max(bounds[i][0], cand));
      });
      const rNew = evaluate(xNew);
      const newNorm = norm(rNew); // 含正则的总残差，决定 LM 接受/退避
      const newClosure = closureNorm(xNew);
      if (newNorm < norm(r)) {
        x = xNew;
        r = rNew;
        residualNorm = newClosure;
        lambda = Math.max(lambda / 3, 1e-9);
        if (newClosure <= tol) break;
        continue;
      }
    }
    lambda *= 4;
    if (lambda > 1e8) break;
  }

  const angles = signedAngles.slice();
  autoEdges.forEach((e, i) => {
    angles[e] = x[i];
  });
  return {
    converged: residualNorm <= tol,
    angles,
    residual: residualNorm,
    iterations: iter,
    closureEdges,
  };
}

/** 供延续引擎调用：给定未知量初值快速收紧，返回是否接受该步。 */
export function solveStep(
  graph: FoldGraph,
  signedAngles: number[],
  autoEdges: number[],
  warmX: number[],
  tol = 5e-4,
): SolveResult {
  return solveAutoAngles(graph, signedAngles, autoEdges, {
    initial: warmX,
    fast: true,
    tol,
  });
}

function closureResiduals(
  graph: FoldGraph,
  res: ReturnType<typeof propagate>,
  closureEdges: number[],
): number[] {
  const out: number[] = [];
  for (const e of closureEdges) {
    const [fa, fb] = graph.edgesFaces[e] as [number, number];
    if (res.roots[fa] !== res.roots[fb]) continue;
    for (const v of graph.edgesVertices[e]) {
      const p = graph.vertices[v];
      const wa = applyLocal(res.transforms[fa], p);
      const wb = applyLocal(res.transforms[fb], p);
      out.push(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]);
    }
  }
  return out;
}

function applyLocal(m: number[], p: [number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[14],
  ];
}

function maxGap(gaps: { gap: number }[]): number {
  return gaps.reduce((m, g) => Math.max(m, g.gap), 0);
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  return m[0].map((_, j) => m.map((row) => row[j]));
}

function matMul(a: number[][], b: number[][]): number[][] {
  return a.map((row) =>
    b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)),
  );
}

function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
}
