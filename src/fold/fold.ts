/** 刚性折叠传播：以面为节点、折痕为铰链，按生成树做 BFS，
 *  每个子面的刚体变换 = 父面变换 × 绕铰链边的有向旋转。
 *  非树折痕边用于检验“相邻面共享边不能裂开”的闭合约束。 */

import type { FoldGraph } from './types';
import {
  identity,
  mul,
  applyPoint,
  rotationAroundAxis,
  dist3,
  normalize3,
  sub3,
  type Mat4,
  type Vec3,
} from './mat';

/** 可折叠传播的边（非边界、非剪开）。F=保持平展，U=未指派（按平展处理）。 */
export function isTraversable(assignment: string): boolean {
  return assignment === 'M' || assignment === 'V' || assignment === 'F' || assignment === 'U';
}

export interface PropagationResult {
  transforms: Mat4[];
  /** 每片面对应的生成树根；根不同意味着纸片被剪开 */
  roots: number[];
  treeEdges: Set<number>;
  faceWorldVerts: Vec3[][];
  /** 非树折痕边的闭合误差 */
  closureGaps: { edge: number; gap: number }[];
  connected: boolean;
}

/** 用并查集构造“自动折痕优先”的生成树，保证 auto 边尽量落在树内（其角度才是可解未知量）。 */
function buildSpanningTree(graph: FoldGraph): { treeEdges: Set<number>; parent: Int32Array } {
  const n = graph.facesVertices.length;
  const parent = new Int32Array(n).fill(-1);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] >= 0) r = parent[r];
    while (parent[x] >= 0) {
      const nx = parent[x];
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  const union = (a: number, b: number): boolean => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return false;
    if (parent[ra] > parent[rb]) [ra, rb] = [rb, ra];
    parent[ra] += parent[rb];
    parent[rb] = ra;
    return true;
  };

  const traversable: number[] = [];
  for (let e = 0; e < graph.edgesVertices.length; e++) {
    if (graph.edgesFaces[e].length === 2 && isTraversable(graph.creases[e].assignment)) {
      traversable.push(e);
    }
  }
  // 自动角折痕优先上树（其角度通过传播驱动面片位姿），固定角边自然成为闭环边。
  traversable.sort((a, b) => Number(graph.creases[b].auto) - Number(graph.creases[a].auto));

  const treeEdges = new Set<number>();
  for (const e of traversable) {
    const [fa, fb] = graph.edgesFaces[e] as [number, number];
    if (union(fa, fb)) treeEdges.add(e);
  }
  return { treeEdges, parent };
}

/** 面环上一条边的有向端点（沿该面顶点顺序）。 */
function edgeOrientationInFace(graph: FoldGraph, edge: number, face: number): [number, number] {
  const rec = graph.edgesFacesOrient[edge].find((o) => o.face === face)!;
  return [rec.a, rec.b];
}

/**
 * 执行折叠。
 * @param signedAngles 每条边的有向折叠角（M 正、V 负）；auto 边由此参数传入候选值
 */
export function propagate(graph: FoldGraph, signedAngles: number[]): PropagationResult {
  const n = graph.facesVertices.length;
  const { treeEdges } = buildSpanningTree(graph);

  // 树邻接
  const treeAdj: { face: number; edge: number }[][] = Array.from({ length: n }, () => []);
  for (const e of treeEdges) {
    const [fa, fb] = graph.edgesFaces[e] as [number, number];
    treeAdj[fa].push({ face: fb, edge: e });
    treeAdj[fb].push({ face: fa, edge: e });
  }

  const transforms: Mat4[] = Array.from({ length: n }, () => identity());
  const roots = new Int32Array(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);

  // 每棵树从最小索引面开始 BFS
  for (let root = 0; root < n; root++) {
    if (visited[root]) continue;
    visited[root] = true;
    roots[root] = root;
    transforms[root] = identity();
    const queue = [root];
    while (queue.length) {
      const f = queue.shift()!;
      for (const { face: child, edge } of treeAdj[f]) {
        if (visited[child]) continue;
        visited[child] = true;
        roots[child] = root;
        const [a, b] = edgeOrientationInFace(graph, edge, f);
        const pa: Vec3 = [...graph.vertices[a], 0];
        const pb: Vec3 = [...graph.vertices[b], 0];
        const axis = normalize3(sub3(pb, pa));
        // 父面绕铰链转 +θ 到达子面；把子面局部（平面）坐标映到父面系应使用逆旋转 −θ，
        // 世界变换 = 父世界变换 × R(axis,−θ)。M 正 V 负的约定不变。
        const r = rotationAroundAxis(axis, pa, -signedAngles[edge]);
        transforms[child] = mul(transforms[f], r);
        queue.push(child);
      }
    }
  }

  // 世界顶点
  const faceWorldVerts: Vec3[][] = graph.facesVertices.map((ring, fi) =>
    ring.map((v) => applyPoint(transforms[fi], [...graph.vertices[v], 0] as Vec3)),
  );

  // 闭合误差：非树折痕边两端，用两个邻接面各自的变换变换后应重合
  const closureGaps: { edge: number; gap: number }[] = [];
  for (let e = 0; e < graph.edgesVertices.length; e++) {
    if (graph.edgesFaces[e].length !== 2 || treeEdges.has(e)) continue;
    if (!isTraversable(graph.creases[e].assignment)) continue;
    const [fa, fb] = graph.edgesFaces[e] as [number, number];
    if (roots[fa] !== roots[fb]) continue; // 被边界剪开的边另行报告
    const [va, vb] = graph.edgesVertices[e];
    const wa = applyPoint(transforms[fa], [...graph.vertices[va], 0] as Vec3);
    const wb = applyPoint(transforms[fb], [...graph.vertices[va], 0] as Vec3);
    const wa2 = applyPoint(transforms[fa], [...graph.vertices[vb], 0] as Vec3);
    const wb2 = applyPoint(transforms[fb], [...graph.vertices[vb], 0] as Vec3);
    const gap = Math.max(dist3(wa, wb), dist3(wa2, wb2));
    closureGaps.push({ edge: e, gap });
  }

  const rootSet = new Set<number>(roots as unknown as number[]);
  return {
    transforms,
    roots: Array.from(roots),
    treeEdges,
    faceWorldVerts,
    closureGaps,
    connected: rootSet.size <= 1,
  };
}

/** 耳切法三角化简单多边形（输入为平面 x/y 坐标，面环已逆时针），返回局部索引三元组。 */
export function triangulatePolygon(points: [number, number][]): number[][] {
  const n = points.length;
  if (n === 3) return [[0, 1, 2]];
  const indices = points.map((_, i) => i);
  const tris: number[][] = [];
  let guard = 0;
  while (indices.length > 3 && guard++ < n * n) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      const [ax, ay] = points[i0];
      const [bx, by] = points[i1];
      const [cx, cy] = points[i2];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cross <= 1e-12) continue; // 凹或退化（环为 CCW）
      let containsPoint = false;
      for (const j of indices) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(points[j], points[i0], points[i1], points[i2])) {
          containsPoint = true;
          break;
        }
      }
      if (!containsPoint) {
        tris.push([i0, i1, i2]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // 容错：异常多边形直接放弃剩余三角
  }
  if (indices.length === 3) tris.push([indices[0], indices[1], indices[2]]);
  return tris;
}

function pointInTriangle(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  return !((d1 < 0) || (d2 < 0) || (d3 < 0)) && !((d1 === 0) || (d2 === 0) || (d3 === 0));
}
