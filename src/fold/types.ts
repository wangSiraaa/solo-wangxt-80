/** 折痕身份与折痕图核心数据结构。
 *  所有数组以索引作为身份；自定义身份额外存放在 creaseIds 中，导出/导入保持不变。 */

/** FOLD 折痕指派（assignment）。本工具主要使用 B/M/V/F/U。 */
export type CreaseAssignment = 'B' | 'M' | 'V' | 'F' | 'U';

export interface Vec2 {
  x: number;
  y: number;
}

/** 一条边（折痕 / 边界 / 辅助线）的可变属性。 */
export interface CreaseInfo {
  /** 0~π 的折叠量（两面之间的二面角为 π - magnitude） */
  angle: number;
  assignment: CreaseAssignment;
  /** 为 true 时角度由约束求解器决定，用户不直接指定 */
  auto: boolean;
  /** 稳定身份（导出的 x_fold_crease_id），默认用索引字符串 */
  id: string;
}

/** 归一化后的折痕图：顶点/边/面均为普通数组，避免被 Vue 深度代理影响几何运算。 */
export interface FoldGraph {
  /** 顶点平面坐标 */
  vertices: [number, number][];
  /** 边的两个端点 */
  edgesVertices: [number, number][];
  /** 每个面的顶点环（已按逆时针排列，可能是任意凸/凹多边形） */
  facesVertices: number[][];
  /** 每条边邻接的面（0、1 或 2 个） */
  edgesFaces: (number | null)[][];
  /** 每条边在各邻接面环中的有向形式 [面索引, 起点, 终点] */
  edgesFacesOrient: { face: number; a: number; b: number }[][];
  /** 每个面的每条环边对应的边索引 */
  facesEdges: number[][];
  /** 边属性，长度等于 edgesVertices.length */
  creases: CreaseInfo[];
}

/** 约束求解 / 折叠计算的结果诊断。 */
export interface FoldIssue {
  kind: 'boundaryConflict' | 'disconnected' | 'nonConverged' | 'selfIntersection';
  message: string;
}

/** 共享边两端的闭合误差（相邻面不能裂开的约束）。 */
export interface ClosureGap {
  edge: number;
  /** 边两端点在两个面片各自世界坐标下的最大距离 */
  gap: number;
}

export interface IntersectingPair {
  faceA: number;
  faceB: number;
}

export interface FoldResult {
  /** 每个面的 4x4 刚体变换（列主序展平，与 THREE.Matrix4 一致） */
  transforms: number[][];
  /** 每个面的世界顶点（沿其环顺序） */
  faceWorldVerts: [number, number, number][][];
  /** 每个面三角化后的顶点索引（基于 faceWorldVerts，三元组） */
  faceTriangles: number[][][];
  closureGaps: ClosureGap[];
  intersections: IntersectingPair[];
  /** 近共面接触候选面片对（零厚度表面距离 ≤ 阈值，非穿透） */
  contacts: ContactPair[];
  /** 求解后自动边的角度（与输入顺序对应） */
  solvedAngles: Record<number, number>;
  converged: boolean;
  iterations: number;
  residual: number;
  issues: FoldIssue[];
  /** 结构上是否为一整张相连纸片（加载时一次性判定） */
  connected: boolean;
}

export interface ContactPair {
  faceA: number;
  faceB: number;
  /** 两面片间的最小距离 */
  distance: number;
}

/**
 * 一次完整的折角构型：每条边的“有向折叠角”（M 正 V 负），
 * 以及该构型中由求解器决定的自动边集合。运动路径只生成/保存构型，
 * 不触碰工程源折痕的 assignment / 默认角度。
 */
export interface FoldConfiguration {
  /** 长度等于边数，弧度，有向 */
  signedAngles: number[];
  /** 求解器负责的自动边 */
  autoEdges: number[];
}
