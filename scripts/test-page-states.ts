import 'fake-indexeddb/auto';
globalThis.window = { addEventListener() {}, removeEventListener() {} } as never;
globalThis.document = { createElement: () => ({ click() {}, href: '', download: '' }) } as never;
import { effect } from 'vue';

const assert = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const { useOrigamiStore } = await import('../src/store/useOrigami');
const { runContinuation, buildTarget } = await import('../src/fold/continuation');

// 订阅 foldResult / activePath，模拟页面模板的响应式读取
const store = useOrigamiStore();
let renders = 0;
effect(() => {
  void store.graphVersion;
  void store.activePathId;
  void store.foldResult.value;
  renders++;
});
store.loadExample('degree4');
[4,6].forEach((e) => store.setAssignment(e, 'M'));
[5,7].forEach((e) => store.setAssignment(e, 'V'));

// 页面“到达目标 + 收敛”
const p = await store.runPath({ label: '页面态', fixedEdges: [4], goalDeg: { 4: 60 } });
const path = store.activePath!;
assert(p!.stopReason === 'reached-target', '路径状态：到达目标');
store.setPlaybackStep(path.steps.length - 1);
const verdict = store.foldResult.value!;
assert(verdict.converged, '页面诊断收敛态为真（不显示未收敛）');
assert(verdict.issues.every((i) => i.kind !== 'nonConverged'), '诊断列表无非收敛 issue');
assert(path.closureTolerance > 0 && path.steps.at(-1)!.residual <= path.closureTolerance, '面板残差在可接受容差内');

// 失解：页面显示 stopReason 且停在平展（在违反川崎的 inconsistent 示例上过约束）
const storeBad = useOrigamiStore();
storeBad.loadExample('inconsistent');
const bad = await storeBad.runPath({ label: '失解', fixedEdges: [4,5,6], goalDeg: {4:60,5:60,6:60}, maxStepDeg: 8 });
assert(bad!.stopReason === 'infeasible', '失解路径页面可读到 infeasible');
assert(storeBad.activePath!.steps.at(-1)!.t < 0.05, '页面路径停在最后可靠步（t≈0）');

// 关键帧即时刷新：activePath.keyframeMeta 立刻变长
store.selectPath(p!.id);
store.setPlaybackStep(3);
const n0 = store.activePath!.keyframeMeta.length;
store.addKeyframe('页面关键帧');
assert(store.activePath!.keyframeMeta.length === n0 + 1, '保存关键帧后当前路径立即显示');

// 切换路径比较：两条路径都在列表且分支身份不同
const p2 = await store.runPath({ label: '另一支', fixedEdges: [5], goalDeg: { 5: 60 } });
assert(store.paths.length >= 2, '页面可比较两条路径');
assert(store.paths[0].branchId !== store.paths[1].branchId, '列表中两路径分支身份不同');
assert(renders > 4, `响应式渲染已触发 ${renders} 次`);

// 取消态（底层，校验页面消息来源字段）
const g = store.graph!;
const target = buildTarget(g, [4], { 4: 60 });
let cancel = false;
const pc = await runContinuation(g, target, { shouldCancel: () => cancel, yieldEvery: 1, onStep: (s) => { if (s.t > 0.4) cancel = true; } });
assert(pc.stopReason === 'cancelled' && pc.steps.at(-1)!.t < 0.7, '取消路径保留可靠步（页面据此显示已取消）');
