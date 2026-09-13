import 'fake-indexeddb/auto';
globalThis.window = { addEventListener() {}, removeEventListener() {} } as never;
globalThis.document = {
  createElement: () => ({ click() {}, set href(_: string) {}, set download(_: string) {} }),
} as never;

const { useOrigamiStore } = await import('../src/store/useOrigami');
const { examples } = await import('../src/fold/examples');
const { serializePath, deserializePath } = await import('../src/fold/continuation');

// 用 degree4 的 2M2V 平滑分支跑一条路径，随工程保存后在新 store 重放
const store = useOrigamiStore();
store.loadExample('degree4');
// 指派为 2M2V
store.graph!.creases.forEach((c) => (c.auto = false));
[4, 6].forEach((e) => (store.graph!.creases[e].assignment = 'M'));
[5, 7].forEach((e) => (store.graph!.creases[e].assignment = 'V'));
const graph = store.graph!;
const path = await store.runPath({
  label: '持久化路径',
  fixedEdges: [4],
  goalDeg: { 4: 60 },
  maxStepDeg: 10,
});
console.log('path steps', path!.steps.length, 'stop', path!.stopReason);

// 序列化 -> 反序列化重放
const ser = serializePath(path!);
const restored = deserializePath(ser, graph);
const endOrig = path!.steps.at(-1)!.config.signedAngles;
const endRest = restored.steps.at(-1)!.config.signedAngles;
const maxDiff = Math.max(...endOrig.map((a, i) => Math.abs(a - endRest[i])));
console.log('重放末态最大角度差', maxDiff.toExponential(2), '指纹一致', restored.fingerprint === path!.fingerprint);

// 通过 store 保存到 IndexedDB 后用新 store 打开
store.renameTitle('路径持久化工程');
await store.saveToIndexedDb();
const id = store['projectId' as keyof typeof store] as unknown as string;
const all = await store.listProjects();
const rec = all.find((r) => r.title === '路径持久化工程')!;
console.log('保存记录含路径字段:', Array.isArray((rec.fold as any).x_origami_preview_paths));
const store2 = useOrigamiStore();
await store2.loadFromDb(rec.id);
void id;
console.log('重载后路径数', store2.paths.length);
const sel = store2.activePath;
console.log('重载激活路径', sel?.label, '步数', sel?.steps.length, '末态残差',
  sel?.steps.at(-1)!.residual.toExponential(2));

// 形态一致：末态几何关键顶点坐标
const w1 = path!.steps.at(-1)!.result.faceWorldVerts.map((r) => r.map((p) => p.map((c) => +c.toFixed(5))));
const w2 = sel!.steps.at(-1)!.result.faceWorldVerts.map((r) => r.map((p) => p.map((c) => +c.toFixed(5))));
console.log('重放形态一致:', JSON.stringify(w1) === JSON.stringify(w2));

// 工程源折痕未被路径修改
console.log('源折痕角仍为默认:', graph.creases.slice(4).map((c) => +(c.angle * 180 / Math.PI).toFixed(1)));
