import { getInteractionPlacements } from '../lib/placement-targets';
import { createCoverEditor } from "../lib/cover-editor";
import { createCagePreview } from "../lib/cage-scene";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { createModelBatches, MODEL_PICK_LAYER } from "../lib/model-batches";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadPart } from "../lib/model-loader";
import { FoldVertical, RotateCw, Trash2 } from "lucide-react";
import {
  getProduct,
  getBaseParts,
} from "../data/catalog";
import type { ColorMap } from "../data/catalog";
import { getLayoutFootprint } from "../lib/layout-footprint";
import { getItemBounds, getPlatforms, getDisplayElevation, getItemDisplayElevation, tryPlace } from "../lib/assembly";
import type { AssemblyState, Placement } from "../lib/assembly";
import modelIndex from "../data/model-index.json";
import { configureModelRenderer, createModelLighting, createModelMaterial, setModelPartTransform, MODEL_CAMERA_DIRECTION } from "../lib/model-presentation";
import { createBedding } from "../lib/bedding-scene";
import { BeddingFade } from "../lib/bedding-fade";
import { createHamsterSimulation } from "../lib/hamster-scene";
import { FEATURES } from "../data/features";
import { createSelectionBox, dimensionSegments, dimensionsInCentimeters, disposeAnnotation, getRenderedModelBounds, updateSelectionStroke } from "../lib/scene-annotations";
import { createExplodedLayout } from "../lib/exploded-view";
import { createBlankDoubleTap } from "../lib/scene-gestures";
import { applySceneViewport, getSelectionToolbarPosition } from "../lib/scene-framing";
import { updateSelectionMetadata } from "../lib/scene-selection";
import { captureSceneView, restoreSceneView, type SceneViewSnapshot } from "../lib/scene-recovery";
import "./scene-overlays.css";
import { bindGestureLearning, GESTURE_LABELS, type SceneGesture } from '../lib/gesture-learning';
import { useGestureHints } from '../lib/use-gesture-hints';

type Point = { x: number; y: number; z: number };
export type SceneHandle = {
  startDrag: (
    productId: string,
    x: number,
    y: number,
    pointerId?: number,
  ) => void;
  home: () => void;
  top: () => void;
  zoom: (amount: number) => void;
  snapshot: () => string | undefined;
};
type Props = {
  state: AssemblyState;
  viewResetKey?: number;
  selectedId: string | null;
  selectedTitle: string;
  activeProduct: string | null;
  getPreviewColors: (productId: string) => ColorMap;
  showDimensions: boolean;
  connectionPlatform: string | null;
  canConnect: boolean;
  onConnection: () => void;
  onExitConnection: () => void;
  removeTitle: string;
  onRotate: () => void;
  onRemove: () => void;
  canRotate: boolean;
  canRemove: boolean;
  rotation: number;
  onSelect: (id: string | null) => void;
  onDrop: (
    productId: string,
    point: Point,
    rotation: number,
    itemId?: string,
  ) => void;
  onDragEnd: () => void;
  onReady: () => void;
  onError: (message: string) => void;
};
const index = modelIndex as Record<
  string,
  { url: string; bounds: number[]; components: { colorKey: string }[] }
>;
function release(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (o.userData.ownedGeometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export default forwardRef<SceneHandle, Props>(
  function AssemblyScene(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const gestureHints = useGestureHints();
    const toolbar = useRef<HTMLDivElement>(null);
    const current = useRef(props);
    current.current = props;
    const runtime = useRef<ReturnType<typeof createRuntime> | null>(null);
    const savedView = useRef<SceneViewSnapshot | undefined>(undefined);
    const [retryVersion, setRetryVersion] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failure, setFailure] = useState<string | null>(null);
    const [exploded, setExploded] = useState(false);
    useImperativeHandle(
      ref,
      () => ({
        startDrag: (...a) => runtime.current?.startDrag(...a),
        home: () => runtime.current?.home(),
        top: () => runtime.current?.top(),
        zoom: (a) => runtime.current?.zoom(a),
        snapshot: () => runtime.current?.snapshot(),
      }),
      [],
    );
    useEffect(() => {
      if (!host.current) return;
      let active = true;
      let instance: ReturnType<typeof createRuntime> | null = null;
      setLoading(true);
      setFailure(null);
      setExploded(false);
      try {
        instance = createRuntime(
          host.current,
          () => current.current,
          () => {
            if (!active) return;
            setLoading(false);
            setFailure(null);
            current.current.onReady();
          },
          (e) => {
            if (!active) return;
            setLoading(false);
            setFailure(e);
            current.current.onError(e);
          },
          toolbar.current!,
          value => { if (active) { setExploded(value); if (value) gestureHints.complete("explode"); } },
          gestureHints.complete,
          savedView.current,
        );
        runtime.current = instance;
        void instance.update();
      } catch (error) {
        console.error("3D initialization failed", error);
        setLoading(false);
        const message = "3D 画布未能启动。设计已保留，可以重新加载3D。";
        setFailure(message);
        current.current.onError(message);
      }
      return () => {
        active = false;
        if (instance) {
          savedView.current = instance.captureView();
          instance.dispose();
        }
        if (runtime.current === instance) runtime.current = null;
      };
    }, [retryVersion]);
    useEffect(() => {
      runtime.current?.update();
    }, [props.state, props.viewResetKey]);
    useEffect(() => {
      runtime.current?.updateSelection();
    }, [props.selectedId, props.connectionPlatform]);
    useEffect(() => {
      runtime.current?.updateTargets();
    }, [props.activeProduct, props.rotation]);
    useEffect(() => {
      runtime.current?.updateAnnotations();
    }, [props.showDimensions]);
    return (
      <div ref={host} className="scene-canvas" aria-label="仓鼠屋 3D 装配画布">
        {!!gestureHints.remaining.length && <div className="scene-gesture-hints">试试{gestureHints.remaining.map(id=>GESTURE_LABELS[id]).join('，')}</div>}
        {props.connectionPlatform && <div className="connection-notice" onPointerDown={event => event.stopPropagation()}><span>选择连通孔，搭配向下管道</span><button onClick={props.onExitConnection}>完成</button></div>}
        {exploded && !failure && <div className="scene-view-actions" onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={() => runtime.current?.toggleExploded()}><FoldVertical size={15} /><span>恢复组装</span></button>
        </div>}
        <div ref={toolbar} className="scene-item-toolbar" role="toolbar" aria-label="已选配件操作" hidden
          onPointerDown={(event) => event.stopPropagation()}>
          <span className="scene-item-title">{props.selectedTitle}</span>
          {(props.canRotate || props.canRemove || props.canConnect) && <div className="scene-item-actions">
            {props.canConnect && <button onClick={props.onConnection}>与垫料连通</button>}
            {props.canRotate && <button type="button" aria-label="旋转已选配件" onClick={props.onRotate}><RotateCw size={16} /><span>旋转</span></button>}
            {props.canRemove && <button type="button" aria-label={`${props.removeTitle}已选配件`} onClick={props.onRemove}><Trash2 size={16} /><span>{props.removeTitle}</span></button>}
          </div>}
        </div>
        {loading && !failure && (
          <div className="scene-loading">
            <span className="loading-orbit" />
            <strong>正在搬来小小家…</strong>
            <span>加载真实 3D 模型</span>
          </div>
        )}
        {failure && (
          <div className="scene-loading scene-error" role="alert" onPointerDown={event => event.stopPropagation()}>
            <strong>暂时无法显示 3D</strong>
            <span>{failure}</span>
            <button type="button" onClick={() => setRetryVersion(value => value + 1)}>重新加载3D</button>
          </div>
        )}
      </div>
    );
  },
);

function createRuntime(
  host: HTMLDivElement,
  props: () => Props,
  ready: () => void,
  fail: (e: string) => void,
  toolbar: HTMLDivElement,
  onExplodedChange: (exploded: boolean) => void,
  onGesture: (gesture: SceneGesture) => void,
  savedView?: SceneViewSnapshot,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  let initializingControls: OrbitControls | undefined;
  try {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  configureModelRenderer(renderer);
  renderer.shadowMap.autoUpdate = false;
  const invalidateShadows = () => { renderer.shadowMap.needsUpdate = true; };
  invalidateShadows();
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#DDE0E2");
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 10, 4500);
  camera.up.set(0, 0, 1);
  const bottomActions = host.parentElement?.querySelector<HTMLElement>(".canvas-bottom-actions");
  const updateViewportFraming = () => {
    const canvasBounds = host.getBoundingClientRect();
    const actionsBounds = bottomActions?.getBoundingClientRect();
    const overlaps = actionsBounds && actionsBounds.width > 0 && actionsBounds.height > 0
      && actionsBounds.left < canvasBounds.right && actionsBounds.right > canvasBounds.left
      && actionsBounds.top < canvasBounds.bottom && actionsBounds.bottom > canvasBounds.top;
    const bottomInset = overlaps ? canvasBounds.bottom - actionsBounds.top + 10 : 0;
    applySceneViewport(camera, host.clientWidth, host.clientHeight, bottomInset);
  };
  const controls = new OrbitControls(camera, renderer.domElement);
  const disposeGestureLearning = bindGestureLearning(host, renderer.domElement, camera, controls, onGesture);
  initializingControls = controls;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 300;
  controls.maxDistance = 4000;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.enablePan = true;
  controls.target.set(150, 150, 80);
  const contentTop = () => {
    const state = props().state;
    return Math.max(state.bedding.depth, 10,
      ...getPlatforms(state).map(platform => 110 + platform.elevation),
      ...state.items.flatMap(item => getItemBounds(item).map(bounds => bounds[5] + getItemDisplayElevation(state, item))));
  };
  const sceneCenter = () => {
    const footprint = getLayoutFootprint(props().state);
    return new THREE.Vector3((footprint.minX + footprint.maxX) / 2, (footprint.minY + footprint.maxY) / 2, contentTop() * .48);
  };
  const home = () => {
    // An explicit reset must not inherit unfinished orbit inertia.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    updateViewportFraming();
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    const height = contentTop();
    controls.target.copy(sceneCenter());
    camera.position.copy(
      new THREE.Vector3(...MODEL_CAMERA_DIRECTION)
        .normalize()
        .multiplyScalar(Math.max(1000 + Math.max(0, (getLayoutFootprint(props().state).maxX - getLayoutFootprint(props().state).minX) / 300 - 1) * 540, height * 2.85) * Math.max(1, .95 / camera.aspect))
        .add(controls.target),
    );
    controls.update();
  };
  if (savedView) {
    updateViewportFraming();
    restoreSceneView(camera, controls.target, savedView);
  } else home();
  let lastViewResetKey = savedView?.consumedViewResetKey ?? props().viewResetKey ?? 0;
  const lighting = createModelLighting(scene);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
  );
  floor.position.set(150, 150, -0.6);
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(1100, 44, "#CBD0D3", "#D5DADD");
  grid.rotation.x = Math.PI / 2;
  grid.position.set(150, 150, -0.8);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.47;
  scene.add(grid);
  const objects = new THREE.Group();
  objects.userData.hamsterEnvironment = true;
  scene.add(objects);
  const modelBatches = createModelBatches(scene, objects);
  const cagePreview = createCagePreview(scene);
  const coverEditor = createCoverEditor(scene, objects);
  let editingConnection: string | null = null;
  let connectionView: {position: THREE.Vector3; target: THREE.Vector3} | null = null;
  const bedding = createBedding(scene, material => cagePreview.decorate(material));
  // Gate the scene too: a saved configuration may already contain a hamster.
  const hamster = FEATURES.hamsterPreview ? createHamsterSimulation(scene) : null;
  const targets = new THREE.Group();
  scene.add(targets);
  const annotations = new THREE.Group();
  scene.add(annotations);
  const dimensionLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: "#53696B", transparent: true, opacity: .7, depthTest: false, depthWrite: false,
  }));
  dimensionLines.renderOrder = 7;
  dimensionLines.visible = false;
  scene.add(dimensionLines);
  const dimensionLabels = ["长", "宽", "高"].map((name) => {
    const element = document.createElement("span");
    element.className = "scene-dimension-label";
    element.dataset.axis = name;
    element.hidden = true;
    host.appendChild(element);
    return element;
  });
  let selectedBounds = new THREE.Box3();
  let modelBounds = new THREE.Box3();
  let lastDimensionKey = "";
  let ghost: THREE.Group | null = null;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  ray.layers.enable(MODEL_PICK_LAYER);
  let disposed = false,
    revision = 0,
    ghostRevision = 0;
  let frame = 0;
  let renderError = false;
  let contextUnavailable = false;
  let notifiedReady = false;
  let pressed: { x: number; y: number; id: string | null; at: number; moved?: boolean; placement?: Placement } | null = null;
  const touchPointers = new Set<number>();
  const blankTaps = createBlankDoubleTap();
  let lastBlankPointerUp: { x: number; y: number; at: number; pointerType: string } | null = null;
  let lastInvalidTapAt = -Infinity;
  let lastExplosionToggleAt = -Infinity;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let modelReady = false;
  let exploded = false;
  let explosionProgress = 0;
  let explosion: ReturnType<typeof createExplodedLayout> | null = null;
  let explosionAnimation: { from: number; to: number; started: number; duration: number } | null = null;
  let drag: {
    pointerId?: number;
    productId: string;
    itemId?: string;
    startX: number;
    startY: number;
    moved: boolean;
    point: Point | null;
    placement: Placement | null;
    candidates?: {
      state: AssemblyState;
      productId: string;
      itemId?: string;
      rotation: number;
      values: Placement[];
    };
  } | null = null;
  const elevation = (parentId = "base") => getItemDisplayElevation(props().state, { parentId });
  const defaultSurface = (): string => getPlatforms(props().state)[0]?.id ?? "ground";
  const isExploded = () => exploded || explosionProgress > 0;
  function showSeams(visible: boolean) {
    objects.traverse(node => { if (node.userData.selectionSeam) node.visible = visible && !!node.userData.selectionSeamActive; });
  }
  function restoreExploded(refresh = true) {
    if (!explosion) return;
    explosion.restore();
    modelBatches.refresh();
    explosion = null;
    explosionAnimation = null;
    explosionProgress = 0;
    exploded = false;
    showSeams(true);
    targets.visible = annotations.visible = true;
    onExplodedChange(false);
    if (refresh) { updateTargets(); updateAnnotations(); }
  }
  function toggleExploded() {
    if (!modelReady || disposed || renderError || contextUnavailable) return;
    lastExplosionToggleAt = performance.now();
    cancel();
    pressed = null;
    blankTaps.reset();
    if (!explosion) {
      explosion = createExplodedLayout(objects);
      if (!explosion.pieces.length) { explosion = null; return; }
    }
    exploded = !exploded;
    explosionAnimation = { from: explosionProgress, to: exploded ? 1 : 0, started: performance.now(), duration: reducedMotion.matches ? 0 : 550 };
    targets.visible = annotations.visible = false;
    dimensionLines.visible = false;
    dimensionLabels.forEach(label => { label.hidden = true; });
    toolbar.hidden = true;
    showSeams(false);
    onExplodedChange(true);
    if (reducedMotion.matches) tickExplosion(performance.now());
  }
  function tickExplosion(now: number) {
    if (!explosionAnimation || !explosion) return;
    const t = explosionAnimation.duration ? Math.min(1, (now - explosionAnimation.started) / explosionAnimation.duration) : 1;
    const eased = t * t * (3 - 2 * t);
    explosionProgress = THREE.MathUtils.lerp(explosionAnimation.from, explosionAnimation.to, eased);
    explosion.apply(explosionProgress);
    modelBatches.refresh();
    invalidateShadows();
    if (t === 1) {
      explosionAnimation = null;
      if (!exploded) restoreExploded();
    }
  }
  function pauseScene(message: string) {
    cancelAnimationFrame(frame);
    cancel();
    blankTaps.reset(); pressed = null; touchPointers.clear();
    controls.enabled = false;
    toolbar.hidden = true;
    dimensionLabels.forEach(label => { label.hidden = true; });
    notifiedReady = false;
    fail(message);
  }
  function stopForError(message: string) {
    if (disposed || renderError) return;
    renderError = true;
    pauseScene(message);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    if (disposed) return;
    contextUnavailable = true;
    if (!renderError) pauseScene("3D 显示连接暂时中断，设计和视角已保留。恢复后会自动继续，也可以重新加载3D。");
  }
  function contextRestored() {
    if (disposed) return;
    contextUnavailable = false;
    // Restoring WebGL cannot fix an independent resource or rendering failure.
    if (renderError) return;
    try {
      controls.enabled = true;
      clock.getDelta();
      renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
      invalidateShadows();
      updateViewportFraming();
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    } catch (error) {
      console.error("3D context restoration failed", error);
      stopForError("3D 显示连接未能恢复，设计和视角已保留。请重新加载3D。");
    }
  }
  function visibilityChanged() {
    blankTaps.reset(); pressed = null;
    cancelAnimationFrame(frame);
    if (!document.hidden && !disposed && !renderError && !contextUnavailable) {
      clock.getDelta(); frame = requestAnimationFrame(draw);
    }
  }
  function pointAt(x: number, y: number): (z?: number, parentId?: string) => Point | null {
    const b = renderer.domElement.getBoundingClientRect();
    if (!b.width || !b.height || x < b.left || x > b.right || y < b.top || y > b.bottom) return () => null;
    pointer.set(((x - b.left) / b.width) * 2 - 1, (-(y - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    // One event can have many magnets on the same supporting surface.
    const pointerRay = ray.ray.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1));
    const intersection = new THREE.Vector3();
    const surfaces = new Map<number, Point | null>();
    return (z = 110, parentId = defaultSurface()) => {
      const displayElevation = elevation(parentId);
      const worldZ = z + displayElevation;
      if (surfaces.has(worldZ)) { const hit = surfaces.get(worldZ)!; return hit ? { ...hit, z } : null; }
      plane.constant = -(z + displayElevation);
      const hit = pointerRay.intersectPlane(plane, intersection);
      const result = hit ? { x: hit.x, y: hit.y, z } : null;
      surfaces.set(worldZ, result);
      return result;
    };
  }
  function pick(x: number, y: number) {
    const b = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((x - b.left) / b.width) * 2 - 1,
      (-(y - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    if (props().connectionPlatform) return ray.intersectObjects(coverEditor.rings.children, true)[0]?.object.userData.selectionId as string | undefined;
    const hit = ray.intersectObjects(objects.children, true)[0];
    let o: THREE.Object3D | undefined = hit?.object;
    while (o && !o.userData.selectionId && !o.userData.itemId) o = o.parent ?? undefined;
    return (o?.userData.selectionId ?? o?.userData.itemId) as string | undefined;
  }
  async function build(
    parts: ReturnType<typeof getBaseParts>,
    origin: number[],
    colors: ColorMap,
    preview = false,
    ownerId?: string,
    doorSide?: "left" | "right",
  ) {
    const group = new THREE.Group();
    let abandoned = false;
    try { await Promise.all(
      parts.map(async (part) => {
        const loaded = await loadPart(part.id);
        if (abandoned) return;
        const child = loaded.clone(true);
        const editingOwner = !!ownerId && (props().selectedId === ownerId || !!props().selectedId?.startsWith(`cover:${ownerId}:`));
        const selectionId = ownerId && /^(base|base2|base3|base4)$/.test(ownerId)
          ? (/^H0[1-5]$/.test(part.id) && editingOwner ? `cover:${ownerId}:${part.id}` : part.id === "B01" ? `pool:${ownerId}` : ownerId)
          : ownerId;
        child.userData.selectionId = selectionId;
        child.userData.partId = part.id;
        setModelPartTransform(child, part, origin, doorSide);
        child.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.userData.modelMesh = true;
            o.castShadow = !preview;
            o.receiveShadow = true;
            const originals = Array.isArray(o.material)
              ? o.material
              : [o.material];
            const mats = originals.map((m) => {
              const next = createModelMaterial(m, part, o.userData.sourcePart, o.userData.colorKey, colors);
              if (!preview) cagePreview.decorate(next);
              if (preview) {
                next.transparent = true;
                next.opacity = 0.55;
                next.depthWrite = false;
              }
              return next;
            });
            o.material = Array.isArray(o.material) ? mats : mats[0];
          }
        });
        // Flush covers share the platform color. A fine seam makes each removable lid discoverable.
        if (/^H0[1-5]$/.test(part.id) && !preview) {
          const b = index[part.id].bounds;
          const radius = (b[3] - b[0]) / 2;
          const seam = new THREE.Mesh(
            new THREE.RingGeometry(radius - 1, radius, 64),
            new THREE.MeshBasicMaterial({
              color: "#89977e", transparent: true, opacity: 0.6, depthWrite: false,
            }),
          );
          seam.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5] + 0.08);
          seam.userData.ownedGeometry = true;
          seam.userData.selectionSeam = true;
          seam.userData.selectionSeamActive = editingOwner;
          seam.visible = editingOwner;
          child.add(seam);
        }
        group.add(child);
      }),
    ); } catch (error) {
      abandoned = true;
      release(group);
      throw error;
    }
    return group;
  }
  async function reconcileGroups(s: AssemblyState, rev: number) {
    const existing = new Map(objects.children.map(group => [group.userData.itemId as string, group]));
    const definitions = [
      ...getPlatforms(s).map(platform => ({
        id: platform.id,
        parts: getBaseParts(platform.legHeight, platform.baseInsert, platform.removedCovers),
        origin: [0, 0, 0],
        colors: platform.baseColors,
        x: platform.x, y: platform.y, z: 0, rotation: 0,
        elevation: platform.elevation, doorSide: undefined,
      })),
      ...s.items.map(item => ({
        ...item,
        elevation: getItemDisplayElevation(s, item),
        parts: getProduct(item.productId).parts,
        origin: getProduct(item.productId).origin,
      })),
    ];
    const replacements = new Set<THREE.Group>();
    let abandoned = false;
    const stale = () => disposed || revision !== rev;
    try {
      const next = await Promise.all(definitions.map(async def => {
        // Position, parent and selection do not change a group's local model.
        // Sort color slots so equivalent imported/undo states can reuse it too.
        const contentKey = JSON.stringify([def.parts, def.origin, def.doorSide,
          Object.keys(def.colors).sort().map(key => [key, def.colors[key]])]);
        const previous = existing.get(def.id);
        if (previous?.userData.modelContentKey === contentKey) return { def, group: previous };
        const group = await build(def.parts, def.origin, def.colors, false, def.id, def.doorSide);
        if (abandoned || stale()) { release(group); return null; }
        group.userData.itemId = def.id;
        group.userData.modelContentKey = contentKey;
        replacements.add(group);
        return { def, group };
      }));
      if (stale()) {
        replacements.forEach(release);
        return false;
      }
      // Commit together: a failed or superseded load never removes usable models.
      const retained = new Set(next.map(entry => entry!.group));
      for (const group of objects.children.slice()) {
        if (retained.has(group)) continue;
        objects.remove(group);
        release(group);
      }
      for (const entry of next) {
        if (!entry) continue;
        const { def, group } = entry;
        group.position.set(def.x, def.y, def.z + def.elevation);
        group.rotation.z = def.rotation * Math.PI / 180;
        if (group.parent !== objects) objects.add(group);
      }
      return true;
    } catch (error) {
      abandoned = true;
      replacements.forEach(release);
      throw error;
    }
  }
  async function update() {
    if (disposed || renderError) return;
    const rev = ++revision;
    try {
    modelReady = false;
    notifiedReady = false;
    // Explicit edits return to assembly mode before replacing imported meshes.
    restoreExploded(false);
    const s = props().state;
    bedding.update(s);
    cagePreview.update(s);
    // Only clear/import requests reset the view, once, against the current state.
    // Apply before asynchronous model loading so a late load cannot undo a gesture.
    const viewResetKey = props().viewResetKey ?? 0;
    if (viewResetKey !== lastViewResetKey) {
      lastViewResetKey = viewResetKey;
      // Clearing/importing replaces the editor view; do not restore its stale camera.
      connectionView = null;
      home();
    }
      await reconcileGroups(s, rev);
      if (rev === revision && !disposed) {
        modelReady = true;
        objects.updateMatrixWorld(true);
        modelBatches.rebuild();
        hamster?.update(s);
        const center = sceneCenter();
        lighting.centerAt(center.x, center.y);
        invalidateShadows();
        updateSelection();
      }
    } catch (e) {
      if (!disposed && rev === revision) {
        console.error(e);
        stopForError("部分模型加载失败，设计和视角已保留。请重新加载3D。");
      }
    }
  }
  function updateSelection() {
    if (!modelReady || disposed || renderError) return;
    updateSelectionMetadata(objects, props().selectedId, isExploded());
    const connection = props().connectionPlatform;
    const refreshConnection = !!connection || !!editingConnection;
    if (connection !== editingConnection) {
      if (connection) {
        if (!connectionView) connectionView = {position: camera.position.clone(), target: controls.target.clone()};
        const platform = getPlatforms(props().state).find(p => p.id === connection);
        if (platform) {
          const z = 110 + getDisplayElevation(props().state, platform.id);
          controls.target.set(platform.x+150, platform.y+150, z);
          const distance = 480 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * Math.min(1,camera.aspect));
          camera.position.set(platform.x+150, platform.y+150-.01, z+distance);
        }
      } else if (connectionView) { camera.position.copy(connectionView.position); controls.target.copy(connectionView.target); connectionView = null; }
      editingConnection = connection;
      controls.update();
    }
    controls.enableRotate = !connection;
    if (refreshConnection) {
      coverEditor.update(props().state, connection, props().selectedId);
      modelBatches.rebuild();
    }
    updateTargets();
    updateAnnotations();
  }
  function ring(x: number, y: number, z: number, r = 7, color = "#69a37b") {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r - 1, r, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
      }),
    );
    m.position.set(x, y, z + 0.8);
    m.renderOrder = 6;
    return m;
  }
  function clearTargets() {
    targets.children.slice().forEach((o) => {
      targets.remove(o);
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  function placementCandidates(productId: string, rotation: number, itemId?: string) {
    const state = props().state;
    const cached = drag?.candidates;
    if (cached && cached.state === state && cached.productId === productId
      && cached.itemId === itemId && cached.rotation === rotation) return cached.values;
    const values = getInteractionPlacements(state, productId, rotation as 0, itemId);
    if (drag && drag.productId === productId && drag.itemId === itemId) {
      drag.candidates = { state, productId, itemId, rotation, values };
    }
    return values;
  }
  function updateTargets() {
    if (disposed || renderError) return;
    clearTargets();
    if (isExploded()) return;
    const p = props();
    const selected = p.state.items.find((item) => item.id === p.selectedId);
    const product = drag?.productId ?? p.activeProduct ?? selected?.productId;
    if (product) {
      const itemId = drag?.itemId ?? (!p.activeProduct ? selected?.id : undefined);
      const placements = placementCandidates(
        product,
        !drag && !p.activeProduct && selected ? selected.rotation : p.rotation,
        itemId,
      );
      const surfaceRay = new THREE.Raycaster();
      surfaceRay.layers.enable(MODEL_PICK_LAYER);
      placements.forEach((pos) => {
        // Do not intercept pointerdown on the item itself with its current target.
        if (selected && itemId === selected.id && pos.parentId === selected.parentId
          && Math.hypot(pos.x - selected.x, pos.y - selected.y, pos.z - selected.z) < .01) return;
        if (selected && itemId && p.state.items.some((item) => item.parentId === itemId)
          && !tryPlace(p.state, product, pos, pos.rotation, selected.colors, itemId).ok) return;
        const parent = objects.children.find((object) => object.userData.itemId === pos.parentId);
        if (!parent && pos.parentId !== "ground") return;
        const worldZ = pos.z + elevation(pos.parentId);
        // Keep indicators on a real supporting surface, including recessed magnet pockets.
        // Open access holes have no surface near the mounting height and get no floating marker.
        surfaceRay.set(new THREE.Vector3(pos.x, pos.y, worldZ + 4), new THREE.Vector3(0, 0, -1));
        surfaceRay.far = 9;
        const surface = parent ? surfaceRay.intersectObject(parent, true).find((hit) => hit.object.userData.modelMesh) : null;
        // A hole insert targets the opening itself, whether a lid is present or absent.
        if ((!surface && pos.parentId !== "ground" && getProduct(product).attachment !== "platform-hole" && getProduct(product).attachment !== "room-floor") || worldZ < p.state.bedding.depth) return;
        const marker = ring(pos.x, pos.y, worldZ, 8, "#467956");
        marker.userData.placement = pos;
        marker.userData.productId = product;
        marker.userData.itemId = itemId;
        targets.add(marker);
      });
    }
  }
  function updateAnnotations() {
    if (disposed || renderError) return;
    for (const object of [...annotations.children]) {
      annotations.remove(object);
      disposeAnnotation(object);
    }
    modelBounds = getRenderedModelBounds(objects);
    dimensionLabels.forEach((label, i) => { label.dataset.axis = ["长", "宽", "高"][i]; });
    selectedBounds = !isExploded() && props().selectedId
      ? getRenderedModelBounds(objects, props().selectedId!)
      : new THREE.Box3();
    if (props().connectionPlatform) selectedBounds = coverEditor.selectionBounds(props().selectedId) ?? new THREE.Box3();
    if (!selectedBounds.isEmpty()) annotations.add(createSelectionBox(selectedBounds));
    dimensionLines.visible = !isExploded() && props().showDimensions && !modelBounds.isEmpty();
    dimensionLabels.forEach((element) => { element.hidden = !dimensionLines.visible; });
    lastDimensionKey = "";
  }
  function project(point: THREE.Vector3) {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * host.clientWidth / 2, y: (1 - projected.y) * host.clientHeight / 2, z: projected.z };
  }
  function layoutAnnotations() {
    const p = props();
    toolbar.hidden = isExploded() || selectedBounds.isEmpty() || !p.selectedTitle || !!drag?.moved;
    if (!toolbar.hidden) {
      const { x, y } = getSelectionToolbarPosition(selectedBounds, camera,
        host.clientWidth, host.clientHeight, toolbar.offsetWidth, toolbar.offsetHeight, 72);
      toolbar.style.left = `${Math.round(x)}px`;
      toolbar.style.top = `${Math.round(y)}px`;
    }
    annotations.children.forEach((object) => updateSelectionStroke(object, camera, host.clientHeight));
    if (!dimensionLines.visible) return;
    const segments = dimensionSegments(modelBounds, camera.position);
    const geometryKey = segments.flatMap((segment) => segment.flatMap((point) => point.toArray())).join(",");
    if (geometryKey !== lastDimensionKey) {
      lastDimensionKey = geometryKey;
      const points: THREE.Vector3[] = [];
      segments.forEach(([start, end], index) => {
        points.push(start, end);
        const tick = index === 0 ? new THREE.Vector3(0, 3, 0) : new THREE.Vector3(3, 0, 0);
        points.push(start.clone().sub(tick), start.clone().add(tick), end.clone().sub(tick), end.clone().add(tick));
      });
      dimensionLines.geometry.dispose();
      dimensionLines.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }
    const values = dimensionsInCentimeters(modelBounds);
    segments.forEach(([start, end], i) => {
      const point = project(start.clone().lerp(end, .5));
      const element = dimensionLabels[i];
      element.hidden = point.z < -1 || point.z > 1 || point.x < 0 || point.y < 0 || point.x > host.clientWidth || point.y > host.clientHeight;
      element.textContent = `${element.dataset.axis} ${values[i]} cm`;
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
    });
  }
  function pickPlacement(x: number, y: number): Placement | undefined {
    const b = renderer.domElement.getBoundingClientRect();
    const candidates = targets.children.map((target) => {
      const projected = project(target.position);
      return { target, distance: Math.hypot(projected.x - (x - b.left), projected.y - (y - b.top)) };
    }).filter((candidate) => candidate.distance < 14).sort((a, b) => a.distance - b.distance);
    for (const { target } of candidates) {
      const direction = target.position.clone().sub(camera.position);
      const distance = direction.length();
      ray.set(camera.position, direction.normalize());
      ray.far = distance;
      const solid = ray.intersectObjects(objects.children, true)[0];
      ray.far = Infinity;
      if (solid && solid.distance < distance - 1) continue;
      return target.userData.placement as Placement | undefined;
    }
  }
  async function makeGhost(productId: string, itemId?: string) {
    const rev = ++ghostRevision;
    if (ghost) {
      scene.remove(ghost);
      release(ghost);
      ghost = null;
    }
    const product = getProduct(productId);
    const existing = props().state.items.find((i) => i.id === itemId);
    const g = await build(
      product.parts,
      product.origin,
      existing?.colors ?? props().getPreviewColors(productId),
      true, undefined, existing?.doorSide,
    );
    if (disposed || !drag || ghostRevision !== rev) {
      release(g);
      return;
    }
    ghost = g;
    g.visible = false;
    scene.add(g);
  }
  function startDrag(
    productId: string,
    x: number,
    y: number,
    itemId?: string,
    pointerId?: number,
  ) {
    if (disposed || renderError || contextUnavailable) return;
    restoreExploded();
    blankTaps.reset();
    drag = {
      pointerId,
      productId,
      itemId,
      startX: x,
      startY: y,
      moved: false,
      point: null,
      placement: null,
    };
    controls.enabled = false;
    const request = drag;
    void makeGhost(productId, itemId).catch(() => {
      if (disposed || drag !== request) return;
      stopForError("配件模型加载失败，设计和视角已保留。请重新加载3D。");
    });
    updateTargets();
  }
  function move(e: PointerEvent) {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 6) { pressed.moved = true; blankTaps.reset(); lastInvalidTapAt = performance.now(); }
    if (
      !drag ||
      touchPointers.size > 1 ||
      (drag.pointerId !== undefined && drag.pointerId !== e.pointerId)
    )
      return;
    drag.moved ||=
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6;
    if (!drag.moved) return;
    e.preventDefault();
    const p = props();
    const candidates = placementCandidates(drag.productId, p.rotation, drag.itemId);
    const at = pointAt(e.clientX, e.clientY);
    let nearest: Placement | null = null,
      dist = Infinity;
    for (const c of candidates) {
      const pos = at(c.z, c.parentId);
      if (!pos) continue;
      const d = Math.hypot(pos.x - c.x, pos.y - c.y);
      if (d < dist) {
        dist = d;
        nearest = c;
      }
    }
    const raw = at(nearest?.z ?? (defaultSurface() === "ground" ? 0 : 110), nearest?.parentId);
    drag.point = raw;
    drag.placement = dist <= 42 ? nearest : null;
    if (ghost) {
      ghost.visible = !!raw;
      if (raw) {
        const pos = drag.placement ?? raw;
        ghost.position.set(pos.x, pos.y, pos.z + elevation(drag.placement?.parentId ?? nearest?.parentId ?? defaultSurface()));
        ghost.rotation.z = ((drag.placement?.rotation ?? p.rotation) * Math.PI) / 180;
        ghost.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
              (m as THREE.MeshStandardMaterial).emissive.set(
                drag?.placement ? "#4d995b" : "#c64b50",
              );
              (m as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
            });
          }
        });
      }
    }
  }
  function end(e: PointerEvent) {
    touchPointers.delete(e.pointerId);
    if (
      !drag ||
      (drag.pointerId !== undefined && drag.pointerId !== e.pointerId)
    )
      return;
    const d = drag;
    drag = null;
    ghostRevision++;
    controls.enabled = true;
    if (ghost) {
      scene.remove(ghost);
      release(ghost);
      ghost = null;
    }
    if (d.moved) {
      if (d.point)
        props().onDrop(
          d.productId,
          d.placement ?? d.point,
          d.placement?.rotation ?? props().rotation,
          d.itemId,
        );
      else props().onDragEnd();
    }
    updateTargets();
  }
  function cancel(event?: Event) {
    if (event instanceof PointerEvent) touchPointers.delete(event.pointerId);
    if (event) { blankTaps.reset(); pressed = null; lastInvalidTapAt = performance.now(); }
    if (!drag) return;
    drag = null;
    ghostRevision++;
    controls.enabled = true;
    if (ghost) {
      scene.remove(ghost);
      release(ghost);
      ghost = null;
    }
    props().onDragEnd();
    updateTargets();
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 || touchPointers.size > 1) return;
    const placement = isExploded() || props().connectionPlatform ? undefined : pickPlacement(e.clientX, e.clientY);
    if (placement) {
      blankTaps.reset();
      lastInvalidTapAt = performance.now();
      pressed = { x: e.clientX, y: e.clientY, id: props().selectedId, at: performance.now(), placement };
      return;
    }
    const id = pick(e.clientX, e.clientY) ?? null;
    if (id) { blankTaps.reset(); lastInvalidTapAt = performance.now(); }
    pressed = { x: e.clientX, y: e.clientY, id, at: performance.now() };
    if (isExploded()) return;
    if (
      id &&
      id !== "base" &&
      props().selectedId === id &&
      !props().activeProduct
    ) {
      const item = props().state.items.find((i) => i.id === id);
      if (item)
        startDrag(item.productId, e.clientX, e.clientY, id, e.pointerId);
    }
  }
  function up(e: PointerEvent) {
    if (!pressed) return;
    const p = pressed;
    pressed = null;
    if (p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.at > 400) { blankTaps.reset(); lastInvalidTapAt = performance.now(); return; }
    if (!p.id && !p.placement && !props().activeProduct && !pick(e.clientX, e.clientY)) {
      lastBlankPointerUp = { x: e.clientX, y: e.clientY, at: performance.now(), pointerType: e.pointerType };
      if (blankTaps.tap(e.clientX, e.clientY, performance.now(), e.pointerType)) {
        toggleExploded();
        return;
      }
    } else { blankTaps.reset(); lastInvalidTapAt = performance.now(); }
    if (isExploded()) return;
    if (p.placement) {
      const selected = props().state.items.find((item) => item.id === props().selectedId);
      const productId = props().activeProduct ?? selected?.productId;
      if (productId)
        props().onDrop(productId, p.placement, p.placement.rotation, props().activeProduct ? undefined : selected?.id);
      return;
    }
    const active = props().activeProduct;
    if (active) {
      const placements = placementCandidates(active, props().rotation);
      const at = pointAt(e.clientX, e.clientY);
      let near: Placement | null = null,
        best = Infinity;
      for (const pos of placements) {
        const hit = at(pos.z, pos.parentId);
        if (hit) {
          const d = Math.hypot(hit.x - pos.x, hit.y - pos.y);
          if (d < best) {
            best = d;
            near = pos;
          }
        }
      }
      const hit = at(near?.z ?? (defaultSurface() === "ground" ? 0 : 110), near?.parentId);
      if (hit)
        props().onDrop(
          active,
          best <= 42 && near ? near : hit,
          best <= 42 && near ? near.rotation : props().rotation,
        );
    } else props().onSelect(p.id);
  }
  function nativeDoubleClick(event: MouseEvent) {
    const now = performance.now();
    // Some browsers/input bridges emit one pointer sequence plus a native dblclick.
    // Touch uses the pointer recognizer only; reject a model hit or any drag/pinch.
    if (event.button !== 0 || touchPointers.size || props().activeProduct || !lastBlankPointerUp
      || lastBlankPointerUp.pointerType !== "mouse" || now - lastBlankPointerUp.at > 400
      || now - lastInvalidTapAt < 400 || now - lastExplosionToggleAt < 400
      || Math.hypot(event.clientX - lastBlankPointerUp.x, event.clientY - lastBlankPointerUp.y) > 26
      || pick(event.clientX, event.clientY)) return;
    event.preventDefault();
    toggleExploded();
  }
  function touchStart(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPointers.add(e.pointerId);
      if (touchPointers.size > 1) {
        cancel();
        pressed = null;
        blankTaps.reset();
        lastInvalidTapAt = performance.now();
      }
    }
  }
  const element = renderer.domElement;
  element.addEventListener("webglcontextlost", contextLost);
  element.addEventListener("webglcontextrestored", contextRestored);
  renderer.debug.onShaderError = () => stopForError("当前3D材质未能正常显示，设计和视角已保留。请重新加载3D。");
  window.addEventListener("pointerdown", touchStart, true);
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  element.addEventListener("dblclick", nativeDoubleClick);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
  document.addEventListener("visibilitychange", visibilityChanged);
  const resize = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    updateViewportFraming();
    if (!contextUnavailable && !renderError) renderer.setSize(w, h);
  });
  resize.observe(host);
  if (bottomActions) resize.observe(bottomActions);
  const clock = new THREE.Clock();
  let lastBeddingVisible = true;
  const beddingFade = new BeddingFade();
  const draw = () => {
    if (disposed || renderError || contextUnavailable || document.hidden) return;
    try {
      controls.update();
      tickExplosion(performance.now());
      layoutAnnotations();
      const viewingUnderside = controls.getPolarAngle() > Math.PI / 2;
      const beddingVisible = !isExploded();
      const fading = beddingFade.step(controls.getPolarAngle(), performance.now());
      const beddingShadowsChanged = bedding.setOpacity(fading.opacity);
      if (floor.visible === viewingUnderside || lastBeddingVisible !== beddingVisible || beddingShadowsChanged || drag || hamster)
        invalidateShadows();
      bedding.setVisible(beddingVisible);
      lastBeddingVisible = beddingVisible;
      floor.visible = grid.visible = !viewingUnderside;
      lighting.underside.visible = viewingUnderside;
      hamster?.tick(Math.min(clock.getDelta(), .05));
      renderer.render(scene, camera);
      if (renderError || contextUnavailable) return;
      if (modelReady && !notifiedReady) { notifiedReady = true; ready(); }
      frame = requestAnimationFrame(draw);
    } catch (error) {
      console.error("3D frame failed", error);
      stopForError("3D 暂时无法继续显示，设计和视角已保留。请重新加载3D。");
    }
  };
  frame = requestAnimationFrame(draw);
  return {
    captureView: () => captureSceneView(camera, controls.target, lastViewResetKey),
    update,
    updateSelection,
    updateTargets,
    updateAnnotations,
    toggleExploded,
    startDrag: (productId: string, x: number, y: number, pointerId?: number) =>
      startDrag(productId, x, y, undefined, pointerId),
    home: () => { restoreExploded(); home(); },
    top: () => {
      restoreExploded();
      const center = sceneCenter();
      const footprint = getLayoutFootprint(props().state);
      const needed = Math.max((footprint.maxX - footprint.minX + 50) / camera.aspect, footprint.maxY - footprint.minY + 50);
      const distance = Math.max(900, needed / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
      camera.position.set(center.x, center.y - .1, contentTop() + distance);
      controls.target.copy(center);
      controls.update();
    },
    zoom: (amount: number) => {
      camera.position
        .sub(controls.target)
        .multiplyScalar(amount)
        .add(controls.target);
      controls.update();
    },
    snapshot: () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    },
    dispose: () => {
      disposed = true;
      revision++;
      cancelAnimationFrame(frame);
      resize.disconnect();
      disposeGestureLearning(); controls.dispose();
      modelBatches.dispose();
      hamster?.dispose();
      bedding.dispose();
      coverEditor.dispose();
      cagePreview.dispose();
      annotations.children.forEach(disposeAnnotation);
      annotations.clear();
      dimensionLines.geometry.dispose();
      dimensionLines.material.dispose();
      scene.remove(dimensionLines);
      dimensionLabels.forEach((element) => element.remove());
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => material.dispose());
      scene.remove(grid);
      window.removeEventListener("pointerdown", touchStart, true);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("dblclick", nativeDoubleClick);
      element.removeEventListener("webglcontextlost", contextLost);
      element.removeEventListener("webglcontextrestored", contextRestored);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("visibilitychange", visibilityChanged);
      explosion = explosionAnimation = null;
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh && !objects.getObjectById(o.id)) {
          o.geometry.dispose();
        }
      });
      release(scene);
      renderer.dispose();
      element.remove();
    },
  };
  } catch (error) {
    initializingControls?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    host.querySelectorAll(".scene-dimension-label").forEach(element => element.remove());
    throw error;
  }
}
