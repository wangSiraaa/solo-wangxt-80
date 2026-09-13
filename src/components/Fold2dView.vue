<template>
  <div class="fold2d-wrap">
    <svg
      v-if="graph"
      :viewBox="`0 0 ${size} ${size}`"
      class="fold2d"
      @click.self="store.clearSelection()"
    >
      <!-- 面片填充 -->
      <polygon
        v-for="(face, fi) in facePolygons"
        :key="'f' + fi"
        :points="face"
        :class="['face', selectedFaceClass(fi), intersectClass(fi)]"
        @click.stop="store.select('face', fi)"
      />
      <!-- 边 -->
      <line
        v-for="(ln, ei) in edgeLines"
        :key="'e' + ei"
        :x1="ln.x1"
        :y1="ln.y1"
        :x2="ln.x2"
        :y2="ln.y2"
        :class="['edge', 'a-' + ln.assignment, { selected: isEdgeSelected(ei) }]"
        :stroke-dasharray="ln.assignment === 'M' ? '7 5' : undefined"
        @click.stop="store.select('edge', ei)"
      />
      <!-- 顶点 -->
      <circle
        v-for="(p, vi) in vertexPoints"
        :key="'v' + vi"
        :cx="p[0]"
        :cy="p[1]"
        r="2.6"
        class="vertex"
      />
    </svg>
    <div v-else class="empty">未载入折痕图</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { OrigamiStore } from '../store/useOrigami';

const props = defineProps<{ store: OrigamiStore }>();
const store = props.store;
const size = 420;
const margin = 30;

const graph = computed(() => {
  void store.graphVersion.value;
  return store.graph;
});

const bounds = computed(() => {
  const g = graph.value;
  if (!g) return { cx: 1, cy: 1, scale: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  g.vertices.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const scale = (size - margin * 2) / Math.max(w, h);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w, h, scale,
  };
});

const toSvg = ([x, y]: [number, number]): [number, number] => {
  const b = bounds.value;
  const sx = size / 2 + (x - b.cx) * b.scale;
  const sy = size / 2 - (y - b.cy) * b.scale; // y 轴翻转，与纸面对齐
  return [sx, sy];
};

const facePolygons = computed<string[]>(() => {
  const g = graph.value;
  if (!g) return [];
  return g.facesVertices.map((ring) =>
    ring.map((v) => toSvg(g.vertices[v]).join(',')).join(' '),
  );
});

const edgeLines = computed(() => {
  const g = graph.value;
  if (!g) return [];
  return g.edgesVertices.map(([a, b], ei) => {
    const [x1, y1] = toSvg(g.vertices[a]);
    const [x2, y2] = toSvg(g.vertices[b]);
    return { x1, y1, x2, y2, assignment: g.creases[ei].assignment };
  });
});

const vertexPoints = computed<[number, number][]>(() => {
  const g = graph.value;
  return g ? g.vertices.map((v) => toSvg(v)) : [];
});

const isEdgeSelected = (ei: number) =>
  store.selection.kind === 'edge' && store.selection.index === ei;

const selectedFaceClass = (fi: number) =>
  store.selection.kind === 'face' && store.selection.index === fi ? 'selected' : '';

const intersectClass = (fi: number) => {
  const r = store.foldResult.value;
  return r?.intersections.some((p) => p.faceA === fi || p.faceB === fi) ? 'intersect' : '';
};
</script>

<style scoped>
.fold2d-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  background: #f7f8fa;
  border-radius: 8px;
}
.fold2d {
  width: 100%;
  height: 100%;
}
.empty {
  margin: auto;
  color: #98a2b3;
}
.face {
  fill: #eef3f9;
  stroke: none;
  cursor: pointer;
}
.face:hover {
  fill: #e2ecf7;
}
.face.selected {
  fill: #f6d79a;
}
.face.intersect {
  fill: rgba(226, 59, 59, 0.35);
}
.edge {
  stroke-width: 2;
  fill: none;
  cursor: pointer;
}
.edge:hover {
  stroke-width: 3.4;
}
.edge.selected {
  stroke: #f6c945 !important;
  stroke-width: 4;
  filter: drop-shadow(0 0 3px rgba(246, 201, 69, 0.8));
}
.edge.a-B { stroke: #222831; }
.edge.a-M { stroke: #d8322f; }
.edge.a-V { stroke: #2f6fd8; }
.edge.a-F { stroke: #9aa4b2; }
.edge.a-U { stroke: #3f9d6b; stroke-dasharray: 2 3; }
.vertex {
  fill: #475467;
  pointer-events: none;
}
</style>
