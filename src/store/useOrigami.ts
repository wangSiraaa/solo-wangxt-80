/** 工程中央状态：折痕图（非响应式原始对象 + 版本号触发计算）、选择、撤销栈与折叠结果。
 *  FoldGraph 保持为普通数组对象以避免 Vue 深度代理影响几何运算；
 *  通过 bump() 递增版本号，computed 依赖 version 重新求解。 */

import { computed, reactive, ref, shallowRef } from 'vue';
import type { FoldConfiguration, FoldGraph, FoldResult } from '../fold/types';
import { computeFold, evaluateConfiguration } from '../fold/engine';
import { exportFold, loadFold } from '../fold/graph';
import { examples } from '../fold/examples';
import { CLOSURE_TOLERANCE } from '../fold/solver';
import {
  buildTarget,
  deserializePath,
  runContinuation,
  serializePath,
  type MotionPath,
  type StopReason,
} from '../fold/continuation';
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

  // 运动路径：路径构型独立于源折痕，视图在回放时覆盖静态结果
  const paths = shallowRef<MotionPath[]>([]);
  const activePathId = ref<string | null>(null);
  const activeStepIdx = ref(0);
  const pathRunning = ref(false);
  const pathProgress = ref(0);
  const pathStopReason = ref<StopReason | null>(null);
  const pathMessage = ref<string | null>(null);
  let cancelPaths = false;
  /** 运动模式下固定角的折痕集合（路径目标的固定边），用于角面板只读展示 */
  const pinnedEdges = ref<number[]>([]);

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
      // 重放随工程保存的路径
      const restored = Array.isArray(loaded.paths)
        ? loaded.paths
            .map((p) => {
              try {
                return deserializePath(p as never, loaded.graph);
              } catch {
                return null;
              }
            })
            .filter((p): p is MotionPath => p !== null)
        : [];
      paths.value = restored;
      activePathId.value = restored[0]?.id ?? null;
      activeStepIdx.value = restored[0] ? restored[0].steps.length - 1 : 0;
      pathStopReason.value = null;
      pinnedEdges.value = [];
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

  // ---- 运动路径（延续）----
  const activePath = computed<MotionPath | null>(
    () => paths.value.find((p) => p.id === activePathId.value) ?? null,
  );

  /** 当前应展示的构型：路径回放时取路径步，否则用源折痕静态结果。 */
  const displayedConfig = computed<FoldConfiguration | null>(() => {
    const p = activePath.value;
    if (p) {
      const idx = Math.min(activeStepIdx.value, p.steps.length - 1);
      return p.steps[Math.max(0, idx)]?.config ?? null;
    }
    return null;
  });

  /** 运行一条新路径。fixedEdges 为用户固定目标角的折痕；goalDeg 为各自目标角度。
   *  branchBias ∈ [-1,1] 控制平展处分岔点的分支探测偏置（0 = 最小角变化的平滑分支）。 */
  const runPath = async (opts: {
    label: string;
    fixedEdges: number[];
    goalDeg: Record<number, number>;
    branchBias?: number;
    maxStepDeg?: number;
  }) => {
    if (!graph.value || pathRunning.value) return;
    const g = graph.value;
    const target = buildTarget(g, opts.fixedEdges, opts.goalDeg);
    // 分支种子：沿各自动边的山/谷符号方向施加偏置（平展奇异点的分岔选择）
    const bias = opts.branchBias ?? 0;
    const seed = target.autoEdges.map((e) =>
      (g.creases[e].assignment === 'V' ? -1 : 1) * bias * 1.2,
    );
    pinnedEdges.value = opts.fixedEdges.slice();
    pathRunning.value = true;
    pathStopReason.value = null;
    pathMessage.value = null;
    pathProgress.value = 0;
    cancelPaths = false;

    const path = await runContinuation(g, target, {
      label: opts.label,
      branchSeed: seed,
      maxStepAngle: ((opts.maxStepDeg ?? 10) * Math.PI) / 180,
      shouldCancel: () => cancelPaths,
      yieldEvery: 1,
      onStep: (s) => {
        pathProgress.value = s.t;
      },
    });
    const list = paths.value.slice();
    list.push(path);
    paths.value = list;
    activePathId.value = path.id;
    activeStepIdx.value = path.steps.length - 1;
    pathRunning.value = false;
    pathProgress.value = path.steps[path.steps.length - 1]?.t ?? 0;
    pathStopReason.value = path.stopReason;
    pathMessage.value = stopMessage(path.stopReason, path);
    bump();
    return path;
  };

  const cancelRunningPath = () => {
    cancelPaths = true;
  };

  const selectPath = (id: string | null) => {
    activePathId.value = id;
    const p = paths.value.find((x) => x.id === id);
    activeStepIdx.value = p ? p.steps.length - 1 : 0;
    pinnedEdges.value = p
      ? p.target.signedAngles
          .map((a, e) => ({ a, e }))
          .filter(({ a, e }) => a !== 0 && !p.target.autoEdges.includes(e))
          .map(({ e }) => e)
      : [];
    bump();
  };

  const removePath = (id: string) => {
    paths.value = paths.value.filter((p) => p.id !== id);
    if (activePathId.value === id) {
      activePathId.value = paths.value[0]?.id ?? null;
      activeStepIdx.value = paths.value[0] ? paths.value[0].steps.length - 1 : 0;
    }
    bump();
  };

  const setPlaybackStep = (idx: number) => {
    const p = activePath.value;
    if (!p) return;
    activeStepIdx.value = Math.min(Math.max(0, idx), p.steps.length - 1);
    bump();
  };

  const addKeyframe = (label: string) => {
    const p = activePath.value;
    if (!p) return;
    const step = activeStepIdx.value;
    if (p.keyframes.includes(step)) return;
    const meta = [...p.keyframeMeta, { step, label, t: p.steps[step].t }].sort(
      (a, b) => a.step - b.step,
    );
    const keyframes = [...p.keyframes, step].sort((a, b) => a - b);
    // MotionPath 不做深度响应式：用新对象替换并整体替换 paths 数组，保证立即刷新
    const updated: MotionPath = { ...p, keyframes, keyframeMeta: meta };
    paths.value = paths.value.map((x) => (x.id === p.id ? updated : x));
    bump();
  };

  const jumpKeyframe = (step: number) => setPlaybackStep(step);

  const exitPathMode = () => {
    activePathId.value = null;
    activeStepIdx.value = 0;
    pinnedEdges.value = [];
    pathMessage.value = null;
    bump();
  };

  function stopMessage(reason: StopReason, p: MotionPath): string {
    const end = p.steps[p.steps.length - 1];
    switch (reason) {
      case 'reached-target':
        return `路径「${p.label}」到达目标折角（${p.steps.length} 步）。`;
      case 'infeasible':
        return `路径「${p.label}」在 ${(end.t * 100).toFixed(0)}% 处失去可行解，已停在最后可靠位置。`;
      case 'self-intersection':
        return `路径「${p.label}」在 ${(end.t * 100).toFixed(0)}% 处发生面片穿透，已停止。`;
      case 'cancelled':
        return `路径「${p.label}」计算被取消，保留 ${p.steps.length} 个已接受步。`;
      default:
        return `路径「${p.label}」达到步数上限。`;
    }
  }

  // ---- 折叠结果（依赖版本号自动重算）----
  const foldResult = computed<FoldResult | null>(() => {
    void graphVersion.value;
    if (!graph.value) return null;
    const p = activePath.value;
    if (p) {
      const idx = Math.min(activeStepIdx.value, p.steps.length - 1);
      const step = p.steps[Math.max(0, idx)];
      // 路径回放：用保存步的残差与统一容差判定收敛，保证与延续接受时一致
      return evaluateConfiguration(graph.value, step.config, {
        converged: step.residual <= p.closureTolerance,
        solveResidual: step.residual,
        iterations: step.iterations,
      });
    }
    return computeFold(graph.value);
  });

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  // ---- 导入导出 / 工程 ----
  const buildExport = (keepFold: boolean): unknown => {
    if (!graph.value) return null;
    const serialized = paths.value.map((p) => serializePath(p));
    return exportFold(graph.value, title.value, keepFold, serialized);
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
    get displayedConfig() {
      return displayedConfig.value;
    },
    get paths() {
      return paths.value;
    },
    get activePath() {
      return activePath.value;
    },
    get activePathId() {
      return activePathId.value;
    },
    get activeStepIdx() {
      return activeStepIdx.value;
    },
    get pathRunning() {
      return pathRunning.value;
    },
    get pathProgress() {
      return pathProgress.value;
    },
    get pathStopReason() {
      return pathStopReason.value;
    },
    get pathMessage() {
      return pathMessage.value;
    },
    get pinnedEdges() {
      return pinnedEdges.value;
    },
    get inPathMode() {
      return activePathId.value !== null;
    },
    closureTolerance: CLOSURE_TOLERANCE,
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
    runPath,
    cancelRunningPath,
    selectPath,
    removePath,
    setPlaybackStep,
    addKeyframe,
    jumpKeyframe,
    exitPathMode,
  };
};

export type OrigamiStore = ReturnType<typeof useOrigamiStore>;
