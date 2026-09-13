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

/** 不一致边界：四折痕顶点扇区角为 70°/110°/60°/120°，
 *  70+60=130 ≠ 180，违反川崎定理；M/V/M/V 各折 60° 时约束无法闭合，必须直接报错。 */
const inconsistentBoundary = {
  file_spec: 1.1,
  frame_title: '不一致边界（违反川崎条件）',
  vertices_coords: [
    // r0=0°, r1=70°, r2=180°, r3=240°, center
    [2, 1],
    [1.3420201433, 1.9396926208],
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
    key: 'inconsistent',
    label: '不一致边界',
    description: '违反川崎条件的四折痕顶点，折叠后共享边无法闭合，应报告未收敛与裂缝。',
    fold: inconsistentBoundary,
  },
];
