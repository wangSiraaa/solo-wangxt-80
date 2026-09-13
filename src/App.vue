<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="logo">◢</span> 折纸预览器
        <span class="subtitle">无厚度 · 刚性面 · 本地运行</span>
      </div>
      <div class="toolbar">
        <label class="examples">
          示例
          <select @change="onExample" :value="''">
            <option value="" disabled>选择内置示例…</option>
            <option v-for="ex in examples" :key="ex.key" :value="ex.key">{{ ex.label }}</option>
          </select>
        </label>
        <button class="tbtn" :disabled="!store.canUndo" @click="store.undo()" title="撤销角度/指派修改 (Ctrl+Z)">↶ 撤销</button>
        <button class="tbtn" :disabled="!store.canRedo" @click="store.redo()" title="重做 (Ctrl+Y)">↷ 重做</button>
        <button class="tbtn" @click="store.resetFlat()">恢复平面</button>
        <button class="tbtn" @click="frame">复位视角</button>
        <span class="sep" />
        <button class="tbtn" @click="triggerImport">导入 FOLD</button>
        <button class="tbtn" @click="store.exportJson(true)">导出（含折叠）</button>
        <button class="tbtn" @click="store.exportJson(false)">导出平面 FOLD</button>
        <input ref="fileInput" type="file" accept=".fold,.json,application/json" hidden @change="onFile" />
      </div>
    </header>

    <main class="main">
      <aside class="sidebar">
        <section v-if="exampleDesc" class="example-desc">
          <strong>{{ exampleTitle }}</strong>
          <p>{{ exampleDesc }}</p>
        </section>
        <CreaseInspector :store="store" />
        <Diagnostics :store="store" />
        <ProjectsPanel :store="store" />
        <section v-if="store.loadError" class="load-error">
          <strong>载入失败</strong>
          <p>{{ store.loadError }}</p>
        </section>
        <section v-if="store.loadProblems.length" class="load-warn">
          <strong>结构提示</strong>
          <p v-for="(p, i) in store.loadProblems" :key="i">{{ p }}</p>
        </section>
      </aside>

      <section class="views">
        <div class="view pane2d">
          <div class="pane-title">平面折痕图（点击折痕 / 面片）</div>
          <Fold2dView :store="store" />
        </div>
        <div class="view pane3d">
          <div class="pane-title">空间面片（拖拽旋转 · 滚轮缩放 · 点击选择）</div>
          <Viewer3d :store="store" ref="viewerRef" />
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import Fold2dView from './components/Fold2dView.vue';
import Viewer3d from './components/Viewer3d.vue';
import CreaseInspector from './components/CreaseInspector.vue';
import Diagnostics from './components/Diagnostics.vue';
import ProjectsPanel from './components/ProjectsPanel.vue';
import { useOrigamiStore } from './store/useOrigami';
import { examples } from './fold/examples';

const store = useOrigamiStore();
const fileInput = ref<HTMLInputElement | null>(null);
const viewerRef = ref<InstanceType<typeof Viewer3d> | null>(null);
const currentExample = ref('single');

onMounted(() => {
  store.loadExample('single');
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const onKey = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  }
};

const onExample = (e: Event) => {
  const key = (e.target as HTMLSelectElement).value;
  currentExample.value = key;
  store.loadExample(key);
};
const exampleMeta = computed(() => examples.find((x) => x.key === currentExample.value));
const exampleTitle = computed(() => exampleMeta.value?.label ?? '');
const exampleDesc = computed(() => exampleMeta.value?.description ?? '');

const triggerImport = () => fileInput.value?.click();
const onFile = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    await store.importFile(file);
    currentExample.value = '';
  }
  (e.target as HTMLInputElement).value = '';
};
const frame = () => viewerRef.value?.frameCamera();
</script>

<style src="./style.css"></style>
