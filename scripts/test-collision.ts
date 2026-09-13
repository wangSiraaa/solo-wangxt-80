import { loadFold } from '../src/fold/graph';
import { computeFold } from '../src/fold/engine';
import { examples } from '../src/fold/examples';
import { trianglesIntersect } from '../src/fold/collision';

// 单元级：已知相交/不相交三角形
const t1: [number, number, number][] = [[0,0,0],[1,0,0],[0,1,0]];
const t2hit: [number, number, number][] = [[0.2,0.2,-0.5],[0.8,0.2,0.5],[0.2,0.8,0.5]];
const t2miss: [number, number, number][] = [[5,5,-0.5],[6,5,0.5],[5,6,0.5]];
console.log('expect hit:', trianglesIntersect(t1, t2hit));
console.log('expect miss:', trianglesIntersect(t1, t2miss));
// 共面重叠
const t3: [number, number, number][] = [[0.2,0.2,0],[0.8,0.2,0],[0.2,0.8,0]];
console.log('expect coplanar hit:', trianglesIntersect(t1, t3));
// 共面分离
const t4: [number, number, number][] = [[2,2,0],[3,2,0],[2,3,0]];
console.log('expect coplanar miss:', trianglesIntersect(t1, t4));
// 共享顶点不应误报（用严格内部）
const t5: [number, number, number][] = [[0,0,0],[-1,0,0],[0,-1,0]];
console.log('expect shared-vertex miss:', trianglesIntersect(t1, t5));

// 场景级：单折样例折到接近 180°（两页压合不算自交，因为共享边被跳过）
const { graph } = loadFold(examples[0].fold);
graph.creases[6].angle = Math.PI - 0.01;
const r1 = computeFold(graph);
console.log('book near-flat intersections:', r1.intersections.length, 'foldable?', true);

// 四折痕顶点：强行把所有折痕折 170°，大概率自交
const { graph: g2 } = loadFold(examples[1].fold);
g2.creases.forEach((c) => { c.auto = false; });
g2.creases[4].angle = Math.PI - 0.05;
g2.creases[5].angle = 0.2;
g2.creases[6].angle = Math.PI - 0.05;
g2.creases[7].angle = 0.2;
const r2 = computeFold(g2);
console.log('extreme degree4: intersections', r2.intersections.length, 'issues', r2.issues.map((i) => i.kind));
