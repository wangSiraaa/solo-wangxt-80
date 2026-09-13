/** 折叠计算总装：折痕属性 -> 有向角 -> 约束求解 -> BFS 传播 -> 闭合/自交诊断。
 *  角度约定：折痕两侧面片之间的二面角 = π − angle；
 *  山折（M）有向角取正，谷折（V）取负，旋转轴沿父面环内的有向边（右手定则）。 */

import type { FoldGraph, FoldIssue, FoldResult, IntersectingPair } from './types';
import { propagate, triangulatePolygon, isTraversable } from './fold';
import { solveAutoAngles } from './solver';
import { trianglesIntersect } from './collision';

const CONVERGE_TOL = 5e-4;

export function signedAnglesOf(graph: FoldGraph): number[] {
  return graph.creases.map((c) => {
    if (c.assignment === 'V') return -c.angle;
    return c.angle; // M、F、U、B 统一用非负；B 不参与传播
  });
}

export function computeFold(graph: FoldGraph): FoldResult {
  const issues: FoldIssue[] = [];
  const signed = signedAnglesOf(graph);
  const autoEdges = graph.creases
    .map((c, e) => (c.auto && isTraversable(c.assignment) ? e : -1))
    .filter((e) => e >= 0);

  // 多起点尝试，规避非线性方程组的局部失败（未知量很少）
  const starts: number[][] = [
    autoEdges.map((e) => signed[e]),
    autoEdges.map(() => 0.6),
    autoEdges.map(() => -0.6),
    autoEdges.map(() => 1.3),
    autoEdges.map(() => -1.3),
  ];

  let best = solveAutoAngles(graph, signed, autoEdges, {
    initial: starts[0],
    tol: CONVERGE_TOL,
  });
  if (!best.converged && autoEdges.length > 0) {
    for (let i = 1; i < starts.length; i++) {
      const cand = solveAutoAngles(graph, signed, autoEdges, {
        initial: starts[i],
        tol: CONVERGE_TOL,
      });
      if (cand.residual < best.residual) best = cand;
      if (best.converged) break;
    }
  }

  const finalProp = propagate(graph, best.angles);

  // 边界冲突：共享边被标记为 B，实际被剪开
  for (let e = 0; e < graph.edgesVertices.length; e++) {
    if (graph.edgesFaces[e].length === 2 && graph.creases[e].assignment === 'B') {
      issues.push({
        kind: 'boundaryConflict',
        message: `折痕 ${e} 两侧面片共享该边却被标记为边界，纸片在该处被剪开（相邻面会裂开）`,
      });
    }
  }

  if (!finalProp.connected) {
    issues.push({
      kind: 'disconnected',
      message: '折痕图被边界标记分割成多块，不是一张相连的纸片',
    });
  }

  const closureGaps = finalProp.closureGaps
    .filter((g) => g.gap > 1e-9)
    .sort((a, b) => b.gap - a.gap);

  if (!best.converged) {
    const maxGap = Math.max(best.residual, closureGaps[0]?.gap ?? 0);
    issues.push({
      kind: 'nonConverged',
      message: `折叠约束未收敛：存在无法同时闭合的折痕顶点（最大裂缝 ${maxGap.toFixed(4)}，例如不满足川崎条件的四折痕顶点）`,
    });
  }

  // 世界坐标三角化
  const faceTriangles: number[][][] = graph.facesVertices.map((ring) => {
    const pts2 = ring.map((v) => graph.vertices[v]);
    return triangulatePolygon(pts2);
  });

  // 自交检测：仅检查不共享边的面片对之间的三角形对
  const intersections = detectIntersections(graph, finalProp.faceWorldVerts, faceTriangles);
  if (intersections.length > 0) {
    issues.push({
      kind: 'selfIntersection',
      message: `检测到 ${intersections.length} 组面片自交（刚性面互相穿透），该折痕角组合不可实现`,
    });
  }

  const solvedAngles: Record<number, number> = {};
  autoEdges.forEach((e) => {
    solvedAngles[e] = best.angles[e];
  });

  return {
    transforms: finalProp.transforms,
    faceWorldVerts: finalProp.faceWorldVerts,
    faceTriangles,
    closureGaps,
    intersections,
    solvedAngles,
    converged: best.converged,
    iterations: best.iterations,
    residual: best.residual,
    issues,
    connected: finalProp.connected,
  };
}

/** 可折叠：收敛、连通、无边界冲突、无自交。任何折痕图都不会被默认宣称可折。 */
export function isFoldable(result: FoldResult): boolean {
  return (
    result.converged &&
    result.connected &&
    !result.issues.some((i) => i.kind === 'boundaryConflict' || i.kind === 'selfIntersection')
  );
}

function detectIntersections(
  graph: FoldGraph,
  worldVerts: [number, number, number][][],
  faceTris: number[][][],
): IntersectingPair[] {
  const pairs: IntersectingPair[] = [];
  const n = worldVerts.length;

  const sharedEdge = (a: number, b: number): boolean => {
    for (const e of graph.facesEdges[a]) {
      const faces = graph.edgesFaces[e];
      if (faces.includes(a) && faces.includes(b)) return true;
    }
    return false;
  };

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (sharedEdge(a, b)) continue;
      let hit = false;
      outer: for (const ta of faceTris[a]) {
        const triA = ta.map((idx) => worldVerts[a][idx]) as [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ];
        for (const tb of faceTris[b]) {
          const triB = tb.map((idx) => worldVerts[b][idx]) as [
            [number, number, number],
            [number, number, number],
            [number, number, number],
          ];
          if (trianglesIntersect(triA, triB)) {
            hit = true;
            break outer;
          }
        }
      }
      if (hit) pairs.push({ faceA: a, faceB: b });
    }
  }
  return pairs;
}
