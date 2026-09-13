<template>
  <div class="paths">
    <h3>运动路径（从平展逐步延续）</h3>

    <div class="launcher">
      <div class="target-row">
        <label class="target-angle">
          所选折痕 #{{ selectedEdge ?? '—' }}目标角
          <input
            type="number"
            min="0"
            max="179"
            step="1"
            v-model.number="goalDeg"
            :disabled="selectedEdge < 0"
          />°
        </label>
      </div>
      <label class="seed-row">
        分支偏移
        <input type="range" min="-1" max="1" step="0.1" v-model.number="branchBias" />
        <span class="seed-val">{{ branchBias.toFixed(1) }}</span>
      </label>
      <div class="launch-btns">
        <button class="btn primary" :disabled="!canLaunch" @click="launch()">
          沿新路径延续
        </button>
        <button class="btn" :disabled="!store.pathRunning" @click="store.cancelRunningPath()">
          取消计算
        </button>
      </div>
      <p v-if="selectedEdge < 0" class="hint">先在平面或空间视图选择一条折痕作为固定驱动；其余折痕自动求解。</p>
      <div v-if="store.pathRunning" class="progress">
        <div class="bar"><div class="fill" :style="{ width: store.pathProgress * 100 + '%' }" /></div>
        延续中 {{ (store.pathProgress * 100).toFixed(0) }}%
      </div>
      <p v-if="store.pathMessage" class="stopmsg">{{ store.pathMessage }}</p>
    </div>

    <ul v-if="store.paths.length" class="path-list">
      <li
        v-for="p in store.paths"
        :key="p.id"
        :class="{ active: p.id === store.activePathId }"
      >
        <button class="pname" @click="store.selectPath(p.id)">
          <span class="plabel">{{ p.label }}</span>
          <span :class="['stop', stopClass(p.stopReason)]">{{ stopLabel(p.stopReason) }}</span>
          <span class="meta">
            {{ p.steps.length }} 步 · t={{ p.steps.at(-1)!.t.toFixed(2) }}
            · 残差 {{ (p.steps.at(-1)!.residual ?? 0).toExponential(1) }}
          </span>
          <span class="branch" :title="p.branchSignature.join(' ')">
            分支：{{ p.branchId || '平展' }}
          </span>
        </button>
        <button class="del" title="删除路径" @click="store.removePath(p.id)">×</button>
      </li>
    </ul>

    <template v-if="store.activePath">
      <div class="playback">
        <div class="branch-row">
          分支身份 <code>{{ store.activePath.branchId || '平展' }}</code>
          <span v-if="store.activePath.branchSignature.length">
            （先动 {{ store.activePath.branchSignature.join('、') }}）
          </span>
        </div>
        <div class="pb-head">
          <button class="btn sm" @click="step(-1)">◀</button>
          <input
            class="scrub"
            type="range"
            min="0"
            :max="store.activePath.steps.length - 1"
            step="1"
            :value="store.activeStepIdx"
            @input="onScrub"
          />
          <button class="btn sm" @click="step(1)">▶</button>
        </div>
        <div class="pb-info">
          t={{ currentStep?.t.toFixed(3) }} · 残差 {{ (currentStep?.residual ?? 0).toExponential(1) }}
          / 可接受 ≤ {{ store.closureTolerance.toExponential(1) }}
          <span :class="stepClosed ? 'ok-tag' : 'bad-tag'">
            {{ stepClosed ? '已闭合' : '未闭合' }}
          </span>
          <span v-if="currentStep?.result.intersections.length" class="bad">穿透 {{ currentStep.result.intersections.length }}</span>
        </div>
        <div class="pb-actions">
          <button class="btn sm" @click="togglePlay">{{ playing ? '暂停' : '播放' }}</button>
          <button class="btn sm" @click="addKf">保存关键帧</button>
          <button class="btn sm" @click="store.exitPathMode()">退出路径模式</button>
        </div>
        <div v-if="store.activePath.keyframeMeta.length" class="keyframes">
          <button
            v-for="k in store.activePath.keyframeMeta"
            :key="k.step"
            class="kf"
            @click="store.jumpKeyframe(k.step)"
          >
            ★ {{ k.label }} · t={{ k.t.toFixed(2) }}
          </button>
        </div>
      </div>

      <div v-if="(currentStep?.result.contacts.length ?? 0) > 0" class="contacts">
        <div class="sub">近共面 / 接触候选（无厚度表面距离，非穿透）</div>
        <button
          v-for="(c, i) in currentStep!.result.contacts.slice(0, 6)"
          :key="i"
          class="contact"
          @click="store.select('face', c.faceA)"
        >
          面 #{{ c.faceA }}↔#{{ c.faceB }}：{{ c.distance.toExponential(1) }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { OrigamiStore } from '../store/useOrigami';
import type { StopReason } from '../fold/continuation';

const props = defineProps<{ store: OrigamiStore }>();
const store = props.store;

const goalDeg = ref(60);
const branchBias = ref(0);
const playing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const togglePlay = () => {
  if (!store.activePath) return;
  playing.value = !playing.value;
  if (playing.value) {
    if (store.activeStepIdx >= store.activePath.steps.length - 1) store.setPlaybackStep(0);
    timer = setInterval(() => {
      const p = store.activePath;
      if (!p) return;
      if (store.activeStepIdx >= p.steps.length - 1) {
        playing.value = false;
        if (timer) clearInterval(timer);
        return;
      }
      store.setPlaybackStep(store.activeStepIdx + 1);
    }, 90);
  } else if (timer) {
    clearInterval(timer);
  }
};

watch(
  () => store.activePathId,
  () => {
    playing.value = false;
    if (timer) clearInterval(timer);
  },
);
onBeforeUnmount(() => timer && clearInterval(timer));

const selectedEdge = computed(() =>
  store.selection.kind === 'edge' ? store.selection.index : -1,
);
const canLaunch = computed(
  () => selectedEdge.value >= 0 && !store.pathRunning && !!store.graph,
);

const launch = async () => {
  const e = selectedEdge.value;
  if (e < 0) return;
  await store.runPath({
    label: `路径 ${store.paths.length + 1}（边#${e} → ${goalDeg.value}°）`,
    fixedEdges: [e],
    goalDeg: { [e]: goalDeg.value },
    branchBias: branchBias.value,
  });
};

const currentStep = computed(() => {
  const p = store.activePath;
  return p ? p.steps[Math.min(store.activeStepIdx, p.steps.length - 1)] : null;
});

const onScrub = (e: Event) =>
  store.setPlaybackStep(Number((e.target as HTMLInputElement).value));
const step = (d: number) => store.setPlaybackStep(store.activeStepIdx + d);
const addKf = () => store.addKeyframe(`t=${(currentStep.value?.t ?? 0).toFixed(2)}`);

const stepClosed = computed(() => {
  const s = currentStep.value;
  const p = store.activePath;
  return !!s && !!p && s.residual <= p.closureTolerance;
});

const stopLabel = (r: StopReason): string => {
  switch (r) {
    case 'reached-target': return '到达目标';
    case 'infeasible': return '失去可行解';
    case 'self-intersection': return '面片穿透';
    case 'cancelled': return '已取消';
    default: return '步数上限';
  }
};
const stopClass = (r: StopReason) => (r === 'reached-target' ? 'ok' : 'warn');
</script>

<style scoped>
.paths {
  padding: 12px 14px;
  border-top: 1px solid #e4e7ec;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #344054;
}
.target-row, .launch-btns {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.target-angle {
  font-size: 12px;
  color: #475467;
  display: flex;
  align-items: center;
  gap: 6px;
}
.target-angle input {
  width: 56px;
  padding: 3px 5px;
}
.seed-row {
  font-size: 12px;
  color: #475467;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.seed-row input {
  flex: 1;
}
.seed-val {
  width: 30px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.btn {
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid #d0d5dd;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
}
.btn.primary {
  background: #2f6fd8;
  color: #fff;
  border-color: #2f6fd8;
}
.btn.sm {
  padding: 3px 7px;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.hint {
  font-size: 11px;
  color: #98a2b3;
  margin: 4px 0 0;
}
.progress {
  font-size: 11px;
  color: #475467;
  margin-top: 6px;
}
.bar {
  height: 5px;
  background: #eef0f3;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 3px;
}
.fill {
  height: 100%;
  background: #2f6fd8;
  transition: width 0.1s linear;
}
.stopmsg {
  font-size: 11px;
  color: #b54708;
  background: #fffaeb;
  padding: 5px 7px;
  border-radius: 5px;
  margin: 6px 0 0;
  line-height: 1.5;
}
.path-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.path-list li {
  display: flex;
  align-items: center;
  border-radius: 6px;
}
.path-list li.active {
  background: #eef3f9;
}
.pname {
  flex: 1;
  background: none;
  border: none;
  text-align: left;
  padding: 6px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.plabel {
  font-weight: 600;
}
.branch {
  font-size: 10px;
  color: #1d4e89;
  font-family: monospace;
  word-break: break-all;
}
.branch-row {
  font-size: 11px;
  color: #475467;
  margin-bottom: 5px;
  line-height: 1.5;
}
.branch-row code {
  background: #f0f6ff;
  color: #1d4e89;
  padding: 1px 5px;
  border-radius: 4px;
}
.ok-tag {
  color: #1a7f37;
  margin-left: 6px;
  font-weight: 600;
}
.bad-tag {
  color: #b54708;
  margin-left: 6px;
  font-weight: 600;
}
.stop {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  width: fit-content;
}
.stop.ok {
  color: #1a7f37;
  background: #e9f7ef;
}
.stop.warn {
  color: #b54708;
  background: #fffaeb;
}
.meta {
  font-size: 10px;
  color: #98a2b3;
}
.del {
  border: none;
  background: none;
  color: #98a2b3;
  font-size: 15px;
  cursor: pointer;
  padding: 0 8px;
}
.playback {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed #e4e7ec;
}
.pb-head {
  display: flex;
  gap: 6px;
  align-items: center;
}
.scrub {
  flex: 1;
}
.pb-info {
  font-size: 11px;
  color: #667085;
  margin: 5px 0;
}
.pb-info .bad {
  color: #b42318;
  margin-left: 8px;
}
.pb-actions {
  display: flex;
  gap: 6px;
}
.keyframes {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.kf {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid #e4b94d;
  background: #fffaeb;
  cursor: pointer;
}
.contacts {
  margin-top: 8px;
}
.sub {
  font-size: 11px;
  color: #475467;
  margin-bottom: 4px;
}
.contact {
  display: inline-block;
  margin: 0 5px 5px 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid #b8cfe8;
  color: #1d4e89;
  background: #f0f6ff;
  cursor: pointer;
}
</style>
