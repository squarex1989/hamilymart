import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadPart } from "../lib/offline-models";
import { budgetPixelRatio, FrameBudget, SCENE_GEOMETRY_BUDGET } from "../lib/render-budget";
import { PreviewQuality } from "../lib/preview-quality";
import { FramePacer, InteractionQuality } from "../lib/interaction-quality";
import { FoldVertical, RotateCw, Trash2 } from "lucide-react";
import {
  getProduct,
  getBaseParts,
} from "../data/catalog";
import type { ColorMap } from "../data/catalog";
import { getPlacements, getItemBounds, getPlatforms, getDisplayElevation, tryPlace } from "../lib/assembly";
import type { AssemblyState, Placement } from "../lib/assembly";
import modelIndex from "../data/model-index.json";
import { configureModelRenderer, createModelLighting, createModelMaterial, MODEL_CAMERA_DIRECTION } from "../lib/model-presentation";
import { createBedding } from "../lib/bedding-scene";
import { createHamsterSimulation } from "../lib/hamster-scene";
import { FEATURES } from "../data/features";
import { createSelectionBox, dimensionsInCentimeters, disposeAnnotation, getBoxCorners, getRenderedModelBounds, updateSelectionStroke } from "../lib/scene-annotations";
import { DimensionLayoutCache, OverlayElement, projectToViewport, ToolbarMetrics } from "../lib/scene-overlay-layout";
import { createExplodedLayout } from "../lib/exploded-view";
import { createBlankDoubleTap } from "../lib/scene-gestures";
import { applySceneViewport } from "../lib/scene-framing";
import "./scene-overlays.css";

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
  { bounds: number[]; components: { colorKey: string }[] }
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
    const toolbar = useRef<HTMLDivElement>(null);
    const current = useRef(props);
    current.current = props;
    const runtime = useRef<ReturnType<typeof createRuntime> | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
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
      try {
        runtime.current = createRuntime(
          host.current,
          () => current.current,
          () => {
            setLoading(false);
            current.current.onReady();
          },
          (e) => {
            setFailed(true);
            setLoading(false);
            current.current.onReady();
            current.current.onError(e);
          },
          toolbar.current!,
          setExploded,
        );
        runtime.current.update();
      } catch (error) {
        console.error("HamilyMart 3D initialization failed", error);
        setFailed(true);
        setLoading(false);
        current.current.onReady();
        current.current.onError("当前设备采用简化视图，仍可选配、调整颜色和查看清单。");
      }
      return () => {
        runtime.current?.dispose();
        runtime.current = null;
      };
    }, []);
    useEffect(() => {
      runtime.current?.update();
    }, [props.state, props.selectedId, props.viewResetKey]);
    useEffect(() => {
      runtime.current?.updateTargets();
    }, [props.activeProduct, props.rotation]);
    useEffect(() => {
      runtime.current?.updateAnnotations();
    }, [props.showDimensions]);
    return (
      <div ref={host} className="scene-canvas" aria-label="仓鼠屋 3D 装配画布">
        {exploded && <div className="scene-view-actions" onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={() => runtime.current?.toggleExploded()}><FoldVertical size={15} /><span>恢复组装</span></button>
        </div>}
        <div ref={toolbar} className="scene-item-toolbar" role="toolbar" aria-label="已选配件操作" hidden
          onPointerDown={(event) => event.stopPropagation()}>
          <span className="scene-item-title">{props.selectedTitle}</span>
          {(props.canRotate || props.canRemove) && <div className="scene-item-actions">
            {props.canRotate && <button type="button" aria-label="旋转已选配件" onClick={props.onRotate}><RotateCw size={16} /><span>旋转</span></button>}
            {props.canRemove && <button type="button" aria-label="移除已选配件" onClick={props.onRemove}><Trash2 size={16} /><span>移除</span></button>}
          </div>}
        </div>
        {loading && !failed && (
          <div className="scene-loading">
            <span className="loading-orbit" />
            <strong>正在搬来小小家…</strong>
            <span>加载真实 3D 模型</span>
          </div>
        )}
        {failed && (
          <div className="scene-loading scene-fallback" style={{padding: 20, overflowY: 'auto', justifyContent: 'flex-start'}}>
            <strong>简化搭配视图</strong>
            <span>仍可选配、换色、导入和查看清单</span>
            <label htmlFor="fallback-component">选择已搭建组件</label>
            <select id="fallback-component" value={props.selectedId ?? ''} onChange={event => props.onSelect(event.target.value || null)} style={{width: '90%', minHeight: 40, background: '#fcfbf5', color: '#315b45'}}>
              <option value="">选择组件…</option>
              {getPlatforms(props.state).map((platform, i) => <option key={platform.id} value={platform.id}>第 {i + 1} 个平台</option>)}
              {getPlatforms(props.state).filter(platform => platform.baseInsert === 'pool').map(platform => <option key={`pool:${platform.id}`} value={`pool:${platform.id}`}>圆形泳池 · {platform.id}</option>)}
              {props.state.items.map((item, i) => <option key={item.id} value={item.id}>{i + 1}. {getProduct(item.productId).name}</option>)}
              {getPlatforms(props.state).filter(platform => props.selectedId === platform.id || props.selectedId?.startsWith(`cover:${platform.id}:`)).flatMap(platform => ['H01','H02','H03','H04','H05'].filter(id => !platform.removedCovers.includes(id)).map(id => <option key={`${platform.id}:${id}`} value={`cover:${platform.id}:${id}`}>小圆盖 {id}</option>))}
            </select>
            <div style={{display: 'flex', marginTop: 8}}>
              {props.canRotate && <button type="button" onClick={props.onRotate}>旋转</button>}
              {props.canRemove && <button type="button" onClick={props.onRemove} style={{marginLeft: 8}}>移除</button>}
            </div>
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
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  const frameBudget = new FrameBudget();
  const interactionQuality = new InteractionQuality();
  const framePacer = new FramePacer();
  const previewQuality = new PreviewQuality();
  const invalidatePreview = () => previewQuality.invalidate(performance.now());
  let budgetStopped = false;
  let lastDrawTime = 0;
  let recentDrawTime = 0;
  let recentRafTime = 0;
  let measuringInteraction = false;
  let viewportWidth = Math.max(1, host.clientWidth), viewportHeight = Math.max(1, host.clientHeight);
  const applyPixelBudget = (still = false) => {
    const ratio = budgetPixelRatio(viewportWidth, viewportHeight, window.devicePixelRatio,
      frameBudget.reducedResolution || interactionQuality.dpr === 1, still,
      Math.min(4096, renderer.capabilities.maxTextureSize), interactionQuality.dpr);
    if (Math.abs(renderer.getPixelRatio() - ratio) < .001) return false;
    renderer.setPixelRatio(ratio);
    return true;
  };
  renderer.setSize(viewportWidth, viewportHeight, false);
  applyPixelBudget();
  configureModelRenderer(renderer);
  renderer.shadowMap.enabled = false;
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#DDE0E2");
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 10, 4500);
  camera.up.set(0, 0, 1);
  const bottomActions = host.parentElement?.querySelector<HTMLElement>(".canvas-bottom-actions");
  const priceButton = host.parentElement?.querySelector<HTMLElement>(".canvas-price");
  let toolbarTopInset = 8;
  let toolbarBottomInset = 64;
  const updateViewportFraming = () => {
    const canvasBounds = host.getBoundingClientRect();
    const actionsBounds = bottomActions?.getBoundingClientRect();
    const priceBounds = priceButton?.getBoundingClientRect();
    toolbarTopInset = priceBounds && priceBounds.height > 0
      ? Math.max(8, priceBounds.bottom - canvasBounds.top + 8) : 8;
    const overlaps = actionsBounds && actionsBounds.width > 0 && actionsBounds.height > 0
      && actionsBounds.left < canvasBounds.right && actionsBounds.right > canvasBounds.left
      && actionsBounds.top < canvasBounds.bottom && actionsBounds.bottom > canvasBounds.top;
    const bottomInset = overlaps ? canvasBounds.bottom - actionsBounds.top + 10 : 0;
    toolbarBottomInset = bottomInset;
    applySceneViewport(camera, host.clientWidth, host.clientHeight, bottomInset);
  };
  const controls = new OrbitControls(camera, renderer.domElement);
  let cameraInteracting = false;
  const cameraInteractionStarted = () => { cameraInteracting = true; invalidatePreview(); };
  const cameraInteractionEnded = () => { cameraInteracting = false; invalidatePreview(); };
  controls.addEventListener("start", cameraInteractionStarted);
  controls.addEventListener("end", cameraInteractionEnded);
  controls.addEventListener("change", invalidatePreview);
  controls.enableDamping = true;
  // Initial damping; the loop adjusts it to the actual frame interval.
  controls.dampingFactor = 0.2;
  controls.minDistance = 300;
  controls.maxDistance = 4000;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.enablePan = true;
  controls.target.set(150, 150, 80);
  const contentTop = () =>
    Math.max(props().state.bedding.depth, Math.max(
      110,
      ...props().state.items.flatMap((item) =>
        getItemBounds(item).map((b) => b[5]),
      ),
    ) + getDisplayElevation(props().state));
  const sceneCenter = () => {
    const platforms = getPlatforms(props().state);
    return new THREE.Vector3(
      platforms.reduce((sum, p) => sum + p.x + 150, 0) / platforms.length,
      platforms.reduce((sum, p) => sum + p.y + 150, 0) / platforms.length,
      contentTop() * .48,
    );
  };
  const home = () => {
    // Drain orbit inertia before assigning an explicitly requested new view.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    updateViewportFraming();
    const height = contentTop();
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.copy(sceneCenter());
    camera.position.copy(
      new THREE.Vector3(...MODEL_CAMERA_DIRECTION)
        .normalize()
        .multiplyScalar(Math.max(1000 + (getPlatforms(props().state).length - 1) * 540, height * 2.85) * Math.max(1, .95 / camera.aspect))
        .add(controls.target),
    );
    controls.update();
    controls.enableDamping = damping;
    invalidatePreview();
  };
  home();
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
  const bedding = createBedding(scene);
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
  const toolbarOverlay = new OverlayElement(toolbar);
  const toolbarMetrics = new ToolbarMetrics();
  const labelOverlays = dimensionLabels.map(element => new OverlayElement(element));
  const dimensionLayout = new DimensionLayoutCache();
  let selectionCorners: THREE.Vector3[] = [];
  const projectedCorner = new THREE.Vector3();
  let ghost: THREE.Group | null = null;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let disposed = false,
    revision = 0,
    ghostRevision = 0;
  let frame = 0;
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
  let renderedState: AssemblyState | null = null;
  let consumedViewResetKey = props().viewResetKey ?? 0;
  let drag: {
    pointerId?: number;
    productId: string;
    itemId?: string;
    startX: number;
    startY: number;
    moved: boolean;
    point: Point | null;
    placement: Placement | null;
  } | null = null;
  const elevation = () => getDisplayElevation(props().state);
  const isExploded = () => exploded || explosionProgress > 0;
  function showSeams(visible: boolean) {
    objects.traverse(node => { if (node instanceof THREE.Mesh && node.userData.ownedGeometry && !node.userData.modelMesh) node.visible = visible; });
  }
  function restoreExploded(refresh = true) {
    if (!explosion) return;
    explosion.restore();
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
    if (!modelReady || disposed) return;
    lastExplosionToggleAt = performance.now();
    cancel();
    pressed = null;
    blankTaps.reset();
    if (!explosion) {
      explosion = createExplodedLayout(objects);
      if (!explosion.pieces.length) { explosion = null; return; }
    }
    exploded = !exploded;
    invalidatePreview();
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
    if (t === 1) {
      explosionAnimation = null;
      if (!exploded) restoreExploded();
    }
  }
  function visibilityChanged() {
    blankTaps.reset(); pressed = null;
    cameraInteracting = false;
    touchPointers.clear();
    cancel();
    recentRafTime = 0; measuringInteraction = false;
    interactionQuality.reset(); framePacer.reset();
    if (document.hidden) cancelAnimationFrame(frame);
    else if (!budgetStopped && !disposed) { lastDrawTime = recentDrawTime = 0; frameBudget.reset(); invalidatePreview(); clock.getDelta(); cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }
  }
  function stopForFallback(message: string) {
    if (budgetStopped || disposed) return;
    budgetStopped = true; cancelAnimationFrame(frame); controls.enabled = false;
    renderer.domElement.style.display = 'none'; toolbar.hidden = true;
    dimensionLabels.forEach(label => { label.hidden = true; });
    fail(message);
  }
  function contextLost(event: Event) { event.preventDefault(); stopForFallback('3D 显示暂不可用，已保留设计并切换为简化视图。'); }
  function contextRestored() { /* The preserved design stays editable in bounded DOM fallback. */ }

  function pointAt(x: number, y: number, z = 110): Point | null {
    const b = renderer.domElement.getBoundingClientRect();
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null;
    pointer.set(
      ((x - b.left) / b.width) * 2 - 1,
      (-(y - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const p = ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -(z + elevation())),
      new THREE.Vector3(),
    );
    return p ? { x: p.x, y: p.y, z } : null;
  }
  function pick(x: number, y: number) {
    const b = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((x - b.left) / b.width) * 2 - 1,
      (-(y - b.top) / b.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
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
  ) {
    const group = new THREE.Group();
    await Promise.all(
      parts.map(async (part) => {
        const loaded = await loadPart(part.id);
        const child = loaded.clone(true);
        const editingOwner = !!ownerId && (props().selectedId === ownerId || props().selectedId?.startsWith(`cover:${ownerId}:`));
        const selectionId = ownerId && /^(base|base2|base3)$/.test(ownerId)
          ? (/^H0[1-5]$/.test(part.id) && editingOwner ? `cover:${ownerId}:${part.id}` : part.id === "B01" ? `pool:${ownerId}` : ownerId)
          : ownerId;
        child.userData.selectionId = selectionId;
        child.userData.partId = part.id;
        child.position.set(
          -origin[0] + (part.offset?.[0] ?? 0),
          -origin[1] + (part.offset?.[1] ?? 0),
          -origin[2] + (part.offset?.[2] ?? 0),
        );
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
        if (/^H0[1-5]$/.test(part.id) && !preview && editingOwner) {
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
          seam.userData.coverSeam = true;
          child.add(seam);
        }
        group.add(child);
      }),
    );
    return group;
  }
  async function update() {
    if (budgetStopped || disposed) return;
    const s = props().state;
    const nextResetKey = props().viewResetKey ?? 0;
    const resetView = nextResetKey !== consumedViewResetKey;
    if (renderedState === s && !resetView) {
      if (modelReady) updateSelection();
      return;
    }
    renderedState = s;
    consumedViewResetKey = nextResetKey;
    invalidatePreview();
    recentDrawTime = 0;
    frameBudget.reset();
    interactionQuality.reset(); measuringInteraction = false;
    modelReady = false;
    // Explicit edits return to assembly mode before replacing imported meshes.
    restoreExploded(false);
    const rev = ++revision;
    bedding.update(s);
    if (resetView) home();
    const old = [...objects.children];
    old.forEach((o) => {
      objects.remove(o);
      release(o);
    });
    const definitions = [
      ...getPlatforms(s).map(platform => ({
        id: platform.id,
        parts: getBaseParts(s.legHeight, platform.baseInsert, platform.removedCovers),
        origin: [0, 0, 0],
        colors: platform.baseColors,
        x: platform.x,
        y: platform.y,
        z: 0,
        rotation: 0,
      })),
      ...s.items.map((item) => ({
        ...item,
        parts: getProduct(item.productId).parts,
        origin: getProduct(item.productId).origin,
      })),
    ];
    try {
      await Promise.all(
        definitions.map(async (def) => {
          const g = await build(
            def.parts,
            def.origin,
            def.colors,
            false,
            def.id,
          );
          if (disposed || revision !== rev) {
            release(g);
            return;
          }
          g.position.set(def.x, def.y, def.z + elevation());
          g.rotation.z = (def.rotation * Math.PI) / 180;
          g.userData.itemId = def.id;
          objects.add(g);
        }),
      );
      if (rev === revision && !disposed) {
        modelReady = true;
        objects.updateMatrixWorld(true);
        hamster?.update(s);
        const center = sceneCenter();
        lighting.centerAt(center.x, center.y);
        ready();
        updateSelection();
      }
    } catch (e) {
      if (!disposed) {
        console.error(e);
        stopForFallback("部分本地模型暂不可用，已切换为简化视图。");
      }
    }
  }
  function updateSelection() {
    // Picking is presentation state: reuse meshes and only change their hit IDs
    // and removable-cover seams. It must never rebuild or reframe the scene.
    const selectedId = props().selectedId;
    for (const group of objects.children) {
      const ownerId = group.userData.itemId as string;
      const platform = /^(base|base2|base3)$/.test(ownerId);
      const editingOwner = selectedId === ownerId || !!selectedId?.startsWith(`cover:${ownerId}:`);
      for (const child of group.children) {
        const partId = child.userData.partId as string;
        const cover = /^H0[1-5]$/.test(partId);
        child.userData.selectionId = platform
          ? (cover && editingOwner ? `cover:${ownerId}:${partId}` : partId === "B01" ? `pool:${ownerId}` : ownerId)
          : ownerId;
        let seam = child.children.find(node => node.userData.coverSeam);
        if (platform && cover && editingOwner && !seam) {
          const b = index[partId].bounds, radius = (b[3] - b[0]) / 2;
          const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 1, radius, 64), new THREE.MeshBasicMaterial({
            color: "#89977e", transparent: true, opacity: .6, depthWrite: false,
          }));
          mesh.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5] + .08);
          mesh.userData.ownedGeometry = mesh.userData.coverSeam = true;
          child.add(mesh); seam = mesh;
        } else if (seam && !editingOwner) {
          child.remove(seam); release(seam); seam = undefined;
        }
        if (seam) seam.visible = !isExploded();
      }
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
    m.position.set(x, y, z + elevation() + 0.8);
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
  function updateTargets() {
    invalidatePreview();
    clearTargets();
    if (isExploded()) return;
    const p = props();
    const selected = p.state.items.find((item) => item.id === p.selectedId);
    const product = drag?.productId ?? p.activeProduct ?? selected?.productId;
    if (product) {
      const itemId = drag?.itemId ?? (!p.activeProduct ? selected?.id : undefined);
      const placements = getPlacements(
        p.state,
        product,
        (!p.activeProduct && selected ? selected.rotation : p.rotation) as 0,
        itemId,
      );
      const surfaceRay = new THREE.Raycaster();
      placements.forEach((pos) => {
        if (selected && itemId && p.state.items.some((item) => item.parentId === itemId)
          && !tryPlace(p.state, product, pos, pos.rotation, selected.colors, itemId).ok) return;
        const parent = objects.children.find((object) => object.userData.itemId === pos.parentId);
        if (!parent) return;
        // Keep indicators on a real supporting surface, including recessed magnet pockets.
        // Open access holes have no surface near the mounting height and get no floating marker.
        surfaceRay.set(new THREE.Vector3(pos.x, pos.y, pos.z + elevation() + 4), new THREE.Vector3(0, 0, -1));
        surfaceRay.far = 9;
        const surface = surfaceRay.intersectObject(parent, true).find((hit) => hit.object.userData.modelMesh);
        if (!surface || pos.z + elevation() < p.state.bedding.depth) return;
        const marker = ring(pos.x, pos.y, pos.z, 8, "#467956");
        marker.userData.placement = pos;
        marker.userData.productId = product;
        marker.userData.itemId = itemId;
        targets.add(marker);
      });
    }
  }
  function updateAnnotations() {
    invalidatePreview();
    for (const object of [...annotations.children]) {
      annotations.remove(object);
      disposeAnnotation(object);
    }
    modelBounds = getRenderedModelBounds(objects);
    selectedBounds = !isExploded() && props().selectedId
      ? getRenderedModelBounds(objects, props().selectedId!)
      : new THREE.Box3();
    selectionCorners = selectedBounds.isEmpty() ? [] : getBoxCorners(selectedBounds);
    toolbarMetrics.invalidate();
    if (!selectedBounds.isEmpty()) annotations.add(createSelectionBox(selectedBounds));
    dimensionLines.visible = !isExploded() && props().showDimensions && !modelBounds.isEmpty();
    const values = dimensionsInCentimeters(modelBounds);
    labelOverlays.forEach((overlay, i) => {
      overlay.show(dimensionLines.visible);
      overlay.text(`${dimensionLabels[i].dataset.axis} ${values[i]} cm`);
    });
    dimensionLayout.invalidate();
  }
  function project(point: THREE.Vector3, target = new THREE.Vector3()) {
    return projectToViewport(point, camera, viewportWidth, viewportHeight, target);
  }
  function layoutAnnotations() {
    const p = props();
    const showToolbar = !isExploded() && !selectedBounds.isEmpty() && !!p.selectedTitle && !drag?.moved;
    toolbarOverlay.show(showToolbar);
    if (showToolbar) {
      // Measuring is only needed after revealing changed content or changing the viewport.
      // Ordinary orbit frames have no DOM layout reads, including corner projection.
      toolbarMetrics.measure(toolbar, viewportWidth, viewportHeight, p.selectedTitle, p.canRotate, p.canRemove);
      const halfWidth = toolbarMetrics.width / 2;
      const toolbarHeight = toolbarMetrics.height;
      let top = Infinity, left = Infinity, right = -Infinity;
      for (let i = 0; i < selectionCorners.length; i++) {
        const point = project(selectionCorners[i], projectedCorner);
        top = Math.min(top, point.y);
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
      }
      // Only move the HTML toolbar. Selection never moves the camera/target.
      const maximumTop = Math.max(toolbarTopInset, viewportHeight - toolbarBottomInset - toolbarHeight - 8);
      const x = Math.max(halfWidth + 8, Math.min(viewportWidth - halfWidth - 8, (left + right) / 2));
      const y = THREE.MathUtils.clamp(top - toolbarHeight - 10, toolbarTopInset, maximumTop);
      toolbarOverlay.position(Math.round(x), Math.round(y));
    }
    annotations.children.forEach((object) => updateSelectionStroke(object, camera, viewportHeight));
    if (!dimensionLines.visible) return;
    if (dimensionLayout.update(modelBounds, camera.position)) {
      const points: THREE.Vector3[] = [];
      dimensionLayout.segments.forEach(([start, end], index) => {
        points.push(start, end);
        const tick = index === 0 ? new THREE.Vector3(0, 3, 0) : new THREE.Vector3(3, 0, 0);
        points.push(start.clone().sub(tick), start.clone().add(tick), end.clone().sub(tick), end.clone().add(tick));
      });
      dimensionLines.geometry.dispose();
      dimensionLines.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }
    dimensionLayout.midpoints.forEach((midpoint, i) => {
      const point = project(midpoint, projectedCorner);
      labelOverlays[i].show(point.z >= -1 && point.z <= 1 && point.x >= 0 && point.y >= 0 && point.x <= viewportWidth && point.y <= viewportHeight);
      labelOverlays[i].position(point.x, point.y);
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
      true,
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
    void makeGhost(productId, itemId).catch(() => {
      cancel();
      fail("配件模型加载失败，请重试。");
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
    const candidates = getPlacements(
      p.state,
      drag.productId,
      p.rotation as 0,
      drag.itemId,
    );
    let nearest: Placement | null = null,
      dist = Infinity;
    for (const c of candidates) {
      const pos = pointAt(e.clientX, e.clientY, c.z);
      if (!pos) continue;
      const d = Math.hypot(pos.x - c.x, pos.y - c.y);
      if (d < dist) {
        dist = d;
        nearest = c;
      }
    }
    const raw = pointAt(e.clientX, e.clientY, nearest?.z ?? 110);
    drag.point = raw;
    drag.placement = dist <= 42 ? nearest : null;
    if (ghost) {
      ghost.visible = !!raw;
      if (raw) {
        const pos = drag.placement ?? raw;
        ghost.position.set(pos.x, pos.y, pos.z + elevation());
        ghost.rotation.z = (p.rotation * Math.PI) / 180;
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
          props().rotation,
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
    const placement = isExploded() ? undefined : pickPlacement(e.clientX, e.clientY);
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
      const placements = getPlacements(
        props().state,
        active,
        props().rotation as 0,
      );
      let near: Placement | null = null,
        best = Infinity;
      for (const pos of placements) {
        const hit = pointAt(e.clientX, e.clientY, pos.z);
        if (hit) {
          const d = Math.hypot(hit.x - pos.x, hit.y - pos.y);
          if (d < best) {
            best = d;
            near = pos;
          }
        }
      }
      const hit = pointAt(e.clientX, e.clientY, near?.z ?? 110);
      if (hit)
        props().onDrop(
          active,
          best <= 42 && near ? near : hit,
          props().rotation,
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
  renderer.debug.onShaderError = () => stopForFallback("当前设备无法显示此材质，已切换为简化视图。");
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
    viewportWidth = w; viewportHeight = h;
    invalidatePreview();
    recentDrawTime = 0;
    frameBudget.reset();
    interactionQuality.reset(); framePacer.reset(); measuringInteraction = false;
    applyPixelBudget();
    renderer.setSize(w, h, false);
    updateViewportFraming();
  });
  resize.observe(host);
  if (bottomActions) resize.observe(bottomActions);
  if (priceButton) resize.observe(priceButton);
  const clock = new THREE.Clock();
  const draw = (time = performance.now()) => {
    if (disposed || budgetStopped || document.hidden) return;
    frame = requestAnimationFrame(draw);
    // Measure the browser's unsuppressed cadence, not our own 30 FPS cap.
    if (measuringInteraction && recentRafTime && !frameBudget.reducedResolution)
      interactionQuality.observeRaf(time - recentRafTime);
    recentRafTime = time;
    if (!framePacer.shouldDraw(time, frameBudget.reducedResolution ? 30 : interactionQuality.fps)) return;
    const frameStarted = performance.now();
    const controlDelta = lastDrawTime ? Math.min(65, time - lastDrawTime) : 1000 / 30;
    lastDrawTime = time;
    // Keep inertia duration comparable at 30 and 60 FPS.
    controls.dampingFactor = 1 - Math.pow(.8, controlDelta / (1000 / 30));
    controls.update();
    tickExplosion(time);
    const quality = previewQuality.nextFrame(time,
      !modelReady || cameraInteracting || !!pressed || !!drag || !!explosionAnimation || !!hamster);
    if (quality === 'skip') {
      recentDrawTime = 0; measuringInteraction = false;
      frameBudget.reset(); interactionQuality.reset(); return;
    }
    layoutAnnotations();
    const resizedBuffer = applyPixelBudget(quality === 'still');
    measuringInteraction = quality === 'interactive' && modelReady && !resizedBuffer;
    if (!measuringInteraction) interactionQuality.reset();
    const elapsed = recentDrawTime && !resizedBuffer && quality === 'interactive' ? time - recentDrawTime : 0;
    recentDrawTime = quality === 'interactive' ? time : 0;
    // A settled high-resolution draw, resize, hidden-tab pause or model upload
    // is not evidence that continuous interaction has become slow.
    if (elapsed > 0 && modelReady) {
      const action = frameBudget.sample(elapsed);
      if (action === 'fallback') { stopForFallback('当前场景较复杂，已保留设计并切换为简化视图。'); return; }
      if (action === 'reduce-resolution') { applyPixelBudget(); bedding.setLowQuality(true); }
    }
    const viewingUnderside = controls.getPolarAngle() > Math.PI / 2;
    bedding.setVisible(!viewingUnderside && !isExploded());
    bedding.setLowQuality(frameBudget.reducedResolution || interactionQuality.dpr === 1);
    floor.visible = grid.visible = !viewingUnderside;
    lighting.underside.visible = viewingUnderside;
    let triangles = 0, calls = 0;
    scene.traverseVisible(object => {
      if (object instanceof THREE.Mesh) {
        triangles += ((object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3) * (object instanceof THREE.InstancedMesh ? object.count : 1);
        calls += Array.isArray(object.material) ? Math.max(1, object.geometry.groups.length) : 1;
      } else if (object instanceof THREE.Line || object instanceof THREE.Points) calls++;
    });
    if (triangles > SCENE_GEOMETRY_BUDGET.triangles || calls > SCENE_GEOMETRY_BUDGET.calls) {
      stopForFallback('当前场景较复杂，已保留全部配件，切换为简化视图。'); return;
    }
    hamster?.tick(Math.min(clock.getDelta(), .05));
    try {
      renderer.render(scene, camera);
      if (measuringInteraction) interactionQuality.recordRender(performance.now() - frameStarted);
    }
    catch (error) {
      console.error("HamilyMart 3D frame failed", error);
      stopForFallback('3D 显示暂不可用，已切换为简化视图。');
    }
  };
  draw();
  return {
    update,
    updateTargets,
    updateAnnotations,
    toggleExploded,
    startDrag: (productId: string, x: number, y: number, pointerId?: number) =>
      startDrag(productId, x, y, undefined, pointerId),
    home: () => { restoreExploded(); home(); },
    top: () => {
      restoreExploded();
      const center = sceneCenter();
      const distance = Math.max(900, getPlatforms(props().state).length * 350 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
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
      controls.removeEventListener("start", cameraInteractionStarted);
      controls.removeEventListener("end", cameraInteractionEnded);
      controls.removeEventListener("change", invalidatePreview);
      controls.dispose();
      hamster?.dispose();
      bedding.dispose();
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
}
