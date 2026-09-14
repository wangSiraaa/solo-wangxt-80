/** 运动路径延续（continuation / path-following）。
 *
 *  多顶点联动时同一目标折角可能对应多条运动分支，直接一步求解会跳到另一分支，
 *  表现为面片突然翻面甚至穿过其他面。本模块从平展构型出发，沿“延续参数”小步
 *  推进，每一步以上一可靠步为热启动求解自动角，只有闭合、无穿透且折角变化受控
 *  时才接受；失去可行解则停在最后可靠位置，绝不展示跳变终态。
 *
 *  路径只生成折角构型（signedAngles + autoEdges），工程源折痕不被修改。
 */

import type { FoldConfiguration, FoldGraph, FoldResult } from './types';
import { isTraversable } from './fold';
import { evaluateConfiguration } from './engine';
import { solveAutoAngles, CLOSURE_TOLERANCE, boundsForEdge } from './solver';
import { propagate } from './fold';

export type StopReason =
  | 'reached-target'
  | 'infeasible'
  | 'self-intersection'
  | 'max-steps'
  | 'cancelled';

export interface MotionStep {
  /** 0（平展）→ 1（目标）的延续参数 */
  t: number;
  config: FoldConfiguration;
  /** 自动角求解残差（闭环裂缝的尺度） */
  residual: number;
  iterations: number;
  result: FoldResult;
  /** 本步相对上一步的最大折角变化（弧度） */
  maxDelta: number;
  accepted: boolean;
  /** 暂停时的原因（路径在此之前的最后一步仍可靠） */
  stop?: StopReason;
}

export interface MotionPath {
  id: string;
  label: string;
  /** 分支选择种子：自动边初值的偏置（0 表示平展附近的自然分支） */
  branchSeed: number[];
  /** 稳定分支身份：归一化的“离场方向签名”，同一目标下不同签名即不同运动分支 */
  branchId: string;
  /** 人类可读的离场方向（哪些折痕先动），用于页面区分两条路径 */
  branchSignature: string[];
  /** 目标构型（用户固定角 + 自动角集合） */
  target: FoldConfiguration;
  /** 平展构型（t=0） */
  flat: FoldConfiguration;
  steps: MotionStep[];
  stopReason: StopReason;
  createdAt: number;
  /** 关键帧在 steps 中的下标 */
  keyframes: number[];
  /** 用户标注的关键帧信息（与 steps 下标对应） */
  keyframeMeta: { step: number; label: string; t: number }[];
  /** 延续接受步使用的闭合容差，与诊断面板共用同一阈值 */
  closureTolerance: number;
  /** 重放指纹：最终构型角度序列，重载后用于校验形态一致 */
  fingerprint: string;
}

export interface BranchChoice {
  /** 自动边未知量的离场值（弧度） */
  x: number[];
  /** 该候选的几何残差（最大闭环裂缝） */
  residual: number;
  /** 归一化离场方向（用于稳定签名与 seed 匹配） */
  direction: number[];
}

export interface ContinuationOptions {
  branchSeed?: number[];
  maxStepAngle?: number;
  initialTau?: number;
  minTau?: number;
  maxSteps?: number;
  contactTolScale?: number;
  label?: string;
  /** 周期性调用；返回 true 表示用户取消 */
  shouldCancel?: () => boolean;
  yieldEvery?: number;
  onStep?: (step: MotionStep) => void;
}

const DEFAULT_MAX_STEP_ANGLE = 0.18; // 每步折角最多约 10°
const DEFAULT_TAU = 0.05;
const DEFAULT_MIN_TAU = 1e-3;
/** 延续接受步的几何闭合容差，与求解器/诊断统一。 */
const CLOSURE_TOL = CLOSURE_TOLERANCE;

export function flatConfiguration(graph: FoldGraph): FoldConfiguration {
  return {
    signedAngles: graph.creases.map(() => 0),
    autoEdges: graph.creases
      .map((c, e) => ({ c, e }))
      .filter(({ c, e }) => isTraversable(c.assignment) && graph.edgesFaces[e].length === 2)
      .map(({ e }) => e),
  };
}

/** 构造 t 时刻的引导构型：固定边（非自动）从平展线性插值到目标；
 *  自动角边的角度仅占位，求解器以 warm 热启动覆盖。 */
function guideConfiguration(
  target: FoldConfiguration,
  t: number,
): FoldConfiguration {
  const autoSet = new Set(target.autoEdges);
  return {
    signedAngles: target.signedAngles.map((goal, e) =>
      autoSet.has(e) ? 0 : goal * t,
    ),
    autoEdges: target.autoEdges.slice(),
  };
}

function maxAngleDelta(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** 求解出的自动角是否与该折痕的山/谷指派符号一致（允许近平展的微小跨越）。 */
function signConforms(graph: FoldGraph, edge: number, signedAngle: number, eps = 1e-3): boolean {
  const a = graph.creases[edge].assignment;
  if (a === 'M') return signedAngle >= -eps;
  if (a === 'V') return signedAngle <= eps;
  return true;
}

/** 给定完整角度数组的最大闭环裂缝（纯几何，不含正则）。 */
function propagateForResidual(graph: FoldGraph, angles: number[]): number[] {
  return propagate(graph, angles).closureGaps.map((g) => g.gap);
}

/** 向量归一化（零向量保持零）。 */
function unit(v: number[]): number[] {
  const len = Math.hypot(...v) || 1;
  return v.map((x) => x / len);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

/** 离场方向的稳定签名：按贡献最大的若干自动边方向离散化，与具体幅值无关。
 *  恒返回非空字符串（哪怕所有自动角都很小，也记录占优的折痕方向）。 */
function directionSignature(graph: FoldGraph, edges: number[], x: number[]): string {
  const entries = x
    .map((v, i) => ({ e: edges[i], v, i }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const active = entries.filter((d) => Math.abs(d.v) > 0.02);
  const chosen = active.length > 0 ? active.slice(0, 4) : entries.slice(0, 2);
  return chosen
    .map((d) => `${graph.creases[d.e].assignment}${d.e}${d.v >= 0 ? '+' : '-'}`)
    .join('/');
}

/** 不可行分支（在该山/谷符号下没有平滑解）的身份：记录用户通过 seed 请求的离场方向。 */
function requestedSignature(graph: FoldGraph, edges: number[], seed: number[]): string {
  const entries = seed
    .map((v, i) => ({ e: edges[i], v, i }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const active = entries.filter((d) => Math.abs(d.v) > 1e-9);
  const chosen = active.length > 0 ? active.slice(0, 4) : entries.slice(0, 2);
  return (
    '不可行:' +
    chosen
      .map((d) => `${graph.creases[d.e].assignment}${d.e}${d.v >= 0 ? '+' : '-'}`)
      .join('/')
  );
}

/** 人类可读的离场描述。 */
function describeSignature(graph: FoldGraph, edges: number[], x: number[]): string[] {
  return x
    .map((v, i) => ({ e: edges[i], v, a: graph.creases[edges[i]].assignment }))
    .filter((d) => Math.abs(d.v) > 0.05)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .map((d) => `#${d.e}${d.a}${(d.v * 180 / Math.PI) >= 0 ? '+' : '−'}`);
}

/**
 * 平展分岔点的分支探测：
 * 1) 在小 t 引导下，从多组小角度初值（含 seed 指定方向）求解；
 * 2) 只保留“所有自动边都小角度、平滑离开平展”的可行候选；
 * 3) 按离场方向聚类去重；
 * 4) 用与 seed 的方向一致性选支（seed=0 时取角度范数最小的自然支），
 *    绝不再被某个残差极小的大角度“伪闭合”解覆盖。
 */
function detectBranch(
  graph: FoldGraph,
  target: FoldConfiguration,
  guideAngles: number[],
  seed: number[],
): { x: number[]; direction: number[]; signature: string; description: string[]; feasible: boolean } {
  const auto = target.autoEdges;
  const SMOOTH_LIMIT = 0.22; // 离场步自动边最大约 12.6°，超出视为翻转/非连续支
  const signDir = auto.map((e) => (graph.creases[e].assignment === 'V' ? -1 : 1));
  const seedActive = seed.some((v) => Math.abs(v) > 1e-9);

  // 候选初值：沿各折痕山/谷符号的小角度，外加单折痕主导方向与 seed
  const trials: number[][] = [];
  const push = (v: number[]) => {
    if (v.every(Number.isFinite) && !trials.some((t) => Math.max(...t.map((x, i) => Math.abs(x - v[i]))) < 1e-6)) {
      trials.push(v);
    }
  };
  push(signDir.map((s) => s * 0.04));
  push(signDir.map((s) => s * 0.1));
  auto.forEach((_, k) => {
    push(signDir.map((s, i) => (i === k ? s * 0.12 : s * 0.02)));
  });
  if (seed.some((v) => Math.abs(v) > 1e-9)) {
    // seed 分量已带符号，归一到小角度幅度
    const maxAbs = Math.max(...seed.map(Math.abs), 1e-9);
    push(seed.map((v) => (v / maxAbs) * 0.12));
    push(seed.map((v) => (v / maxAbs) * 0.04));
  }

  const choices: BranchChoice[] = [];
  for (const init of trials) {
    const r = solveAutoAngles(graph, guideAngles, auto, {
      initial: init,
      nominal: signDir.map((s) => s * 0.03),
      regWeight: 0.12,
      fast: true,
      maxIter: 40,
      tol: CLOSURE_TOL * 0.4,
    });
    const x = auto.map((e) => {
      const v = r.angles[e];
      const [lo, hi] = boundsForEdge(graph, e);
      return Math.min(hi, Math.max(lo, v));
    });
    const geomRes = Math.max(r.residual, ...propagateForResidual(graph, r.angles));
    const smooth = x.every((v) => Math.abs(v) <= SMOOTH_LIMIT);
    const signOk = auto.every((e, i) => {
      const v = x[i];
      const a = graph.creases[e].assignment;
      if (a === 'M') return v >= -1e-3;
      if (a === 'V') return v <= 1e-3;
      return true;
    });
    if (geomRes > CLOSURE_TOL || !smooth || !signOk) continue;
    choices.push({ x, residual: geomRes, direction: unit(x.map(Math.abs)) });
  }

  // 无平滑可行候选：标记不可行，身份记录用户通过 seed 请求的离场方向（非空）
  if (choices.length === 0) {
    const fallback = signDir.map((s, i) => s * (Math.abs(seed[i] ?? 0) > 1e-9 ? 0.02 : 0.001));
    return {
      x: fallback,
      direction: unit(fallback.map(Math.abs)),
      signature: requestedSignature(graph, auto, seedActive ? seed : fallback),
      description: seedActive
        ? auto
            .map((e, i) => ({ e, a: graph.creases[e].assignment, v: seed[i] ?? 0 }))
            .filter((d) => Math.abs(d.v) > 1e-9)
            .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
            .map((d) => `#${d.e}${d.a}请求`)
        : describeSignature(graph, auto, fallback),
      feasible: false,
    };
  }

  // 按离场方向聚类（余弦相似 + 角度接近）
  const clusters: BranchChoice[] = [];
  for (const c of choices) {
    let ci = clusters.findIndex(
      (rep) =>
        Math.abs(dot(rep.direction, c.direction)) > 0.94 &&
        Math.max(...rep.x.map((v, i) => Math.abs(v - c.x[i]))) < 0.06,
    );
    if (ci < 0) clusters.push(c);
    else if (c.residual < clusters[ci].residual) clusters[ci] = c;
  }

  // 选支：seed 非零 -> 只在与 seed 方向足够一致的簇中选择；
  // 若没有任何簇满足方向阈值，说明所请求的分支在该符号指派下不是平滑支，标记不可行。
  let picked: BranchChoice | null = null;
  if (seedActive) {
    // 自动角的可行符号已由山/谷边界固定，这里用 |seed| 的方向决定“哪些折痕先动”。
    // 除余弦对齐外，还要求主导折痕（贡献最大分量）一致，避免小分量投影造成的误配。
    const seedDirection = unit(seed.map(Math.abs));
    const seedLead = new Set(
      seedDirection
        .map((v, i) => ({ v, i }))
        .filter((d) => d.v > 0.55)
        .map((d) => d.i),
    );
    const aligned = clusters
      .map((c) => {
        const leadIdx = c.direction.reduce((mi, v, i) => (v > c.direction[mi] ? i : mi), 0);
        return {
          c,
          score: dot(c.direction, seedDirection),
          leadMatch: seedLead.has(leadIdx),
        };
      })
      .filter((d) => d.score > 0.55 && d.leadMatch)
      .sort((a, b) => b.score - a.score || a.c.residual - b.c.residual);
    picked = aligned[0]?.c ?? null;
  } else {
    picked = clusters
      .map((c) => ({ c, norm: Math.hypot(...c.x) }))
      .sort((a, b) => a.norm - b.norm || a.c.residual - b.c.residual)[0].c;
  }

  if (!picked) {
    const fallback = signDir.map((s, i) => s * (Math.abs(seed[i] ?? 0) > 1e-9 ? 0.02 : 0.001));
    return {
      x: fallback,
      direction: unit(fallback.map(Math.abs)),
      signature: requestedSignature(graph, auto, seedActive ? seed : fallback),
      description: seedActive
        ? auto
            .map((e, i) => ({ e, a: graph.creases[e].assignment, v: seed[i] ?? 0 }))
            .filter((d) => Math.abs(d.v) > 1e-9)
            .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
            .map((d) => `#${d.e}${d.a}请求`)
        : describeSignature(graph, auto, fallback),
      feasible: false,
    };
  }

  return {
    x: picked.x,
    direction: picked.direction,
    signature: directionSignature(graph, auto, picked.x),
    description: describeSignature(graph, auto, picked.x),
    feasible: true,
  };
}

/** 单分支延续。返回完整路径（含每一步快照，便于逐帧回放与比较）。 */
export async function runContinuation(
  graph: FoldGraph,
  target: FoldConfiguration,
  options: ContinuationOptions = {},
): Promise<MotionPath> {
  const maxStepAngle = options.maxStepAngle ?? DEFAULT_MAX_STEP_ANGLE;
  let tau = options.initialTau ?? DEFAULT_TAU;
  const minTau = options.minTau ?? DEFAULT_MIN_TAU;
  const maxSteps = options.maxSteps ?? 400;
  const seed = options.branchSeed ?? target.autoEdges.map(() => 0);

  const flat = flatConfiguration(graph);
  const steps: MotionStep[] = [];

  const flatResult = evaluateConfiguration(graph, flat);
  steps.push({
    t: 0,
    config: flat,
    residual: 0,
    iterations: 0,
    result: flatResult,
    maxDelta: 0,
    accepted: true,
  });

  let t = 0;
  let lastAngles = flat.signedAngles.slice();
  let stopReason: StopReason = 'max-steps';
  let failStreak = 0;
  let branchId = 'flat';
  let branchSignature: string[] = [];
  let warmX: number[] = target.autoEdges.map(() => 0);

  // 平展分岔点：在离开平展前只做一次分支探测，按 seed/连续性选支而非全局最小残差。
  // 若请求的分支在当前山/谷符号下没有平滑可行解，直接停在平展（最后可靠位置）。
  if (target.autoEdges.length > 0) {
    const firstGuide = guideConfiguration(target, Math.min(tau, 1));
    const choice = detectBranch(graph, target, firstGuide.signedAngles, seed);
    branchId = choice.signature;
    branchSignature = choice.description;
    warmX = choice.x;
    if (!choice.feasible) {
      stopReason = 'infeasible';
      return finalizePath();
    }
  }

  function finalizePath(): MotionPath {
    const finalStep = steps[steps.length - 1];
    return {
      id: `path_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      label: options.label ?? '路径',
      branchSeed: seed.slice(),
      branchId,
      branchSignature,
      target,
      flat,
      steps,
      stopReason,
      createdAt: Date.now(),
      keyframes: [],
      keyframeMeta: [],
      closureTolerance: CLOSURE_TOL,
      fingerprint: fingerprint(finalStep.config),
    };
  }

  while (steps.length <= maxSteps) {
    if (options.shouldCancel?.()) {
      stopReason = 'cancelled';
      break;
    }
    if (t >= 1 - 1e-9) {
      stopReason = 'reached-target';
      break;
    }

    // 自适应步长：先按角度预算估算 tau，再二分直到满足残差/穿透/角度增量
    let accepted: MotionStep | null = null;
    let triedTau = Math.min(tau, 1 - t);
    let rejectedReason: StopReason | null = null;

    while (triedTau >= minTau) {
      const tTry = Math.min(1, t + triedTau);
      const guide = guideConfiguration(target, tTry);
      // 以上一可靠步的自动角解为热启动，并用软正则把零空间自由度拉回预测值，
      // 使欠约束机构沿同一分支平滑延续，而不是数值上跳到其它装配模。
      const solved = solveAutoAngles(graph, guide.signedAngles, target.autoEdges, {
        initial: warmX,
        nominal: warmX,
        regWeight: 0.08,
        fast: true,
        tol: CLOSURE_TOL,
        maxIter: 24,
      });
      const config: FoldConfiguration = {
        signedAngles: solved.angles,
        autoEdges: target.autoEdges.slice(),
      };
      // 诊断与延续接受步使用同一闭合容差：到达目标时不会再报“未收敛”
      const result = evaluateConfiguration(graph, config, {
        converged: solved.residual <= CLOSURE_TOL,
        solveResidual: solved.residual,
        iterations: solved.iterations,
      });
      const delta = maxAngleDelta(lastAngles, config.signedAngles);
      const penetrates = result.intersections.length > 0;
      const maxGap = result.residual;
      const signOk = target.autoEdges.every((e) => signConforms(graph, e, config.signedAngles[e]));
      // 与已选分支保持连续：自动角解相对热启动的偏移不得超出单步角度预算
      const branchDrift = maxAngleDelta(
        warmX,
        target.autoEdges.map((e) => config.signedAngles[e]),
      );
      const geometricallyClosed = maxGap <= CLOSURE_TOL;
      const feasible =
        geometricallyClosed &&
        !penetrates &&
        signOk &&
        delta <= maxStepAngle + 1e-6 &&
        branchDrift <= maxStepAngle * 1.5 + 1e-6;

      const candidate: MotionStep = {
        t: tTry,
        config,
        residual: Math.max(solved.residual, maxGap),
        iterations: solved.iterations,
        result,
        maxDelta: delta,
        accepted: feasible,
      };

      if (feasible) {
        accepted = candidate;
        break;
      }
      rejectedReason = penetrates ? 'self-intersection' : 'infeasible';
      triedTau *= 0.5;
    }

    if (!accepted) {
      failStreak++;
      if (failStreak >= 2 || Math.min(tau, 1 - t) < minTau * 2) {
        stopReason = rejectedReason ?? 'infeasible';
        break;
      }
      tau = Math.max(tau * 0.5, minTau);
      continue;
    }

    failStreak = 0;
    steps.push(accepted);
    t = accepted.t;
    lastAngles = accepted.config.signedAngles.slice();
    warmX = target.autoEdges.map((e) => accepted!.config.signedAngles[e]);
    // 连续成功时略微放大步长
    tau = Math.min(0.12, triedTau * 1.2);
    options.onStep?.(accepted);
    if (options.yieldEvery && steps.length % options.yieldEvery === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return finalizePath();
}

export function fingerprint(config: FoldConfiguration): string {
  return config.signedAngles.map((a) => a.toFixed(6)).join('|');
}

/** 从已保存路径重放：逐步应用保存的构型（几何是确定性的），并校验最终指纹一致。 */
export function replayPath(graph: FoldGraph, path: MotionPath): {
  steps: MotionStep[];
  consistent: boolean;
} {
  const steps = path.steps.map((s) => ({
    ...s,
    result: evaluateConfiguration(graph, s.config),
  }));
  const final = steps[steps.length - 1];
  return {
    steps,
    consistent: fingerprint(final.config) === path.fingerprint,
  };
}

/** 路径序列化（随工程保存；不保存每步的完整 FoldResult，重载后用确定性几何重放）。 */
export interface SerializedPath {
  id: string;
  label: string;
  branchSeed: number[];
  branchId: string;
  branchSignature: string[];
  target: FoldConfiguration;
  stopReason: StopReason;
  createdAt: number;
  keyframes: number[];
  keyframeMeta: { step: number; label: string; t: number }[];
  closureTolerance: number;
  fingerprint: string;
  steps: {
    t: number;
    signedAngles: number[];
    residual: number;
    iterations: number;
    maxDelta: number;
  }[];
}

export function serializePath(path: MotionPath): SerializedPath {
  return {
    id: path.id,
    label: path.label,
    branchSeed: path.branchSeed,
    branchId: path.branchId,
    branchSignature: path.branchSignature.slice(),
    target: path.target,
    stopReason: path.stopReason,
    createdAt: path.createdAt,
    keyframes: path.keyframes.slice(),
    keyframeMeta: path.keyframeMeta.map((k) => ({ ...k })),
    closureTolerance: path.closureTolerance,
    fingerprint: path.fingerprint,
    steps: path.steps.map((s) => ({
      t: s.t,
      signedAngles: s.config.signedAngles.map((a) => Number(a.toFixed(8))),
      residual: s.residual,
      iterations: s.iterations,
      maxDelta: s.maxDelta,
    })),
  };
}

export function deserializePath(data: SerializedPath, graph: FoldGraph): MotionPath {
  const flat = flatConfiguration(graph);
  const tol = data.closureTolerance ?? CLOSURE_TOL;
  const steps: MotionStep[] = data.steps.map((s) => {
    const config: FoldConfiguration = {
      signedAngles: s.signedAngles,
      autoEdges: data.target.autoEdges.slice(),
    };
    // 重放时用同一容差重新判定收敛，保证页面诊断与保存时一致
    const closed = s.residual <= tol;
    return {
      t: s.t,
      config,
      residual: s.residual,
      iterations: s.iterations,
      result: evaluateConfiguration(graph, config, {
        converged: closed,
        solveResidual: s.residual,
      }),
      maxDelta: s.maxDelta,
      accepted: true,
    };
  });
  return {
    id: data.id,
    label: data.label,
    branchSeed: data.branchSeed,
    branchId: data.branchId ?? '',
    branchSignature: data.branchSignature ?? [],
    target: data.target,
    flat,
    steps,
    stopReason: data.stopReason,
    createdAt: data.createdAt,
    keyframes: data.keyframes.slice(),
    keyframeMeta: data.keyframeMeta.map((k) => ({ ...k })),
    closureTolerance: tol,
    fingerprint: data.fingerprint,
  };
}

/** 为当前选中的折痕集合构造目标构型：固定边取指定/当前角度，其余内部折痕自动。
 *  边界 B 边既不是铰链也不是未知量。 */
export function buildTarget(
  graph: FoldGraph,
  fixedEdges: number[],
  goalAnglesDeg?: Record<number, number>,
): FoldConfiguration {
  const fixedSet = new Set(fixedEdges);
  const signedAngles = graph.creases.map((c, e) => {
    if (!fixedSet.has(e)) return 0;
    const deg = goalAnglesDeg?.[e];
    const mag = deg === undefined ? c.angle : (deg * Math.PI) / 180;
    return c.assignment === 'V' ? -mag : mag;
  });
  const autoEdges = graph.creases
    .map((c, e) => ({ c, e }))
    .filter(
      ({ c, e }) =>
        !fixedSet.has(e) &&
        isTraversable(c.assignment) &&
        graph.edgesFaces[e].length === 2,
    )
    .map(({ e }) => e);
  return { signedAngles, autoEdges };
}
