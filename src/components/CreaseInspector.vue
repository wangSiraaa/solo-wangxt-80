<template>
  <div class="inspector">
    <h3>折痕属性</h3>
    <template v-if="edge >= 0 && crease">
      <div class="row">
        <span class="label">折痕 #{{ edge }}</span>
        <span class="id">身份：{{ crease.id }}</span>
      </div>
      <div class="row assign">
        <label
          v-for="opt in assignments"
          :key="opt.value"
          :class="['opt', 'opt-' + opt.value, { active: crease.assignment === opt.value }]"
        >
          <input
            type="radio"
            :value="opt.value"
            :checked="crease.assignment === opt.value"
            @change="store.setAssignment(edge, opt.value)"
          />
          {{ opt.label }}
        </label>
      </div>

      <div class="row angle">
        <div class="angle-head">
          <label>折叠角（两面间二面角 = {{ (180 - angleDeg).toFixed(0) }}°）</label>
          <input
            class="num"
            type="number"
            min="0"
            max="180"
            step="1"
            :value="angleDeg"
            @change="onNum($event)"
          />
        </div>
        <input
          class="slider"
          type="range"
          min="0"
          max="180"
          step="0.5"
          :value="angleDeg"
          :disabled="crease.auto"
          @pointerdown="onSliderDown"
          @input="onSlider($event)"
        />
      </div>

      <label class="row auto">
        <input type="checkbox" :checked="crease.auto" @change="store.toggleAuto(edge)" />
        角度由约束求解器决定（自动角）
      </label>
      <p class="hint">
        提示：山折红虚线、谷折蓝线；多条折痕在同一顶点闭合时，可将一条设为自动角由求解器反解。
      </p>
    </template>
    <p v-else class="hint">在平面或空间视图中点选一条折痕，标记山折 / 谷折并调整角度。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';
import type { OrigamiStore } from '../store/useOrigami';

const props = defineProps<{ store: OrigamiStore }>();
const store = props.store;

const assignments = [
  { value: 'M', label: '山折 M' },
  { value: 'V', label: '谷折 V' },
  { value: 'B', label: '边界 B' },
  { value: 'F', label: '保持平 F' },
  { value: 'U', label: '未指派 U' },
] as const;

const edge = computed(() =>
  store.selection.kind === 'edge' ? store.selection.index : -1,
);
const crease = computed(() =>
  edge.value >= 0 ? store.graph?.creases[edge.value] : null,
);
const angleDeg = computed(() =>
  crease.value ? (crease.value.angle * 180) / Math.PI : 0,
);

const onSliderDown = () => {
  store.beginInteraction('调整折痕角度');
  // 在滑块外松手也保证提交或取消，避免悬而未决的撤销快照
  const finish = () => {
    store.commitInteraction();
    window.removeEventListener('pointerup', finish);
  };
  window.addEventListener('pointerup', finish);
};
const onSlider = (e: Event) => {
  const v = Number((e.target as HTMLInputElement).value);
  store.setAngleLive(edge.value, v);
};
const onNum = (e: Event) => {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  store.beginInteraction('输入折痕角度');
  store.setAngleLive(edge.value, v);
  store.commitInteraction();
};

onBeforeUnmount(() => store.cancelInteraction());
</script>

<style scoped>
.inspector {
  padding: 12px 14px;
  border-top: 1px solid #e4e7ec;
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #344054;
}
.row {
  margin-bottom: 10px;
}
.label {
  font-weight: 600;
  color: #1d2939;
}
.id {
  float: right;
  font-size: 11px;
  color: #98a2b3;
  font-family: monospace;
}
.assign {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.opt {
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
}
.opt input {
  display: none;
}
.opt.active {
  border-color: currentColor;
  background: currentColor;
}
.opt-M { color: #d8322f; }
.opt-V { color: #2f6fd8; }
.opt-B { color: #222831; }
.opt-F { color: #9aa4b2; }
.opt-U { color: #3f9d6b; }
.opt.active {
  color: #fff;
}
.angle-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #475467;
  margin-bottom: 4px;
}
.num {
  width: 52px;
}
.slider {
  width: 100%;
}
.auto {
  font-size: 12px;
  color: #475467;
  display: flex;
  gap: 6px;
  align-items: center;
}
.hint {
  font-size: 11px;
  color: #98a2b3;
  margin: 6px 0 0;
  line-height: 1.5;
}
</style>
