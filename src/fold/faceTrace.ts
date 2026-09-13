/** 仅给出顶点与边时，用半边遍历枚举平面直线图的有界面。
 *  要求边互不交叉（设计者应先平面化）；存在 T 形接点时同样适用，
 *  因为遍历时只按顶点处出射边的极角顺序转向。 */

export function traceFaces(
  vertices: [number, number][],
  edgesVertices: [number, number][],
): number[][] {
  // 每个顶点的出射半边（终点），按极角逆时针排序
  const outgoing = new Map<number, number[]>();
  for (const [a, b] of edgesVertices) {
    if (!outgoing.has(a)) outgoing.set(a, []);
    outgoing.get(a)!.push(b);
    if (!outgoing.has(b)) outgoing.set(b, []);
    outgoing.get(b)!.push(a);
  }
  for (const [v, list] of outgoing) {
    list.sort((p, q) => angleAt(vertices, v, p) - angleAt(vertices, v, q));
  }

  // 半边 u->v（面在左侧）的下一条半边为 v->w：
  // 在 v 的 CCW 出射表中取 u 的前一个（最顺时针）邻居 w。
  const n = vertices.length;
  const key = (u: number, v: number) => u * n + v;
  const nextAt = (u: number, v: number): number | undefined => {
    const list = outgoing.get(v);
    if (!list) return undefined;
    const idx = list.indexOf(u);
    if (idx < 0) return undefined;
    return list[(idx - 1 + list.length) % list.length];
  };

  const used = new Set<number>();
  const faces: number[][] = [];
  for (const [a, b] of edgesVertices) {
    for (const [start, end] of [[a, b], [b, a]] as [number, number][]) {
      if (used.has(key(start, end))) continue;
      const ring: number[] = [];
      let u = start;
      let v = end;
      let valid = true;
      while (!used.has(key(u, v))) {
        used.add(key(u, v));
        ring.push(u);
        const w = nextAt(u, v);
        if (w === undefined) {
          valid = false;
          break;
        }
        u = v;
        v = w;
        if (ring.length > edgesVertices.length + 1) {
          valid = false;
          break;
        }
      }
      if (!valid || ring.length < 3) continue;
      if (signedArea(ring, vertices) > 1e-9) faces.push(ring); // 保留 CCW 有界面
    }
  }
  return faces;
}

function angleAt(verts: [number, number][], from: number, to: number): number {
  const [ax, ay] = verts[from];
  const [bx, by] = verts[to];
  return Math.atan2(by - ay, bx - ax);
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
