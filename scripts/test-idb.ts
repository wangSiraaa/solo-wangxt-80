import 'fake-indexeddb/auto';
globalThis.window = { addEventListener() {}, removeEventListener() {} } as never;
globalThis.document = {
  createElement: () => ({ click() {}, set href(_: string) {}, set download(_: string) {} }),
} as never;

const { useOrigamiStore } = await import('../src/store/useOrigami');
const { examples } = await import('../src/fold/examples');

const store = useOrigamiStore();
store.loadFromFold(structuredClone(examples[1].fold));
store.renameTitle('工程存取测试');
store.beginInteraction('a');
store.setAngleLive(5, 90);
store.commitInteraction();
await store.saveToIndexedDb();

const all = await store.listProjects();
console.log('保存数量:', all.length, '标题:', all[0].title, 'dirty:', store.dirty);

// 新开一个 store 载入该工程
const store2 = useOrigamiStore();
await store2.loadFromDb(all[0].id);
const c5 = store2.graph!.creases[5];
console.log('重载后角度:', +(c5.angle * 180 / Math.PI).toFixed(1), '标题:', store2.title);
console.log('折叠结果收敛:', store2.foldResult.value?.converged);

await store.deleteProject(all[0].id);
console.log('删除后数量:', (await store.listProjects()).length);
