/** 无厚度面片关系分类：穿透相交、共面重叠、邻近接触候选、无接触。
 *  仅处理零厚度刚性面片的几何关系——不包含真实纸张的厚度、材料分层或弹性，
 *  因此“接触”只表示表面距离，不推断叠层顺序。 */

type Vec = [number, number, number];
type Tri = [Vec, Vec, Vec];

const EPS = 1e-9;
/** 近共面 / 接触判定的距离阈值（与面片尺度无关的绝对值，UI 中按包围盒归一化展示） */
export const CONTACT_EPS = 1e-6;

export type TriRelation =
  | { kind: 'intersect' }
  | { kind: 'coplanar-overlap' }
  | { kind: 'contact'; distance: number }
  | { kind: 'none'; distance: number };

export function trianglesIntersect(a: Tri, b: Tri): boolean {
  const r = classifyTriPair(a, b, 1e-7);
  return r.kind === 'intersect' || r.kind === 'coplanar-overlap';
}

export function classifyTriPair(a: Tri, b: Tri, contactTol: number): TriRelation {
  const { normal: n1 } = planeFromTri(a);
  const { normal: n2 } = planeFromTri(b);
  const d1 = b.map((p) => dot(n1, sub(p, a[0])));
  const d2 = a.map((p) => dot(n2, sub(p, b[0])));

  const coplanar =
    Math.abs(dot(n1, sub(b[0], a[0]))) < CONTACT_EPS && d1.every((d) => Math.abs(d) < CONTACT_EPS);
  if (coplanar) {
    return coplanarIntersect(a, b)
      ? { kind: 'coplanar-overlap' }
      : { kind: 'none', distance: triTriDistance(a, b) };
  }

  const oneSide1 = d1[0] * d1[1] > EPS && d1[0] * d1[2] > EPS;
  const oneSide2 = d2[0] * d2[1] > EPS && d2[0] * d2[2] > EPS;
  if (!oneSide1 && !oneSide2) {
    // 相互跨立：区间重叠才是真穿透
    const dir = cross(n1, n2);
    const i1 = projectOntoLine(a, d2, dir);
    const i2 = projectOntoLine(b, d1, dir);
    if (
      i1 &&
      i2 &&
      Math.max(Math.min(i1[0], i1[1]), Math.min(i2[0], i2[1])) <=
        Math.min(Math.max(i1[0], i1[1]), Math.max(i2[0], i2[1])) + EPS
    ) {
      return { kind: 'intersect' };
    }
  }

  const distance = triTriDistance(a, b);
  return distance <= contactTol ? { kind: 'contact', distance } : { kind: 'none', distance };
}

/** 求三角形与平面的两个交点，并投影到交线方向 dir 上得到一维区间。 */
function projectOntoLine(tri: Tri, ds: number[], dir: Vec): [number, number] | null {
  const points: Vec[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const dA = ds[i];
    const dB = ds[j];
    if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
      const t = dA / (dA - dB);
      points.push(add(tri[i], scale(sub(tri[j], tri[i]), t)));
    }
  }
  if (points.length !== 2) return null;
  return [dot(points[0], dir), dot(points[1], dir)];
}

function coplanarIntersect(a: Tri, b: Tri): boolean {
  for (const p of a) if (pointInTriInterior(p, b)) return true;
  for (const p of b) if (pointInTriInterior(p, a)) return true;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (segSeg3(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3])) return true;
    }
  }
  return false;
}

function pointInTriInterior(p: Vec, tri: Tri): boolean {
  const n = planeFromTri(tri).normal;
  const axis: readonly [number, number] =
    Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2])
      ? [1, 2]
      : Math.abs(n[1]) > Math.abs(n[2])
        ? [0, 2]
        : [0, 1];
  const q = (v: Vec): [number, number] => [v[axis[0]], v[axis[1]]];
  const pp = q(p);
  const t = tri.map(q) as [number, number][];
  const s1 = edgeSign(pp, t[0], t[1]);
  const s2 = edgeSign(pp, t[1], t[2]);
  const s3 = edgeSign(pp, t[2], t[0]);
  const hasNeg = s1 < -EPS || s2 < -EPS || s3 < -EPS;
  const hasPos = s1 > EPS || s2 > EPS || s3 > EPS;
  const onEdge = Math.abs(s1) < EPS || Math.abs(s2) < EPS || Math.abs(s3) < EPS;
  return !(hasNeg && hasPos) && !onEdge;
}

function edgeSign(p: [number, number], a: [number, number], b: [number, number]): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

function segSeg3(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const r = cross(d1, d2);
  const denom = dot(r, r);
  if (denom < EPS) return false;
  const qp = sub(p3, p1);
  const t = dot(cross(qp, d2), r) / denom;
  const u = dot(cross(qp, d1), r) / denom;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}

/** 两三角形的最小距离：顶点到另一三角形 9 组 + 9 组边对距离的最小值。 */
function triTriDistance(a: Tri, b: Tri): number {
  let min = Infinity;
  for (const p of a) min = Math.min(min, pointTriDistance(p, b));
  for (const p of b) min = Math.min(min, pointTriDistance(p, a));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      min = Math.min(min, segSegDistance(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3]));
    }
  }
  return min;
}

function pointTriDistance(p: Vec, tri: Tri): number {
  const { normal } = planeFromTri(tri);
  const h = dot(normal, sub(p, tri[0]));
  const proj = sub(p, scale(normal, h));
  // 投影点在三角形内 -> 垂直距离
  if (pointInTriPlanarInclusive(proj, tri)) return Math.abs(h);
  // 否则到三条边的最小距离
  let min = Infinity;
  for (let i = 0; i < 3; i++) {
    min = Math.min(min, pointSegDistance(p, tri[i], tri[(i + 1) % 3]));
  }
  return min;
}

function pointInTriPlanarInclusive(p: Vec, tri: Tri): boolean {
  const n = planeFromTri(tri).normal;
  const axis: readonly [number, number] =
    Math.abs(n[0]) > Math.abs(n[1]) && Math.abs(n[0]) > Math.abs(n[2])
      ? [1, 2]
      : Math.abs(n[1]) > Math.abs(n[2])
        ? [0, 2]
        : [0, 1];
  const q = (v: Vec): [number, number] => [v[axis[0]], v[axis[1]]];
  const pp = q(p);
  const t = tri.map(q) as [number, number][];
  const s1 = edgeSign(pp, t[0], t[1]);
  const s2 = edgeSign(pp, t[1], t[2]);
  const s3 = edgeSign(pp, t[2], t[0]);
  const hasNeg = s1 < -EPS || s2 < -EPS || s3 < -EPS;
  const hasPos = s1 > EPS || s2 > EPS || s3 > EPS;
  return !(hasNeg && hasPos);
}

function pointSegDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < EPS) return Math.hypot(...sub(p, a));
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  return Math.hypot(...sub(p, add(a, scale(ab, t))));
}

/** 两条线段的最小距离（不要求相交）。 */
function segSegDistance(p1: Vec, p2: Vec, p3: Vec, p4: Vec): number {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const r = cross(d1, d2);
  const denom = dot(r, r);
  if (denom < EPS) {
    // 平行：取端点到另一线段距离最小值
    return Math.min(
      pointSegDistance(p1, p3, p4),
      pointSegDistance(p2, p3, p4),
      pointSegDistance(p3, p1, p2),
      pointSegDistance(p4, p1, p2),
    );
  }
  const qp = sub(p3, p1);
  let t = dot(cross(qp, d2), r) / denom;
  let u = dot(cross(qp, d1), r) / denom;
  t = Math.min(1, Math.max(0, t));
  u = Math.min(1, Math.max(0, u));
  const c1 = add(p1, scale(d1, t));
  const c2 = add(p3, scale(d2, u));
  return Math.hypot(...sub(c1, c2));
}

function planeFromTri(t: Tri): { normal: Vec } {
  const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
  const len = Math.hypot(...n) || 1;
  return { normal: [n[0] / len, n[1] / len, n[2] / len] };
}

function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec, s: number): Vec {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
