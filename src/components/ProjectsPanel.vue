<template>
  <div class="projects">
    <h3>本地工程（IndexedDB）</h3>
    <div class="current">
      <input class="title-input" :value="store.title" @input="onTitle" placeholder="工程标题" />
      <span :class="['dot', store.dirty ? 'dirty' : 'saved']" :title="store.dirty ? '有未保存修改' : '已保存'" />
    </div>
    <div class="actions">
      <button class="btn primary" @click="save">保存工程</button>
      <button class="btn" @click="reload">刷新列表</button>
    </div>
    <ul v-if="records.length" class="list">
      <li v-for="rec in records" :key="rec.id" :class="{ active: rec.id === store['projectId'] }">
        <button class="rec" @click="open(rec.id)">
          <span class="rec-title">{{ rec.title }}</span>
          <span class="rec-time">{{ formatTime(rec.updatedAt) }}</span>
        </button>
        <button class="del" title="删除" @click="remove(rec.id)">×</button>
      </li>
    </ul>
    <p v-else class="empty">尚无保存的工程。</p>
    <p v-if="store.notice" class="notice">{{ store.notice }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { OrigamiStore } from '../store/useOrigami';
import { listProjects, deleteProject, type ProjectRecord } from '../store/project';

const props = defineProps<{ store: OrigamiStore }>();
const store = props.store;
const records = ref<ProjectRecord[]>([]);

const refresh = async () => {
  records.value = await listProjects();
};
onMounted(refresh);

const save = async () => {
  await store.saveToIndexedDb();
  await refresh();
};
const open = async (id: string) => {
  await store.loadFromDb(id);
  await refresh();
};
const remove = async (id: string) => {
  await deleteProject(id);
  await refresh();
};
const reload = refresh;
const onTitle = (e: Event) => store.renameTitle((e.target as HTMLInputElement).value);
const formatTime = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false });
</script>

<style scoped>
.projects {
  padding: 12px 14px;
  border-top: 1px solid #e4e7ec;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #344054;
}
.current {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.title-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  font-size: 12px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.dot.dirty { background: #f79009; }
.dot.saved { background: #12b76a; }
.actions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
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
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
}
.list li {
  display: flex;
  align-items: center;
  border-radius: 6px;
}
.list li.active {
  background: #eef3f9;
}
.rec {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  padding: 6px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.rec-title {
  font-size: 12px;
  color: #1d2939;
}
.rec-time {
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
.del:hover { color: #d92d20; }
.empty {
  font-size: 11px;
  color: #98a2b3;
  margin: 4px 0;
}
.notice {
  font-size: 11px;
  color: #1a7f37;
  margin: 6px 0 0;
}
</style>
