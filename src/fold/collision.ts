/** 面片自交检测：对不共享边的三角片做相交测试。
 *  通用情况用 Möller 区间法（两三角形相互跨立，且在公共交线方向上的投影区间重叠）；
 *  共面情况做点在三角形内 / 线段相交的退化测试。
 *  目的是把自交可靠地暴露给用户，不追求接触流形的几何精度。 */

type Vec = [number, number, number];
type Tri = [Vec, Vec, Vec];

const EPS = 1e-9;

export function trianglesIntersect(a: Tri, b: Tri): boolean {
  const { normal: n1 } = planeFromTri(a);
  const { normal: n2 } = planeFromTri(b);
  // b 各顶点相对 a 平面的有向距离，反之亦然
  const d1 = b.map((p) => dot(n1, sub(p, a[0])));
  const d2 = a.map((p) => dot(n2, sub(p, b[0])));

  const coplanar =
    Math.abs(dot(n1, sub(b[0], a[0]))) < 1e-7 && d1.every((d) => Math.abs(d) < 1e-7);
  if (coplanar) return coplanarIntersect(a, b);

  // 任一三角形整体位于另一三角形平面的同一侧 -> 不相交
  const oneSide1 = d1[0] * d1[1] > EPS && d1[0] * d1[2] > EPS;
  const oneSide2 = d2[0] * d2[1] > EPS && d2[0] * d2[2] > EPS;
  if (oneSide1 || oneSide2) return false;

  // 公共交线方向：T1 与平面2 的交线段、T2 与平面1 的交线段投影后须重叠
  const dir = cross(n1, n2);
  const i1 = projectOntoLine(a, d2, dir); // T1 跨立平面2
  const i2 = projectOntoLine(b, d1, dir); // T2 跨立平面1
  if (!i1 || !i2) return false;
  return (
    Math.max(Math.min(i1[0], i1[1]), Math.min(i2[0], i2[1])) <=
    Math.min(Math.max(i1[0], i1[1]), Math.max(i2[0], i2[1])) + EPS
  );
}

/** 求三角形与平面的两个交点，并投影到交线方向 dir 上得到一维区间。 */
function projectOntoLine(
  tri: Tri,
  ds: number[],
  dir: Vec,
): [number, number] | null {
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
  for (const p of a) if (pointInTriPlanar(p, b)) return true;
  for (const p of b) if (pointInTriPlanar(p, a)) return true;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (segSeg3(a[i], a[(i + 1) % 3], b[j], b[(j + 1) % 3])) return true;
    }
  }
  return false;
}

function pointInTriPlanar(p: Vec, tri: Tri): boolean {
  // 投影到法线主导方向对应的坐标平面
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
  // 内部或严格包含才算；落在边上只是共享顶点/边接触（这类面片对通常另有共享关系）
  return !(hasNeg && hasPos) && !onEdge;
}

function edgeSign(p: [number, number], a: [number, number], b: [number, number]): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

function segSeg3(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d1v = sub(p2, p1);
  const d2 = sub(p4, p3);
  const r = cross(d1v, d2);
  const denom = dot(r, r);
  if (denom < EPS) return false;
  const qp = sub(p3, p1);
  const t = dot(cross(qp, d2), r) / denom;
  const u = dot(cross(qp, d1v), r) / denom;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
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
