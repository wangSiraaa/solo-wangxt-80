/** FOLD 格式的载入、归一化与导出。
 *  Rabbit Ear 负责 populate（补全 edges_faces / faces_edges 等关联表）与 planarize
 *  （只给边时自动生成面）；其余转成项目内部的普通数组结构。 */

import ear from 'rabbit-ear';
import type { CreaseAssignment, CreaseInfo, FoldGraph } from './types';
import { traceFaces } from './faceTrace';

/** 自定义命名空间，导出时用于保留折痕身份与自动角度标记。 */
const NS = 'x_origami_preview';

interface RawFold {
  vertices_coords?: number[][];
  edges_vertices?: number[][];
  faces_vertices?: number[][];
  edges_assignment?: string[];
  edges_foldAngle?: number[];
  file_spec?: number;
  frame_title?: string;
  [key: string]: unknown;
}

export interface LoadedGraph {
  graph: FoldGraph;
  title: string;
  /** 载入阶段发现的结构问题 */
  problems: string[];
}

export function loadFold(input: string | RawFold): LoadedGraph {
  const raw: RawFold = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  if (!raw.vertices_coords || raw.vertices_coords.length < 3) {
    throw new Error('FOLD 数据缺少 vertices_coords 或顶点数不足');
  }

  const parsedEdges: [number, number][] = Array.isArray(raw.edges_vertices)
    ? raw.edges_vertices.map((e) => [e[0], e[1]])
    : [];
  parsedEdges.forEach(([a, b]) => {
    if (a < 0 || b < 0 || a >= raw.vertices_coords!.length || b >= raw.vertices_coords!.length) {
      throw new Error(`边引用了不存在的顶点（${a}-${b}），折痕图数据无效`);
    }
  });

  // 构造面：优先使用 FOLD 自带的 faces_vertices；仅给边时用半边遍历兜底
  let suppliedFaces: number[][] | null = null;
  if (raw.faces_vertices && raw.faces_vertices.length > 0) {
    suppliedFaces = raw.faces_vertices.map((r) => r.slice());
  }
  let normalized: Record<string, unknown>;
  try {
    const base: Record<string, unknown> = { ...raw };
    if (!suppliedFaces) {
      const traced = traceFaces(
        raw.vertices_coords.map((c) => [Number(c[0]), Number(c[1] ?? 0)]),
        parsedEdges,
      );
      if (traced.length === 0) throw new Error('无法从边集合构造面片（边可能交叉或未闭合）');
      base.faces_vertices = traced;
    }
    normalized = ear.graph.populate(base);
  } catch (e) {
    throw new Error(`折痕图解析失败：${(e as Error).message}`);
  }

  const g = normalized as unknown as {
    vertices_coords: number[][];
    edges_vertices: number[][];
    faces_vertices: number[][];
    edges_faces: (number | null | undefined)[];
    faces_edges: number[][];
    edges_assignment?: string[];
    edges_foldAngle?: number[];
  };

  const vertices: [number, number][] = g.vertices_coords.map((c) => [
    Number(c[0]),
    Number(c[1] ?? 0),
  ]);
  const edgesVertices: [number, number][] = g.edges_vertices.map((e) => [e[0], e[1]]);
  const facesVertices = g.faces_vertices.map((ring) => ring.slice());

  // 统一面环为逆时针（2D 带符号面积 > 0）
  for (const ring of facesVertices) {
    if (signedArea(ring, vertices) < 0) ring.reverse();
  }

  const edgesFaces: (number | null)[][] = edgesVertices.map((_, e) => {
    const pair = g.edges_faces?.[e];
    const arr = Array.isArray(pair) ? pair : [pair];
    return arr.filter((x): x is number => typeof x === 'number');
  });

  // 每条边在邻接面中的有向形式。populate 的 faces_edges 在折痕顶点分割面环时会留 null，
  // 因此直接按面环相邻顶点对与边端点匹配来重建（edges_vertices 唯一）。
  const edgeKey = new Map<string, number>();
  edgesVertices.forEach(([a, b], e) => {
    edgeKey.set(`${a}_${b}`, e);
    edgeKey.set(`${b}_${a}`, e);
  });
  const edgesFacesOrient: { face: number; a: number; b: number }[][] = edgesVertices.map(
    () => [],
  );
  const facesEdges: number[][] = [];
  for (let f = 0; f < facesVertices.length; f++) {
    const ring = facesVertices[f];
    const row: number[] = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const edge = edgeKey.get(`${a}_${b}`);
      if (edge === undefined) {
        throw new Error(`面 ${f} 的顶点对 ${a}-${b} 找不到对应边，折痕图数据不一致`);
      }
      row.push(edge);
      edgesFacesOrient[edge].push({ face: f, a, b });
    }
    facesEdges.push(row);
  }

  const problems: string[] = [];
  const storedIds = (raw[`${NS}_crease_id`] ?? []) as (string | null)[] | undefined;
  const storedAuto = (raw[`${NS}_crease_auto`] ?? []) as (boolean | null)[] | undefined;

  const creases: CreaseInfo[] = edgesVertices.map((_, e) => {
    const assignment = normalizeAssignment(g.edges_assignment?.[e]);
    const foldDeg = g.edges_foldAngle?.[e];
    const foldRad =
      typeof foldDeg === 'number' && Number.isFinite(foldDeg)
        ? (Math.abs(foldDeg) * Math.PI) / 180
        : assignment === 'M' || assignment === 'V'
          ? Math.PI / 3
          : 0;
    // 共享边被标成边界 -> 纸片在拓扑上被剪开（不一致边界）
    if (assignment === 'B' && edgesFaces[e].length === 2) {
      problems.push(`边 ${e} 被两个面共享却标记为边界（B），折叠时将出现裂口`);
    }
    if ((assignment === 'U' || assignment === 'F') && edgesFaces[e].length === 2) {
      // U/F 默认可折但角度为 0（平展），允许用户后续修改
    }
    return {
      angle: foldRad,
      assignment,
      auto: storedAuto?.[e] === true,
      id: storedIds?.[e] ?? `e${e}`,
    };
  });

  return {
    graph: {
      vertices,
      edgesVertices,
      facesVertices,
      edgesFaces,
      edgesFacesOrient,
      facesEdges,
      creases,
    },
    title: (raw.frame_title as string) ?? '未命名折痕图',
    problems,
  };
}

function normalizeAssignment(a?: string): CreaseAssignment {
  if (a === 'M' || a === 'V' || a === 'B' || a === 'F') return a;
  return 'U';
}

function signedArea(ring: number[], verts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = verts[ring[i]];
    const [bx, by] = verts[ring[(i + 1) % ring.length]];
    s += ax * by - bx * ay;
  }
  return s / 2;
}

/** 导出：保留顶点、面、折痕身份与折叠参数。 */
export function exportFold(graph: FoldGraph, title: string, keepFold: boolean): RawFold {
  const fold: RawFold = {
    file_spec: 1.1,
    frame_title: title,
    vertices_coords: graph.vertices.map((v) => [v[0], v[1]]),
    edges_vertices: graph.edgesVertices.map((e) => [e[0], e[1]]),
    faces_vertices: graph.facesVertices.map((r) => r.slice()),
    edges_assignment: graph.creases.map((c) => c.assignment),
  };
  if (keepFold) {
    fold.edges_foldAngle = graph.creases.map((c) => {
      if (c.assignment === 'M') return Math.round((c.angle * 1800) / Math.PI) / 10;
      if (c.assignment === 'V') return -Math.round((c.angle * 1800) / Math.PI) / 10;
      return 0;
    });
    fold[`${NS}_crease_auto`] = graph.creases.map((c) => c.auto);
  } else {
    fold.edges_foldAngle = graph.creases.map(() => 0);
  }
  fold[`${NS}_crease_id`] = graph.creases.map((c) => c.id);
  return fold;
}
