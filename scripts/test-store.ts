// 在 Node 中验证 store 的撤销：角度、指派、自动角标记与折叠几何随撤销整体恢复。
// 用 @vue/react-effect 不需要 DOM；store 中除 IndexedDB/下载外都是纯逻辑，
// 通过桩替换未触及的方法即可。
import { effect } from 'vue';
import { examples } from '../src/fold/examples';

// 直接内联一个最小 store 行为复刻成本太高；改为动态构造，屏蔽 DOM API。
globalThis.window = { addEventListener() {}, removeEventListener() {} } as never;
globalThis.document = { createElement: () => ({ click() {}, set href(_: string) {}, set download(_: string) {} }), } as never;

const { useOrigamiStore } = await import('../src/store/useOrigami');
const store = useOrigamiStore();
store.loadFromFold(structuredClone(examples[0].fold));

const log = (tag: string) => {
  const c = store.graph!.creases[6];
  console.log(tag, { assignment: c.assignment, angleDeg: +(c.angle * 180 / Math.PI).toFixed(2), auto: c.auto });
};

let runs = 0;
effect(() => {
  void store.graphVersion;
  store.foldResult.value; // 订阅折叠结果
  runs++;
});

log('初始');
// 拖动角度 60 -> 120
store.beginInteraction('角度');
store.setAngleLive(6, 120);
log('拖动中');
store.setAngleLive(6, 130);
store.commitInteraction();
log('提交后');
console.log('undo 深度', store.canUndo ? '可撤销' : '不可撤销');
// 改为谷折（指派入栈）
store.setAssignment(6, 'V');
log('改谷折后');
// 撤销指派
store.undo();
log('撤销指派');
// 撤销角度（几何恢复 60° 山折）
store.undo();
log('撤销角度后（应与初始一致）');
console.log('foldResult issues:', store.foldResult.value?.issues.length, 'gaps:', store.foldResult.value?.closureGaps.length);
console.log('redo available:', store.canRedo);
store.redo();
log('重做后（应恢复 130° 山折）');
