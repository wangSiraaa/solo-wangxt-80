import { loadFold } from '../src/fold/graph';
import { computeFold, isFoldable, signedAnglesOf } from '../src/fold/engine';
import { examples } from '../src/fold/examples';

for (const ex of examples) {
  console.log('==== ', ex.label);
  const { graph, problems } = loadFold(ex.fold);
  console.log('verts', graph.vertices.length, 'edges', graph.edgesVertices.length, 'faces', graph.facesVertices.length);
  console.log('edges_faces', JSON.stringify(graph.edgesFaces));
  if (problems.length) console.log('load problems:', problems);
  const res = computeFold(graph);
  console.log('converged:', res.converged, 'iterations:', res.iterations, 'residual:', res.residual.toExponential(3));
  console.log('foldable:', isFoldable(res));
  console.log('closure gaps:', res.closureGaps.slice(0, 4).map((g) => ({ edge: g.edge, gap: +g.gap.toFixed(5) })));
  console.log('intersections:', res.intersections.length);
  console.log('issues:', res.issues.map((i) => i.kind));
  console.log('solvedAngles:', Object.fromEntries(Object.entries(res.solvedAngles).map(([k, v]) => [k, +(v as number).toFixed(4)])));
  // 抽查一个面的世界顶点
  console.log('face0 world:', res.faceWorldVerts[0].map((p) => p.map((c) => +c.toFixed(3))));
  if (graph.facesVertices.length > 1) {
    console.log('face1 world:', res.faceWorldVerts[1].map((p) => p.map((c) => +c.toFixed(3))));
  }
}

// 手动检查单折：V 谷折符号与共享边端点重合
{
  const { graph } = loadFold(examples[0].fold);
  graph.creases[6].assignment = 'V';
  const res = computeFold(graph);
  console.log('==== single V-fold');
  console.log('foldable:', isFoldable(res), 'gaps:', res.closureGaps.length);
  console.log('face1 world:', res.faceWorldVerts[1].map((p) => p.map((c) => +c.toFixed(3))));
}
