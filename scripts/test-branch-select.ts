import { loadFold } from '../src/fold/graph';
import { examples } from '../src/fold/examples';
import { runContinuation, buildTarget } from '../src/fold/continuation';

const assert = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };

// ---- degree4 2M2V：驱动折痕对 A（M4）与折痕对 B（V5），同目标角度，两路径可区分 ----
{
  const { graph } = loadFold(examples[1].fold);
  graph.creases.forEach((c) => (c.auto = false));
  [4, 6].forEach((e) => (graph.creases[e].assignment = 'M'));
  [5, 7].forEach((e) => (graph.creases[e].assignment = 'V'));

  const tA = buildTarget(graph, [4], { 4: 60 });
  const tB = buildTarget(graph, [5], { 5: 60 });
  const pA = await runContinuation(graph, tA, { label: '驱动M4', maxSteps: 300, maxStepAngle: 0.12 });
  const pB = await runContinuation(graph, tB, { label: '驱动V5', maxSteps: 300, maxStepAngle: 0.12 });
  const a = pA.steps.at(-1)!;
  const b = pB.steps.at(-1)!;
  console.log('A 分支', pA.branchId, '末态', [4,5,6,7].map((e) => +(a.config.signedAngles[e]*180/Math.PI).toFixed(1)));
  console.log('B 分支', pB.branchId, '末态', [4,5,6,7].map((e) => +(b.config.signedAngles[e]*180/Math.PI).toFixed(1)));
  assert(pA.branchId !== pB.branchId, '两路径分支身份不同');
  assert(Math.abs(a.config.signedAngles[4] - b.config.signedAngles[4]) > 0.5, '终态可区分（M4 角度不同）');
  // 逐步轨迹不同
  let maxDiff = 0;
  for (let i = 0; i < Math.min(pA.steps.length, pB.steps.length); i++)
    for (const e of [4,5,6,7])
      maxDiff = Math.max(maxDiff, Math.abs(pA.steps[i].config.signedAngles[e] - pB.steps[i].config.signedAngles[e]));
  assert(maxDiff > 0.3, '逐步轨迹可区分');
  assert(pA.steps.at(-1)!.result.converged && pB.steps.at(-1)!.result.converged, '两路径终态诊断均收敛（不再误报未收敛）');
}

// ---- seed 指向不存在的符号合法分支时停在平展，不静默跟随自然支 ----
{
  const { graph } = loadFold(examples[1].fold);
  graph.creases.forEach((c) => (c.auto = false));
  [4, 6].forEach((e) => (graph.creases[e].assignment = 'M'));
  [5, 7].forEach((e) => (graph.creases[e].assignment = 'V'));
  const target = buildTarget(graph, [4], { 4: 60 });
  // 强烈推 V 对（index 0,2），但 M4 固定时该装配模不可行
  const seed = [-1.2, 0.02, -1.2];
  const p = await runContinuation(graph, target, { branchSeed: seed, maxSteps: 300, maxStepAngle: 0.12 });
  console.log('强推不可行分支 stop=', p.stopReason, 'steps', p.steps.length, '末 t', p.steps.at(-1)!.t);
  assert(p.stopReason === 'infeasible' && p.steps.at(-1)!.t < 0.02, '不可行 seed 停在平展最后可靠步');
}

// ---- Miura：自然 seed=0 与镜像 seed 比较（若第二支不存在则停平展，存在则可区分）----
{
  const { graph } = loadFold(examples[2].fold);
  const interior = graph.edgesVertices.map((_, e) => e).filter((e) => graph.edgesFaces[e].length === 2);
  const target = buildTarget(graph, [interior[0]], { [interior[0]]: 60 });
  const auto = target.autoEdges;
  const p0 = await runContinuation(graph, target, { label: 'seed0' });
  const seedMirror = auto.map((e) => (graph.creases[e].assignment === 'V' ? -0.02 : 1.1));
  const p1 = await runContinuation(graph, target, { label: 'mirror', branchSeed: seedMirror });
  console.log('Miura seed0', p0.stopReason, p0.steps.length, '步, 分支', p0.branchId);
  console.log('Miura mirror', p1.stopReason, p1.steps.length, '步, 分支', p1.branchId);
  if (p1.stopReason === 'reached-target') {
    assert(p0.branchId !== p1.branchId, 'Miura 镜像支身份不同');
  } else {
    assert(p1.steps.at(-1)!.t < 0.05, 'Miura 无第二平滑支时镜像 seed 停在平展');
  }
  assert(p0.stopReason === 'reached-target' && p0.steps.at(-1)!.result.converged, 'Miura 自然支到达且收敛');
}
