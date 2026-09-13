import { loadFold } from '../src/fold/graph';
import { propagate } from '../src/fold/fold';
import { triangulatePolygon } from '../src/fold/fold';
import { trianglesIntersect } from '../src/fold/collision';

const fold = {
  file_spec: 1.1,
  vertices_coords: [[-1,0],[1,0],[4,0],[4,1],[1,1],[-1,1],[-4,1],[-4,0]],
  edges_vertices: [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
    [1,4],[0,5],
  ],
  edges_assignment: ['B','B','B','B','B','B','B','B','M','M'],
  faces_vertices: [[1,2,3,4],[0,1,4,5],[0,5,6,7]],
};
const { graph } = loadFold(fold);
const tris = graph.facesVertices.map((ring) => triangulatePolygon(ring.map((v) => graph.vertices[v])));

let hits = 0;
for (let i = 0; i < 4000 && hits < 3; i++) {
  const a = (Math.random() * 359 - 179.5) * Math.PI / 180;
  const b = (Math.random() * 359 - 179.5) * Math.PI / 180;
  const ang = [0,0,0,0,0,0,0,0, a, b];
  const r = propagate(graph, ang);
  // face0 与 face2 不共享边
  let hit = false;
  for (const ta of tris[0]) for (const tb of tris[2]) {
    const A = ta.map((k) => r.faceWorldVerts[0][k]) as any;
    const B = tb.map((k) => r.faceWorldVerts[2][k]) as any;
    if (trianglesIntersect(A, B)) { hit = true; break; }
  }
  if (hit) {
    hits++;
    console.log('HIT a=', (a*180/Math.PI).toFixed(1), 'b=', (b*180/Math.PI).toFixed(1));
    r.faceWorldVerts.forEach((fv, fi) => console.log(` face${fi}`, fv.map((p) => p.map((c) => +c.toFixed(2)).join(',')).join(' | ')));
  }
}
console.log('total hits:', hits);
