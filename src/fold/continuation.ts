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
import { solveAutoAngles } from './solver';
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
  /** 重放指纹：最终构型角度序列，重载后用于校验形态一致 */
  fingerprint: string;
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
/** 延续接受步的几何闭合容差：比静态求解容差更严，防止不相容构型（如违反川崎）
 *  在较松的残差下被一步步“滑过去”。 */
const CLOSURE_TOL = 2.5e-3;

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
  let warmX = target.autoEdges.map((_, i) => seed[i] ?? 0);
  let stopReason: StopReason = 'max-steps';
  let failStreak = 0;
  let initialized = false;

  /** 平展态是构型空间的分岔奇点（残差关于角度的梯度在原点为 0），
   *  单起点 LM 无法离开平展。这里在符号允许范围内用多组初值做一次分支探测，
   *  选出残差最小的方向作为本路径跟踪的运动分支。 */
  const detectBranch = (guideAngles: number[]): number[] => {
    const patterns: number[][] = [];
    // 各自动边沿自身山/谷符号的小角度；再覆盖几组一致大幅值初值
    const small = target.autoEdges.map((e) =>
      graph.creases[e].assignment === 'V' ? -0.05 : 0.05,
    );
    patterns.push(small);
    patterns.push(small.map((v) => v * 4));
    for (const amp of [0.4, 1.2, 2.4]) {
      patterns.push(
        target.autoEdges.map((e) =>
          graph.creases[e].assignment === 'V' ? -amp : amp,
        ),
      );
    }
    if (seed.some((v) => v !== 0)) {
      patterns.push(seed.slice());
      patterns.push(seed.map((v) => (v < 0 ? -0.3 : 0.3) * Math.sign(v || 1)));
    }
    let best: { x: number[]; res: number } = { x: warmX.slice(), res: Infinity };
    for (const p of patterns) {
      const r = solveAutoAngles(graph, guideAngles, target.autoEdges, {
        initial: p,
        nominal: target.autoEdges.map((e) =>
          graph.creases[e].assignment === 'V' ? -0.02 : 0.02,
        ),
        regWeight: 0.04,
        fast: true,
        maxIter: 30,
        tol: CLOSURE_TOL,
      });
      const geomRes = Math.max(
        r.residual,
        ...propagateForResidual(graph, r.angles),
      );
      if (geomRes < best.res) {
        best = {
          x: target.autoEdges.map((e) => r.angles[e]),
          res: geomRes,
        };
      }
    }
    return best.x;
  };

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
      if (!initialized) {
        warmX = detectBranch(guide.signedAngles);
        initialized = true;
      }
      // 以上一可靠步的自动角解为热启动，并用软正则把零空间自由度拉回预测值，
      // 使欠约束机构沿最小角变化的平滑分支延续，而不是数值上跳到任意解。
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
      const result = evaluateConfiguration(graph, config);
      const delta = maxAngleDelta(lastAngles, config.signedAngles);
      const penetrates = result.intersections.length > 0;
      const maxGap = result.closureGaps[0]?.gap ?? 0;
      const signOk = target.autoEdges.every((e) => signConforms(graph, e, config.signedAngles[e]));
      // 可行性以最终几何为准：闭环裂缝与求解残差都必须很小、无穿透、角度变化受控。
      const geometricallyClosed = maxGap <= CLOSURE_TOL && solved.residual <= CLOSURE_TOL;
      const feasible =
        geometricallyClosed && !penetrates && signOk && delta <= maxStepAngle + 1e-6;

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

  const finalStep = steps[steps.length - 1];
  return {
    id: `path_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: options.label ?? '路径',
    branchSeed: seed.slice(),
    target,
    flat,
    steps,
    stopReason,
    createdAt: Date.now(),
    keyframes: [],
    keyframeMeta: [],
    fingerprint: fingerprint(finalStep.config),
  };
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
  target: FoldConfiguration;
  stopReason: StopReason;
  createdAt: number;
  keyframes: number[];
  keyframeMeta: { step: number; label: string; t: number }[];
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
    target: path.target,
    stopReason: path.stopReason,
    createdAt: path.createdAt,
    keyframes: path.keyframes.slice(),
    keyframeMeta: path.keyframeMeta.map((k) => ({ ...k })),
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
  const steps: MotionStep[] = data.steps.map((s) => {
    const config: FoldConfiguration = {
      signedAngles: s.signedAngles,
      autoEdges: data.target.autoEdges.slice(),
    };
    return {
      t: s.t,
      config,
      residual: s.residual,
      iterations: s.iterations,
      result: evaluateConfiguration(graph, config),
      maxDelta: s.maxDelta,
      accepted: true,
    };
  });
  return {
    id: data.id,
    label: data.label,
    branchSeed: data.branchSeed,
    target: data.target,
    flat,
    steps,
    stopReason: data.stopReason,
    createdAt: data.createdAt,
    keyframes: data.keyframes.slice(),
    keyframeMeta: data.keyframeMeta.map((k) => ({ ...k })),
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
