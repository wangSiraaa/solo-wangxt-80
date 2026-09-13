/** 工程中央状态：折痕图（非响应式原始对象 + 版本号触发计算）、选择、撤销栈与折叠结果。
 *  FoldGraph 保持为普通数组对象以避免 Vue 深度代理影响几何运算；
 *  通过 bump() 递增版本号，computed 依赖 version 重新求解。 */

import { computed, reactive, ref, shallowRef } from 'vue';
import type { FoldGraph, FoldResult } from '../fold/types';
import { computeFold } from '../fold/engine';
import { exportFold, loadFold } from '../fold/graph';
import { examples } from '../fold/examples';
import {
  deleteProject,
  listProjects,
  newProjectId,
  saveProject,
  type ProjectRecord,
} from './project';

export interface CreaseSnapshot {
  assignment: string;
  angle: number;
  auto: boolean;
}

interface Snapshot {
  title: string;
  creases: CreaseSnapshot[];
  label: string;
}

export type SelectKind = 'edge' | 'face' | null;

export const useOrigamiStore = () => {
  const graph = shallowRef<FoldGraph | null>(null);
  const graphVersion = ref(0);
  const title = ref('未命名');
  const projectId = ref<string>(newProjectId());
  const dirty = ref(false);

  const selection = reactive({ kind: null as SelectKind, index: -1 });

  // 撤销：角度/指派/自动角的每一次提交都是一条快照（滑块连续拖动只产生一条）
  const undoStack = ref<Snapshot[]>([]);
  const redoStack = ref<Snapshot[]>([]);
  let dragSnapshot: Snapshot | null = null;

  const loadProblems = ref<string[]>([]);
  const loadError = ref<string | null>(null);
  const notice = ref<string | null>(null);
  const loadSeq = ref(0);

  const bump = () => {
    graphVersion.value++;
    dirty.value = true;
  };

  const snapshot = (label: string): Snapshot | null => {
    if (!graph.value) return null;
    return {
      title: title.value,
      label,
      creases: graph.value.creases.map((c) => ({
        assignment: c.assignment,
        angle: c.angle,
        auto: c.auto,
      })),
    };
  };

  const pushHistory = (label: string) => {
    const s = snapshot(label);
    if (!s) return;
    undoStack.value.push(s);
    if (undoStack.value.length > 100) undoStack.value.shift();
    redoStack.value = [];
  };

  const restoreSnapshot = (s: Snapshot) => {
    if (!graph.value) return;
    graph.value.creases.forEach((c, i) => {
      c.assignment = s.creases[i].assignment as FoldGraph['creases'][number]['assignment'];
      c.angle = s.creases[i].angle;
      c.auto = s.creases[i].auto;
    });
    title.value = s.title;
    bump();
  };

  const loadFromFold = (raw: unknown, name?: string) => {
    try {
      const loaded = loadFold(raw as never);
      graph.value = loaded.graph;
      title.value = name ?? loaded.title;
      loadProblems.value = loaded.problems;
      loadError.value = null;
      undoStack.value = [];
      redoStack.value = [];
      dragSnapshot = null;
      selection.kind = null;
      selection.index = -1;
      bump();
      loadSeq.value++;
      dirty.value = false;
    } catch (e) {
      loadError.value = (e as Error).message;
    }
  };

  const loadExample = (key: string) => {
    const ex = examples.find((x) => x.key === key);
    if (!ex) return;
    projectId.value = newProjectId();
    loadFromFold(structuredClone(ex.fold));
  };

  // ---- 选择（2D / 3D 同步）----
  const select = (kind: SelectKind, index: number) => {
    selection.kind = kind;
    selection.index = index;
  };
  const clearSelection = () => {
    selection.kind = null;
    selection.index = -1;
  };

  // ---- 折痕编辑 ----
  const beginInteraction = (label: string) => {
    // 一次连续拖动开始时记录“修改前”状态，提交时入栈
    if (!dragSnapshot) dragSnapshot = snapshot(label);
  };
  const commitInteraction = () => {
    if (dragSnapshot) {
      undoStack.value.push(dragSnapshot);
      if (undoStack.value.length > 100) undoStack.value.shift();
      redoStack.value = [];
      dragSnapshot = null;
    }
  };
  const cancelInteraction = () => {
    dragSnapshot = null;
  };

  /** 滑块实时更新角度（不入栈，配合 begin/commit）。 */
  const setAngleLive = (edge: number, angleDeg: number) => {
    if (!graph.value) return;
    const c = graph.value.creases[edge];
    c.angle = (Math.min(180, Math.max(0, angleDeg)) * Math.PI) / 180;
    if (c.auto) c.auto = false; // 手动指定即取消自动求解
    bump();
  };

  const setAssignment = (edge: number, assignment: string) => {
    if (!graph.value) return;
    pushHistory(`折痕 ${edge} 指派为 ${assignment}`);
    const c = graph.value.creases[edge];
    c.assignment = assignment as FoldGraph['creases'][number]['assignment'];
    if ((assignment === 'B' || assignment === 'F') && c.angle !== 0) c.angle = 0;
    if ((assignment === 'M' || assignment === 'V') && c.angle === 0) c.angle = Math.PI / 3;
    bump();
  };

  const toggleAuto = (edge: number) => {
    if (!graph.value) return;
    pushHistory(`折痕 ${edge} 自动角切换`);
    graph.value.creases[edge].auto = !graph.value.creases[edge].auto;
    bump();
  };

  const renameTitle = (name: string) => {
    title.value = name;
    dirty.value = true;
  };

  const undo = () => {
    const s = undoStack.value.pop();
    if (!s) return;
    redoStack.value.push(snapshot('redo')!);
    restoreSnapshot(s);
  };
  const redo = () => {
    const s = redoStack.value.pop();
    if (!s) return;
    undoStack.value.push(snapshot('undo')!);
    restoreSnapshot(s);
  };

  const resetFlat = () => {
    if (!graph.value) return;
    pushHistory('恢复平面状态');
    graph.value.creases.forEach((c) => {
      c.angle = 0;
    });
    bump();
  };

  // ---- 折叠结果（依赖版本号自动重算）----
  const foldResult = computed<FoldResult | null>(() => {
    void graphVersion.value;
    if (!graph.value) return null;
    return computeFold(graph.value);
  });

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  // ---- 导入导出 / 工程 ----
  const buildExport = (keepFold: boolean): unknown => {
    if (!graph.value) return null;
    return exportFold(graph.value, title.value, keepFold);
  };

  const exportJson = (keepFold: boolean) => {
    const data = buildExport(keepFold);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.value || 'fold'}${keepFold ? '' : '-平面'}.fold`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    projectId.value = newProjectId();
    loadFromFold(JSON.parse(text), file.name.replace(/\.[^.]+$/, ''));
  };

  const saveToIndexedDb = async () => {
    if (!graph.value) return;
    const rec: ProjectRecord = {
      id: projectId.value,
      title: title.value,
      updatedAt: Date.now(),
      fold: buildExport(true),
    };
    await saveProject(rec);
    dirty.value = false;
    notice.value = '已保存到本地浏览器（IndexedDB）';
    setTimeout(() => (notice.value = null), 2500);
  };

  const loadFromDb = async (id: string) => {
    const all = await listProjects();
    const rec = all.find((r) => r.id === id);
    if (!rec) return;
    projectId.value = rec.id;
    loadFromFold(structuredClone(rec.fold), rec.title);
  };

  return {
    // 解包的响应式状态（在普通对象上通过 getter 保持响应性，组件中无需 .value）
    get graph() {
      return graph.value;
    },
    graphVersion,
    get title() {
      return title.value;
    },
    get projectId() {
      return projectId.value;
    },
    get dirty() {
      return dirty.value;
    },
    get loadProblems() {
      return loadProblems.value;
    },
    get loadError() {
      return loadError.value;
    },
    get notice() {
      return notice.value;
    },
    get loadSeq() {
      return loadSeq.value;
    },
    foldResult,
    get canUndo() {
      return canUndo.value;
    },
    get canRedo() {
      return canRedo.value;
    },
    selection,
    loadExample,
    loadFromFold,
    importFile,
    select,
    clearSelection,
    setAngleLive,
    beginInteraction,
    commitInteraction,
    cancelInteraction,
    setAssignment,
    toggleAuto,
    renameTitle,
    undo,
    redo,
    resetFlat,
    exportJson,
    saveToIndexedDb,
    loadFromDb,
    listProjects,
    deleteProject,
  };
};

export type OrigamiStore = ReturnType<typeof useOrigamiStore>;
