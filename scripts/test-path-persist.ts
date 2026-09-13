import 'fake-indexeddb/auto';
globalThis.window = { addEventListener() {}, removeEventListener() {} } as never;
globalThis.document = {
  createElement: () => ({ click() {}, set href(_: string) {}, set download(_: string) {} }),
} as never;

const assert = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };

const { useOrigamiStore } = await import('../src/store/useOrigami');
const { examples } = await import('../src/fold/examples');

// 用 2M2V degree4 平滑支跑路径并加关键帧，完整 IndexedDB 往返
const store = useOrigamiStore();
store.loadExample('degree4');
const g = store.graph!;
[4, 6].forEach((e) => store.setAssignment(e, 'M'));
[5, 7].forEach((e) => store.setAssignment(e, 'V'));

const path = await store.runPath({ label: '重载路径', fixedEdges: [4], goalDeg: { 4: 60 }, maxStepDeg: 10 });
console.log('路径步数', path!.steps.length, 'stop', path!.stopReason, '分支', path!.branchId);

// 拖到中间步并保存关键帧：应立即在 store.activePath 上可见（无需重选）
const mid = Math.floor(path!.steps.length / 2);
store.setPlaybackStep(mid);
const beforeCount = store.activePath!.keyframeMeta.length;
store.addKeyframe('中间关键帧');
const afterCount = store.activePath!.keyframeMeta.length;
assert(afterCount === beforeCount + 1, '关键帧保存后立即刷新（无需重新选择路径）');
assert(store.activePath!.keyframeMeta[0].label === '中间关键帧', '关键帧标签即时可读');

// 保存到 IndexedDB，然后新 store 打开
store.renameTitle('完整重放工程');
await store.saveToIndexedDb();
const recs = await store.listProjects();
const rec = recs.find((r) => r.title === '完整重放工程')!;
const store2 = useOrigamiStore();
await store2.loadFromDb(rec.id);

assert(store2.paths.length === 1, '重载后路径存在');
const rp = store2.activePath;
assert(!!rp, '重载后自动激活路径');
assert(rp!.stopReason === 'reached-target', '停止原因保留');
assert(rp!.keyframeMeta.length === 1 && rp!.keyframeMeta[0].label === '中间关键帧', '关键帧随工程重载');
assert(rp!.branchId === path!.branchId, '分支身份保留');

// 形态一致：逐步步的关键顶点坐标对比
let maxGeomDiff = 0;
for (let i = 0; i < path!.steps.length; i++) {
  const a = path!.steps[i].result.faceWorldVerts;
  const b = rp!.steps[i].result.faceWorldVerts;
  for (let f = 0; f < a.length; f++)
    for (let v = 0; v < a[f].length; v++)
      for (let k = 0; k < 3; k++)
        maxGeomDiff = Math.max(maxGeomDiff, Math.abs(a[f][v][k] - b[f][v][k]));
}
console.log('重载重放最大几何坐标差', maxGeomDiff.toExponential(2));
assert(maxGeomDiff < 1e-6, '重载后按保存路径重放的形态与保存前一致');

// 末态诊断：到达目标不应报未收敛
store2.setPlaybackStep(rp!.steps.length - 1);
assert(store2.foldResult.value?.converged === true, '到达目标时诊断为收敛（不再误报未收敛）');
assert((store2.foldResult.value?.issues ?? []).every((i) => i.kind !== 'nonConverged'), '无未收敛 issue');

// ---- 取消：停在最后可靠步，保留已接受步 ----
const storeC = useOrigamiStore();
storeC.loadExample('degree4');
const gc = storeC.graph!;
[4, 6].forEach((e) => storeC.setAssignment(e, 'M'));
[5, 7].forEach((e) => storeC.setAssignment(e, 'V'));
let cancelledAt = 0;
const pC = await storeC.runPath({
  label: '取消',
  fixedEdges: [4],
  goalDeg: { 4: 60 },
  maxStepDeg: 10,
  branchBias: 0,
});
void cancelledAt;
// 用底层 API 复现取消
const { runContinuation, buildTarget } = await import('../src/fold/continuation');
const target = buildTarget(gc, [4], { 4: 60 });
let cancel = false;
const pCancel = await runContinuation(gc, target, {
  shouldCancel: () => cancel,
  yieldEvery: 1,
  onStep: (s) => { if (s.t > 0.4) cancel = true; },
});
assert(pCancel.stopReason === 'cancelled', '取消原因正确');
assert(pCancel.steps.length > 1 && pCancel.steps.at(-1)!.t < 0.7, '取消后保留可靠步且非终态');
assert(pCancel.steps.every((s) => s.result.intersections.length === 0), '取消前各步无穿透');

// ---- 失解停在最后可靠步：过约束目标（三条固定角不相容）----
const storeB = useOrigamiStore();
storeB.loadExample('inconsistent');
const pBad = await storeB.runPath({
  label: '失解',
  fixedEdges: [4, 5, 6],
  goalDeg: { 4: 60, 5: 60, 6: 60 },
  maxStepDeg: 8,
});
assert(pBad!.stopReason === 'infeasible', '过约束报告失去可行解');
assert(pBad!.steps.at(-1)!.t < 0.05, '停在平展附近的最后可靠步');

// ---- 无厚度接触候选：Miura 深折时至少可计算 contacts 字段，且不误判穿透 ----
const storeM = useOrigamiStore();
storeM.loadExample('miura2');
const gm = storeM.graph!;
const interior = gm.edgesVertices.map((_, e) => e).filter((e) => gm.edgesFaces[e].length === 2);
const pM = await storeM.runPath({
  label: '接触',
  fixedEdges: [interior[0]],
  goalDeg: { [interior[0]]: 80 },
  maxStepDeg: 10,
});
const lastM = pM!.steps.at(-1)!;
assert(Array.isArray(lastM.result.contacts), '提供无厚度接触候选列表');
assert(lastM.result.intersections.length === 0, '接触候选不等同穿透');
console.log('接触候选数量:', lastM.result.contacts.length, '穿透数量:', lastM.result.intersections.length);
