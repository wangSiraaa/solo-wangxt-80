/** 折叠计算总装。
 *  - evaluateConfiguration：给定一份完整折角构型（运动路径产生），直接传播并诊断；
 *  - computeFold：按源折痕的 assignment / angle / auto 标记先求解自动角再传播（静态编辑用）。
 *  诊断包含闭环裂缝、面片穿透/共面重叠、近共面接触候选（仅无厚度表面距离）。 */

import type {
  FoldConfiguration,
  FoldGraph,
  FoldIssue,
  FoldResult,
  IntersectingPair,
  ContactPair,
} from './types';
import { propagate, triangulatePolygon, isTraversable } from './fold';
import { solveAutoAngles } from './solver';
import { classifyTriPair } from './collision';

const CONVERGE_TOL = 5e-4;

export function signedAngleOf(assignment: string, magnitude: number): number {
  return assignment === 'V' ? -magnitude : magnitude;
}

export function configurationFromGraph(graph: FoldGraph): FoldConfiguration {
  return {
    signedAngles: graph.creases.map((c) => signedAngleOf(c.assignment, c.angle)),
    autoEdges: graph.creases
      .map((c, e) => (c.auto && isTraversable(c.assignment) ? e : -1))
      .filter((e) => e >= 0),
  };
}

/** 多初值求解自动角，返回残差最小的结果。 */
function solveWithRestarts(graph: FoldGraph, config: FoldConfiguration) {
  const { signedAngles, autoEdges } = config;
  const starts: number[][] = [
    autoEdges.map((e) => signedAngles[e]),
    autoEdges.map(() => 0.6),
    autoEdges.map(() => -0.6),
    autoEdges.map(() => 1.3),
    autoEdges.map(() => -1.3),
  ];
  let best = solveAutoAngles(graph, signedAngles, autoEdges, {
    initial: starts[0],
    tol: CONVERGE_TOL,
  });
  if (!best.converged && autoEdges.length > 0) {
    for (let i = 1; i < starts.length; i++) {
      const cand = solveAutoAngles(graph, signedAngles, autoEdges, {
        initial: starts[i],
        tol: CONVERGE_TOL,
      });
      if (cand.residual < best.residual) best = cand;
      if (best.converged) break;
    }
  }
  return best;
}

/** 静态入口：源折痕 -> 自动角求解 -> 传播诊断。 */
export function computeFold(graph: FoldGraph): FoldResult {
  const config = configurationFromGraph(graph);
  const solved = solveWithRestarts(graph, config);
  return evaluateConfiguration(graph, {
    signedAngles: solved.angles,
    autoEdges: config.autoEdges,
  }, {
    converged: solved.converged,
    iterations: solved.iterations,
    solveResidual: solved.residual,
    solvedAuto: config.autoEdges,
  });
}

export interface EvaluateExtras {
  converged?: boolean;
  iterations?: number;
  solveResidual?: number;
  solvedAuto?: number[];
}

/** 给定完整有向折角数组做传播与诊断（不再求解）。 */
export function evaluateConfiguration(
  graph: FoldGraph,
  config: FoldConfiguration,
  extras: EvaluateExtras = {},
): FoldResult {
  const issues: FoldIssue[] = [];
  const prop = propagate(graph, config.signedAngles);

  for (let e = 0; e < graph.edgesVertices.length; e++) {
    if (graph.edgesFaces[e].length === 2 && graph.creases[e].assignment === 'B') {
      issues.push({
        kind: 'boundaryConflict',
        message: `折痕 ${e} 两侧面片共享该边却被标记为边界，纸片在该处被剪开（相邻面会裂开）`,
      });
    }
  }
  if (!prop.connected) {
    issues.push({
      kind: 'disconnected',
      message: '折痕图被边界标记分割成多块，不是一张相连的纸片',
    });
  }

  const closureGaps = prop.closureGaps
    .filter((g) => g.gap > 1e-9)
    .sort((a, b) => b.gap - a.gap);

  const converged = extras.converged ?? closureGaps.length === 0;
  if (!converged) {
    const maxGap = Math.max(extras.solveResidual ?? 0, closureGaps[0]?.gap ?? 0);
    issues.push({
      kind: 'nonConverged',
      message: `折叠约束未收敛：存在无法同时闭合的折痕顶点（最大裂缝 ${maxGap.toFixed(4)}，例如不满足川崎条件）`,
    });
  }

  const faceTriangles: number[][][] = graph.facesVertices.map((ring) =>
    triangulatePolygon(ring.map((v) => graph.vertices[v])),
  );

  const { intersections, contacts } = detectRelations(
    graph,
    prop.faceWorldVerts,
    faceTriangles,
  );
  if (intersections.length > 0) {
    issues.push({
      kind: 'selfIntersection',
      message: `检测到 ${intersections.length} 组面片穿透/共面重叠（刚性面互相穿越），该折角组合不可实现`,
    });
  }

  const solvedAngles: Record<number, number> = {};
  (extras.solvedAuto ?? []).forEach((e) => {
    solvedAngles[e] = config.signedAngles[e];
  });

  return {
    transforms: prop.transforms,
    faceWorldVerts: prop.faceWorldVerts,
    faceTriangles,
    closureGaps,
    intersections,
    contacts,
    solvedAngles,
    converged,
    iterations: extras.iterations ?? 0,
    residual: extras.solveResidual ?? (closureGaps[0]?.gap ?? 0),
    issues,
    connected: prop.connected,
  };
}

/** 可折叠：收敛、连通、无边界冲突、无穿透。任何折痕图都不会被默认宣称可折。 */
export function isFoldable(result: FoldResult): boolean {
  return (
    result.converged &&
    result.connected &&
    !result.issues.some((i) => i.kind === 'boundaryConflict' || i.kind === 'selfIntersection')
  );
}

function modelScale(worldVerts: [number, number, number][][]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const ring of worldVerts) {
    for (const [x, y, z] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
}

/** 不共享边的面片对：穿透/重叠记为 intersections，贴近但不穿透记为 contacts 候选。 */
function detectRelations(
  graph: FoldGraph,
  worldVerts: [number, number, number][][],
  faceTris: number[][][],
): { intersections: IntersectingPair[]; contacts: ContactPair[] } {
  const intersections: IntersectingPair[] = [];
  const contacts: ContactPair[] = [];
  const n = worldVerts.length;
  const contactTol = modelScale(worldVerts) * 0.008;

  const sharedEdge = (a: number, b: number): boolean => {
    for (const e of graph.facesEdges[a]) {
      const faces = graph.edgesFaces[e];
      if (faces.includes(a) && faces.includes(b)) return true;
    }
    return false;
  };
  const ringSet = (f: number) => new Set(graph.facesVertices[f]);
  const shareVertex = (a: number, b: number): boolean => {
    const ra = ringSet(a);
    return graph.facesVertices[b].some((v) => ra.has(v));
  };

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      // 共享边或仅共享顶点的面片在合法刚性运动中只会贴合/分离，不作为接触/穿透候选
      if (sharedEdge(a, b) || shareVertex(a, b)) continue;
      let hit = false;
      let nearest = Infinity;
      outer: for (const ta of faceTris[a]) {
        const triA = ta.map((idx) => worldVerts[a][idx]) as Parameters<typeof classifyTriPair>[0];
        for (const tb of faceTris[b]) {
          const triB = tb.map((idx) => worldVerts[b][idx]) as Parameters<typeof classifyTriPair>[0];
          const rel = classifyTriPair(triA, triB, contactTol);
          if (rel.kind === 'intersect') {
            hit = true;
            break outer;
          }
          if (rel.kind === 'coplanar-overlap') {
            // 无厚度模型：精确共面叠层是接触而非穿透，距离记 0
            nearest = 0;
            continue;
          }
          nearest = Math.min(nearest, rel.distance);
        }
      }
      if (hit) intersections.push({ faceA: a, faceB: b });
      else if (nearest <= contactTol) contacts.push({ faceA: a, faceB: b, distance: nearest });
    }
  }
  contacts.sort((x, y) => x.distance - y.distance);
  return { intersections, contacts };
}
