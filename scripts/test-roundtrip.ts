import { loadFold, exportFold } from '../src/fold/graph';
import { examples } from '../src/fold/examples';

for (const ex of examples) {
  const { graph, title } = loadFold(ex.fold);
  graph.creases[0].id = 'custom-id-0';
  const exported = exportFold(graph, title + '-导出', true);
  const again = loadFold(exported);
  const okId = again.graph.creases.every((c, i) => c.id === graph.creases[i].id);
  const okAssign = again.graph.creases.every((c, i) => c.assignment === graph.creases[i].assignment);
  const okAuto = again.graph.creases.every((c, i) => c.auto === graph.creases[i].auto);
  const okAngle = again.graph.creases.every(
    (c, i) => Math.abs(c.angle - graph.creases[i].angle) < 0.002,
  );
  const okVert = JSON.stringify(again.graph.vertices) === JSON.stringify(graph.vertices);
  const okFace = JSON.stringify(again.graph.facesVertices) === JSON.stringify(graph.facesVertices);
  console.log(
    ex.key,
    JSON.stringify({ okId, okAssign, okAuto, okAngle, okVert, okFace, title: exported.frame_title }),
  );
}

// 不带折叠参数导出也应保留身份
const { graph } = loadFold(examples[0].fold);
const flat = exportFold(graph, '平面', false);
const back = loadFold(flat);
console.log('flat export keeps id:', back.graph.creases[0].id === graph.creases[0].id);
