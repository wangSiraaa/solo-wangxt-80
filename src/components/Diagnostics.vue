<template>
  <div class="diagnostics">
    <h3>折叠诊断</h3>
    <template v-if="result">
      <div :class="['verdict', verdictClass]">
        <span class="dot" />
        {{ verdictText }}
      </div>
      <ul class="stats">
        <li>面片：{{ graph?.facesVertices.length ?? 0 }}</li>
        <li>折痕：{{ creaseCount }}</li>
        <li>求解迭代：{{ result.iterations }}</li>
        <li>残差：{{ result.residual.toExponential(2) }}</li>
      </ul>
      <div v-if="result.issues.length" class="issues">
        <div v-for="(issue, i) in result.issues" :key="i" :class="['issue', issue.kind]">
          <strong>{{ issueLabel(issue.kind) }}</strong>
          <span>{{ issue.message }}</span>
        </div>
      </div>
      <p v-else class="ok">
        所有共享边闭合、面片无自交。仅表示当前角度下满足刚性约束，不代表任意折法都可实现。
      </p>
      <div v-if="result.closureGaps.length" class="gaps">
        <div class="sub">闭合误差最大的共享边（点击定位）</div>
        <button
          v-for="g in result.closureGaps.slice(0, 5)"
          :key="g.edge"
          class="gap"
          :class="{ bad: g.gap > 0.02 }"
          @click="store.select('edge', g.edge)"
        >
          边 #{{ g.edge }}：{{ g.gap.toFixed(4) }}
        </button>
      </div>
      <div v-if="result.intersections.length" class="gaps">
        <div class="sub">自交面片对（点击定位）</div>
        <button
          v-for="(p, i) in result.intersections.slice(0, 8)"
          :key="i"
          class="gap bad"
          @click="store.select('face', p.faceA)"
        >
          面 #{{ p.faceA }} ↔ 面 #{{ p.faceB }}
        </button>
      </div>
      <div v-if="(result.contacts?.length ?? 0) > 0" class="gaps">
        <div class="sub">近共面 / 接触候选（无厚度表面距离，点击定位；不代表穿透）</div>
        <button
          v-for="(c, i) in result.contacts.slice(0, 6)"
          :key="'c' + i"
          class="contact"
          @click="store.select('face', c.faceA)"
        >
          面 #{{ c.faceA }}↔#{{ c.faceB }}：{{ c.distance.toExponential(1) }}
        </button>
      </div>
    </template>
    <p v-else class="ok">载入折痕图后显示约束求解结果。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrigamiStore } from '../store/useOrigami';
import type { FoldIssue } from '../fold/types';

const props = defineProps<{ store: OrigamiStore }>();
const store = props.store;

const result = computed(() => store.foldResult.value);
const graph = computed(() => store.graph);
const creaseCount = computed(
  () => graph.value?.creases.filter((c) => c.assignment === 'M' || c.assignment === 'V').length ?? 0,
);

const hasBlocking = computed(() =>
  result.value?.issues.some((i) =>
    ['nonConverged', 'selfIntersection', 'boundaryConflict', 'disconnected'].includes(i.kind),
  ),
);

const verdictClass = computed(() => (hasBlocking.value ? 'bad' : 'good'));
const verdictText = computed(() => {
  if (!result.value) return '';
  if (result.value.issues.some((i) => i.kind === 'nonConverged')) return '约束未收敛 · 该角度组合无法闭合';
  if (result.value.issues.some((i) => i.kind === 'selfIntersection')) return '面片自交 · 刚性折叠不可实现';
  if (result.value.issues.some((i) => i.kind === 'boundaryConflict')) return '边界标记冲突 · 纸片被剪开';
  if (result.value.issues.some((i) => i.kind === 'disconnected')) return '折痕图不连通';
  return '当前构形满足刚性约束';
});

const issueLabel = (kind: FoldIssue['kind']): string => {
  switch (kind) {
    case 'nonConverged': return '约束未收敛';
    case 'selfIntersection': return '面片自交';
    case 'boundaryConflict': return '边界冲突';
    case 'disconnected': return '不连通';
  }
};
</script>

<style scoped>
.diagnostics {
  padding: 12px 14px;
  border-top: 1px solid #e4e7ec;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #344054;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 7px;
}
.verdict.good { color: #1a7f37; background: #e9f7ef; }
.verdict.bad { color: #b42318; background: #fef3f2; }
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
}
.stats {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 11px;
  color: #667085;
}
.issues {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.issue {
  font-size: 11px;
  line-height: 1.5;
  border-left: 3px solid;
  padding: 4px 8px;
  background: #fafafa;
  border-radius: 0 5px 5px 0;
}
.issue strong {
  display: block;
  font-size: 12px;
}
.issue.nonConverged { border-color: #d97706; color: #92400e; }
.issue.selfIntersection { border-color: #d92d20; color: #b42318; }
.issue.boundaryConflict, .issue.disconnected { border-color: #7e3af2; color: #5b21b6; }
.ok {
  font-size: 11px;
  color: #667085;
  line-height: 1.5;
}
.gaps {
  margin-top: 8px;
}
.sub {
  font-size: 11px;
  color: #475467;
  margin-bottom: 4px;
}
.gap {
  display: inline-block;
  margin: 0 5px 5px 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid #d0d5dd;
  background: #fff;
  cursor: pointer;
}
.gap.bad {
  border-color: #f0a8a3;
  color: #b42318;
  background: #fef3f2;
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
