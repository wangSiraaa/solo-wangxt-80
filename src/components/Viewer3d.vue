<template>
  <div class="viewer3d" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { OrigamiStore } from '../store/useOrigami';
import type { FoldGraph, FoldResult } from '../fold/types';
import { applyPoint } from '../fold/mat';

const props = defineProps<{ store: OrigamiStore }>();

const containerRef = ref<HTMLDivElement | null>(null);
let renderer!: THREE.WebGLRenderer;
let scene!: THREE.Scene;
let camera!: THREE.PerspectiveCamera;
let controls!: OrbitControls;
let group: THREE.Group | null = null;
let raf = 0;
let onResize: (() => void) | null = null;

const COLORS = {
  face: new THREE.Color('#dbe7f2'),
  faceEdge: new THREE.Color('#7f8ea3'),
  selectedFace: new THREE.Color('#f2b03d'),
  intersect: new THREE.Color('#e23b3b'),
  M: new THREE.Color('#d8322f'),
  V: new THREE.Color('#2f6fd8'),
  B: new THREE.Color('#222831'),
  F: new THREE.Color('#9aa4b2'),
  U: new THREE.Color('#3f9d6b'),
  selectedEdge: new THREE.Color('#f6c945'),
  gapEdge: new THREE.Color('#e040fb'),
};

const initScene = () => {
  const el = containerRef.value!;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f141b');
  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.01, 200);
  camera.up.set(0, 0, 1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(el.clientWidth, el.clientHeight);
  el.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(3, -4, 6);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dir2.position.set(-4, 3, 2);
  scene.add(dir2);

  const ground = new THREE.GridHelper(10, 20, 0x33404f, 0x202832);
  ground.rotation.x = Math.PI / 2;
  ground.position.z = -0.002;
  scene.add(ground);

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  animate();

  onResize = () => {
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(el.clientWidth, el.clientHeight);
  };
  window.addEventListener('resize', onResize);

  // 点击选择（区分拖动）
  let downX = 0;
  let downY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    pick(e);
  });
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const pick = (e: PointerEvent) => {
  const el = renderer.domElement;
  const rect = el.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (!group) return;
  const hits = raycaster.intersectObjects(group.children, false);
  for (const h of hits) {
    const ud = h.object.userData as { kind?: string; index?: number };
    if (ud.kind === 'face') {
      props.store.select('face', ud.index!);
      return;
    }
    if (ud.kind === 'edge') {
      props.store.select('edge', ud.index!);
      return;
    }
  }
  props.store.clearSelection();
};

const edgeWorldEndpoints = (graph: FoldGraph, result: FoldResult, edge: number): THREE.Vector3[] => {
  const face = graph.edgesFaces[edge][0];
  const m = result.transforms[face!];
  return graph.edgesVertices[edge].map((v) => {
    const p = applyPoint(m, [graph.vertices[v][0], graph.vertices[v][1], 0]);
    return new THREE.Vector3(p[0], p[1], p[2]);
  });
};

const buildModel = () => {
  if (group) {
    scene.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  group = new THREE.Group();

  const graph = props.store.graph;
  const result = props.store.foldResult.value;
  if (!graph || !result) {
    scene.add(group);
    return;
  }

  const intersectFaces = new Set<number>();
  result.intersections.forEach((p) => {
    intersectFaces.add(p.faceA);
    intersectFaces.add(p.faceB);
  });
  const gapEdges = new Set(result.closureGaps.map((g) => g.edge));
  const sel = props.store.selection;

  // ---- 面片 ----
  const makeFaceMaterial = (fi: number) => {
    let color = COLORS.face;
    if (intersectFaces.has(fi)) color = COLORS.intersect;
    if (sel.kind === 'face' && sel.index === fi) color = COLORS.selectedFace;
    return new THREE.MeshStandardMaterial({
      color,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
    });
  };

  result.faceWorldVerts.forEach((world, fi) => {
    const tris = result.faceTriangles[fi];
    const positions: number[] = [];
    tris.forEach(([a, b, c]) => {
      for (const idx of [a, b, c]) positions.push(...world[idx]);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, makeFaceMaterial(fi));
    mesh.userData = { kind: 'face', index: fi };
    group!.add(mesh);

    // 面片轮廓边线
    const edgePts: THREE.Vector3[] = world.map((p) => new THREE.Vector3(...p));
    edgePts.push(edgePts[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(edgePts);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: COLORS.faceEdge, transparent: true, opacity: 0.5 }),
    );
    group!.add(line);
  });

  // ---- 折痕 / 边界圆柱 ----
  graph.edgesVertices.forEach((_, e) => {
    const [p1, p2] = edgeWorldEndpoints(graph, result, e);
    const len = p1.distanceTo(p2);
    if (len < 1e-9) return;
    const c = graph.creases[e];
    let color: THREE.Color = COLORS[c.assignment as 'M' | 'V' | 'B' | 'F' | 'U'] ?? COLORS.U;
    let radius = 0.008;
    if (c.assignment === 'B') radius = 0.006;
    if (gapEdges.has(e)) {
      color = COLORS.gapEdge;
      radius = 0.02;
    }
    const isSelected = sel.kind === 'edge' && sel.index === e;
    if (isSelected) {
      color = COLORS.selectedEdge;
      radius = 0.022;
    }
    const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: isSelected ? new THREE.Color(0x8a6b00) : new THREE.Color(0x000000),
      roughness: 0.5,
    });
    const cyl = new THREE.Mesh(geo, mat);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    cyl.position.copy(mid);
    const dir = p2.clone().sub(p1).normalize();
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cyl.userData = { kind: 'edge', index: e };
    group!.add(cyl);
  });

  scene.add(group);
};

let framed = false;
const frameCamera = () => {
  const graph = props.store.graph;
  const result = props.store.foldResult.value;
  if (!graph || !result || result.faceWorldVerts.length === 0) return;
  const box = new THREE.Box3();
  result.faceWorldVerts.forEach((ring) => ring.forEach((p) => box.expandByPoint(new THREE.Vector3(...p))));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.5);
  const dist = span * 2.4;
  camera.position.set(center.x + dist * 0.35, center.y - dist * 0.75, center.z + dist * 0.85 + 0.2);
  camera.near = span / 100;
  camera.far = span * 40;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
};

defineExpose({ frameCamera });

onMounted(() => {
  initScene();
  watch(
    () => [props.store.graphVersion.value, props.store.selection.kind, props.store.selection.index, props.store.foldResult.value],
    () => buildModel(),
    { immediate: true, deep: false },
  );
  watch(
    () => props.store.graphVersion.value,
    () => {
      if (!framed) {
        frameCamera();
        framed = true;
      }
    },
  );
  // 每次载入新图/示例后重新取景（角度调整不触发）
  watch(
    () => props.store.loadSeq,
    () => {
      frameCamera();
      framed = true;
    },
  );
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  renderer?.dispose();
  if (onResize) window.removeEventListener('resize', onResize);
});
</script>

<style scoped>
.viewer3d {
  width: 100%;
  height: 100%;
  position: relative;
}
.viewer3d :deep(canvas) {
  display: block;
}
</style>
