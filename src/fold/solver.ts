/** 小规模约束求解：自动折痕角度未知，以非树折痕共享边两端闭合误差为残差，
 *  使用 Levenberg–Marquardt（阻尼最小二乘）求解，前向差分提供雅可比。
 *  残差规模通常只有 1~2 个闭合点对，故由 mathjs 直接做稠密线性代数。 */

import { lusolve, squeeze, type Matrix } from 'mathjs';
import type { FoldGraph } from './types';
import { propagate } from './fold';

export interface SolveOptions {
  /** 起始猜测（有向角），不提供时用 crease.angle 推断 */
  initial?: number[];
  maxIter?: number;
  tol?: number;
}

export interface SolveResult {
  converged: boolean;
  angles: number[];
  residual: number;
  iterations: number;
}

/** 一次完整求解。signedAngles 为全部边的有向角初值；autoEdges 为待求边索引。 */
export function solveAutoAngles(
  graph: FoldGraph,
  signedAngles: number[],
  autoEdges: number[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter = options.maxIter ?? 60;
  const tol = options.tol ?? 5e-4;

  if (autoEdges.length === 0) {
    const base = propagate(graph, signedAngles);
    const residual = maxGap(base.closureGaps);
    return { converged: residual <= tol, angles: signedAngles.slice(), residual, iterations: 0 };
  }

  // 收集闭合约束：每个非树折痕边两个端点，每端 3 个坐标差
  const probe = propagate(graph, signedAngles);
  const closureEdges = probe.closureGaps.map((g) => g.edge);
  if (closureEdges.length === 0) {
    // 没有回边可约束（例如结构是树）——自动角无意义，按给定值直接返回
    return { converged: true, angles: signedAngles.slice(), residual: 0, iterations: 0 };
  }

  const x0 = autoEdges.map((e, i) =>
    options.initial ? options.initial[i] : signedAngles[e],
  );

  const evaluate = (x: number[]): number[] => {
    const angles = signedAngles.slice();
    autoEdges.forEach((e, i) => {
      angles[e] = x[i];
    });
    const res = propagate(graph, angles);
    return closureResiduals(graph, res, closureEdges);
  };

  let x = x0.slice();
  let r = evaluate(x);
  let residualNorm = norm(r);
  let lambda = 1e-3;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    if (residualNorm <= tol) break;

    // 前向差分雅可比 (m × n)
    const n = x.length;
    const eps = 1e-5;
    const J: number[][] = Array.from({ length: r.length }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const xp = x.slice();
      xp[j] += eps;
      const rp = evaluate(xp);
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / eps;
    }

    // JtJ + λ diag(JtJ), 右端 Jᵀr
    const Jt = transpose(J);
    const JtJ = matMul(Jt, J);
    const Jtr = matVec(Jt, r);
    const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * Math.max(v, 1e-6) : v)));

    let step: number[] | null = null;
    try {
      const sol = lusolve(A as unknown as Matrix, Jtr);
      const arr = squeeze(sol) as unknown as number | number[];
      step = (Array.isArray(arr) ? arr : [arr]) as number[];
    } catch {
      step = null;
    }

    if (step && step.every((v) => Number.isFinite(v))) {
      // 限制单步步长，避免越过 π 造成翻转震荡
      const maxStep = Math.max(...step.map(Math.abs), 0);
      const scale = maxStep > 0.5 ? 0.5 / maxStep : 1;
      const xNew = x.map((v, i) => clamp(v - step[i] * scale, -Math.PI + 1e-3, Math.PI - 1e-3));
      const rNew = evaluate(xNew);
      const newNorm = norm(rNew);
      if (newNorm < residualNorm) {
        x = xNew;
        r = rNew;
        residualNorm = newNorm;
        lambda = Math.max(lambda / 3, 1e-9);
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
  };
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
