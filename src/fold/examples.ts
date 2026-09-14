/** 内置示例。坐标平面 z=0，折痕角以 FOLD 的 edges_foldAngle（度，M 正 V 负）保存，
 *  自动折痕标记放在自定义命名空间 x_origami_preview_crease_auto。 */

export interface ExampleDef {
  key: string;
  label: string;
  description: string;
  fold: Record<string, unknown>;
}

const NS = 'x_origami_preview';

/** 单折：矩形书页，一条山折。 */
const singleCrease = {
  file_spec: 1.1,
  frame_title: '单折（书页）',
  vertices_coords: [
    [0, 0],
    [2, 0],
    [2, 1],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  edges_vertices: [
    [0, 4],
    [4, 1],
    [1, 2],
    [2, 5],
    [5, 3],
    [3, 0],
    [4, 5],
  ],
  edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'M'],
  edges_foldAngle: [0, 0, 0, 0, 0, 0, 60],
  faces_vertices: [
    [0, 4, 5, 3],
    [4, 1, 2, 5],
  ],
  [`${NS}_crease_auto`]: [false, false, false, false, false, false, false],
};

/** 四折痕顶点：方形中心顶点，扇区角 60°/120° 交替（满足川崎 60+120=180）。
 *  山/谷按前川型 3M1V 指派；三条折痕给定角度，第四条标 auto 由约束求解，
 *  可连续折叠且不自交。 */
const degreeFourVertex = {
  file_spec: 1.1,
  frame_title: '四折痕顶点（可折）',
  // 外顶点：r0=0°, r1=60°, r2=180°, r3=240°
  vertices_coords: [
    [2, 1],
    [1.5, 1.8660254038],
    [0, 1],
    [0.5, 0.1339745962],
    [1, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
  ],
  edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'V', 'M'],
  edges_foldAngle: [0, 0, 0, 0, 0, 147.7958, 60, 60],
  faces_vertices: [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ],
  // 自动角边 4 在生成树内，固定角边 5/6/7 构成其余三边，边 7 为闭环；
  // 沿 1 自由度闭合曲线，求解器反解出边 4 ≈ 60°（关系 a4≈a6）。
  [`${NS}_crease_auto`]: [false, false, false, false, true, false, false, false],
};

/** 不一致边界：四折痕顶点扇区角为 45°/95°/65°/155°，
 *  45+65=110 ≠ 180，违反川崎定理且无任何一对折痕共线；
 *  从平展出发的运动延续必然在离开平展不远后失去可行解。 */
const inconsistentBoundary = {
  file_spec: 1.1,
  frame_title: '不一致边界（违反川崎条件）',
  vertices_coords: [
    // r0=0°, r1=45°, r2=140°, r3=205°, center
    [2.2, 1],
    [1.8485281374, 1.8485281374],
    [0.0807564050, 1.7713451489],
    [-0.0875694630, 0.4928661649],
    [1, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 0],
    [4, 1],
    [4, 2],
    [4, 3],
  ],
  edges_assignment: ['B', 'B', 'B', 'B', 'M', 'V', 'M', 'V'],
  edges_foldAngle: [0, 0, 0, 0, 60, -60, 60, -60],
  faces_vertices: [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ],
  [`${NS}_crease_auto`]: [false, false, false, false, false, false, false, false],
};

/** Miura 双顶点联动：一条直折痕穿过两个度-4 顶点（扇区 135°/45° 交替，
 *  满足川崎），两顶点共享中央折痕，一个顶点选择运动分支后另一个被带动。
 *  指派：直折痕族（边 6/7/8）为山，之字折痕（边 9-12）为谷，2M2V 型。 */
const miuraTwoVertex = {
  file_spec: 1.1,
  frame_title: 'Miura 双顶点联动',
  // a(0,0) b(4,0) c(4,2) d(0,2) e(0,1) f(4,1) v1(1,1) v2(3,1)
  vertices_coords: [
    [0, 0], [4, 0], [4, 2], [0, 2],
    [0, 1], [4, 1], [1, 1], [3, 1],
  ],
  edges_vertices: [
    [0, 1], [1, 5], [5, 2], [2, 3], [3, 4], [4, 0], // 边界（e/f 分割左右边）
    [4, 6], [6, 7], [7, 5], // 直折痕族
    [0, 6], [6, 3], [1, 7], [7, 2], // 之字折痕
  ],
  edges_assignment: [
    'B', 'B', 'B', 'B', 'B', 'B',
    'V', 'V', 'V',
    'M', 'V', 'M', 'M',
  ],
  edges_foldAngle: new Array(13).fill(0),
  faces_vertices: [
    [0, 1, 7, 6],
    [1, 5, 7],
    [5, 2, 7],
    [2, 3, 6, 7],
    [3, 4, 6],
    [4, 0, 6],
  ],
};

/** 近共面接触：三页等宽条带，两条铰链都折到约 180°，两侧外页在中页同侧
 *  完全贴合。无穿透，但产生距离≈0 的“无厚度接触候选”（不是材料叠层）。 */
const coplanarContact = {
  file_spec: 1.1,
  frame_title: '近共面接触（三页）',
  vertices_coords: [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1],
  ],
  edges_vertices: [
    [0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ],
  edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'M', 'B'],
  edges_foldAngle: [0, 0, 0, 0, 0, 0, 0, 180, 180, 0],
  faces_vertices: [
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
  ],
};

export const examples: ExampleDef[] = [
  {
    key: 'single',
    label: '单折示例',
    description: '矩形书页，一条山折铰链，两片刚性面共享折痕。',
    fold: singleCrease,
  },
  {
    key: 'degree4',
    label: '四折痕顶点',
    description: '满足川崎条件的中心顶点；山/谷交替，一条折痕角度由约束求解。',
    fold: degreeFourVertex,
  },
  {
    key: 'miura2',
    label: 'Miura 双顶点联动',
    description: '两个度-4 顶点联动的之字网格；沿平展逐步延续跟踪运动分支，避免突然翻面。',
    fold: miuraTwoVertex,
  },
  {
    key: 'contact3',
    label: '近共面接触（三页）',
    description: '两外页折到中页同侧完全贴合：无穿透，但面片对作为无厚度接触候选出现。',
    fold: coplanarContact,
  },
  {
    key: 'inconsistent',
    label: '不一致边界',
    description: '违反川崎条件的四折痕顶点：可做三维刚性折叠但无法折到扁平态，固定角冲突时延续会停止。',
    fold: inconsistentBoundary,
  },
];
