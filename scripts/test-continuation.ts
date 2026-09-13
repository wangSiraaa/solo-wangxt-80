import { loadFold } from '../src/fold/graph';
import { buildTarget, runContinuation, replayPath, type MotionPath } from '../src/fold/continuation';
import { examples } from '../src/fold/examples';

const assert = (cond: boolean, msg: string) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) process.exitCode = 1;
};

// 2M2V 交替的可折 degree4（同一扇区上的平滑 Miura 分支）
const smoothGraph = () => {
  const { graph } = loadFold(examples[1].fold);
  graph.creases.forEach((c) => (c.auto = false));
  [4, 6].forEach((e) => (graph.creases[e].assignment = 'M'));
  [5, 7].forEach((e) => (graph.creases[e].assignment = 'V'));
  return graph;
};

// ---- 1. 平滑分支从平展逐步到达，无跳变/穿透 ----
{
  const graph = smoothGraph();
  const target = buildTarget(graph, [4], { [4]: 60 });
  const p = await runContinuation(graph, target, { label: '平滑分支', maxSteps: 300, maxStepAngle: 0.15 });
  const last = p.steps.at(-1)!;
  console.log('[平滑分支]', p.stopReason, 'steps', p.steps.length, 't', last.t.toFixed(3));
  assert(p.stopReason === 'reached-target', '到达目标折角');
  assert(Math.max(...p.steps.map((s) => s.maxDelta)) * 180 / Math.PI < 10, '每步折角变化 < 10°（无突然翻面）');
  assert(last.result.intersections.length === 0, '全程无面片穿透');
  assert(Math.abs(last.config.signedAngles[4] * 180 / Math.PI - 60) < 0.5, '固定边达到 60°');
  assert(replayPath(graph, p).consistent, '重放指纹一致');
}

// ---- 2. 奇异 3M1V 指派：从平展无法平滑延续，停在最后可靠位置 ----
{
  const { graph } = loadFold(examples[1].fold); // 自带 3M1V
  graph.creases.forEach((c) => (c.auto = false));
  const target = buildTarget(graph, [4], { [4]: 60 });
  const p = await runContinuation(graph, target, { label: '奇异分支', maxSteps: 200, maxStepAngle: 0.15 });
  console.log('[奇异分支]', p.stopReason, '末 t =', p.steps.at(-1)!.t.toFixed(3));
  assert(p.stopReason === 'infeasible', '报告失去可行解');
  assert(p.steps.at(-1)!.t < 0.2, '停在平展附近而非跳到翻面终态');
}

// ---- 3. 运动中取消：保留已接受的最后可靠步 ----
{
  const graph = smoothGraph();
  const target = buildTarget(graph, [4], { [4]: 60 });
  let cancel = false;
  const p = await runContinuation(graph, target, {
    label: '取消',
    shouldCancel: () => cancel,
    yieldEvery: 1,
    onStep: (s) => { if (s.t > 0.4) cancel = true; },
  });
  console.log('[取消]', p.stopReason, 't_end', p.steps.at(-1)!.t.toFixed(3));
  assert(p.stopReason === 'cancelled', '停止原因是取消');
  assert(Math.abs(p.steps.at(-1)!.t - 0.4) < 0.15, '停在取消点附近（不跳到终态）');
  assert(p.steps.length > 1, '取消前的可靠步被保留');
}

// ---- 4. 近共面退化：Miura 条带平滑折到 80°（二面角很小），数值稳定且报接触候选 ----
{
  const { graph } = loadFold(examples[2].fold);
  const interior = graph.edgesVertices.map((_, e) => e).filter((e) => graph.edgesFaces[e].length === 2);
  const target = buildTarget(graph, [interior[0]], { [interior[0]]: 80 });
  const p = await runContinuation(graph, target, { label: '近共面', maxSteps: 600, maxStepAngle: 0.12 });
  const last = p.steps.at(-1)!;
  const finite = last.config.signedAngles.every((a) => Number.isFinite(a));
  console.log('[近共面]', p.stopReason, 't', last.t.toFixed(3), 'res', last.residual.toExponential(2),
    'contacts', last.result.contacts.length, 'finite', finite, 'M4', (last.config.signedAngles[interior[0]]*180/Math.PI).toFixed(1));
  assert(p.stopReason === 'reached-target', '近共面构形平滑到达');
  assert(finite, '近共面下角度全部有限（无 NaN）');
  assert(last.result.intersections.length === 0, '无穿透（叠合最多算接触）');
  assert(last.result.converged, '近共面终态诊断为收敛');
}

// ---- 5. 过约束（同时固定多条折痕到不相容角度）：离开平展即停 ----
{
  const { graph } = loadFold(examples[3].fold);
  graph.creases.forEach((c) => (c.auto = false));
  // M4=60,V5=-60,M6=60 同时固定，V7 自动：不存在闭合解
  const target = buildTarget(graph, [4, 5, 6], { 4: 60, 5: 60, 6: 60 });
  const p = await runContinuation(graph, target, { label: '过约束', maxSteps: 300, maxStepAngle: 0.12 });
  console.log('[过约束]', p.stopReason, 't_end', p.steps.at(-1)!.t.toFixed(4));
  assert(p.stopReason === 'infeasible' && p.steps.at(-1)!.t < 0.05, '不相容的固定角在平展附近失去可行解');
}

// ---- 5b. 违反川崎的顶点仍可三维刚性折叠（川崎只约束扁平态）----
{
  const { graph } = loadFold(examples[3].fold);
  graph.creases.forEach((c) => (c.auto = false));
  const target = buildTarget(graph, [4], { 4: 90 });
  const p = await runContinuation(graph, target, { label: '三维刚性', maxSteps: 300, maxStepAngle: 0.12 });
  const last = p.steps.at(-1)!;
  console.log('[非川崎三维]', p.stopReason, 't', last.t.toFixed(3), 'res', last.residual.toExponential(2));
  assert(p.stopReason === 'reached-target', '违反川崎不妨碍非扁平的三维刚性折叠');
  assert(last.result.intersections.length === 0, '该三维构形无穿透');
}

// ---- 6. 两条路径比较与关键帧；路径不改源折痕 ----
{
  const graphA = smoothGraph();
  const before = graphA.creases.map((c) => [c.assignment, c.angle] as const);
  const target60 = buildTarget(graphA, [4], { [4]: 60 });
  const target30 = buildTarget(graphA, [4], { [4]: 30 });
  const p1 = await runContinuation(graphA, target60, { label: '路径甲 60°', maxSteps: 300 });
  const p2 = await runContinuation(graphA, target30, { label: '路径乙 30°', maxSteps: 300 });
  // 源折痕未被修改
  const unchanged = graphA.creases.every((c, i) => c.assignment === before[i][0] && c.angle === before[i][1]);
  console.log('[双路径]', p1.label, p1.steps.at(-1)!.t, '/', p2.label, p2.steps.at(-1)!.t);
  assert(unchanged, '路径运动不修改工程源折痕的指派/角度');
  assert(p1.id !== p2.id, '两条路径身份不同');
  assert(
    Math.abs(p1.steps.at(-1)!.config.signedAngles[4] - p2.steps.at(-1)!.config.signedAngles[4]) > 0.3,
    '两条路径终态不同可比较',
  );
  // 关键帧
  const kfIdx = Math.floor(p1.steps.length / 2);
  (p1 as MotionPath).keyframes.push(kfIdx);
  (p1 as MotionPath).keyframeMeta.push({ step: kfIdx, label: '中间态', t: p1.steps[kfIdx].t });
  assert(p1.keyframes.length === 1 && p1.keyframeMeta[0].label === '中间态', '可在路径上保存关键帧');
}
