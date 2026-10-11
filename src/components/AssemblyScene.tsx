import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RotateCw, Trash2 } from "lucide-react";
import {
  MODEL_ASSET_VERSION,
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
import { createSelectionBox, dimensionSegments, dimensionsInCentimeters, disposeAnnotation, getBoxCorners, getRenderedModelBounds, updateSelectionStroke } from "../lib/scene-annotations";
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
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const index = modelIndex as Record<
  string,
  { url: string; bounds: number[]; components: { colorKey: string }[] }
>;
function loadPart(id: string) {
  if (!cache.has(id))
    cache.set(
      id,
      loader.loadAsync(`${index[id].url}?v=${MODEL_ASSET_VERSION}`).then((g) => g.scene),
    );
  return cache.get(id)!;
}
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
            current.current.onError(e);
          },
          toolbar.current!,
        );
        runtime.current.update();
      } catch {
        setFailed(true);
        setLoading(false);
        current.current.onError(
          "3D 画布未能启动，请使用支持 WebGL 的浏览器重试。",
        );
      }
      return () => {
        runtime.current?.dispose();
        runtime.current = null;
      };
    }, []);
    useEffect(() => {
      runtime.current?.update();
    }, [props.state, props.selectedId]);
    useEffect(() => {
      runtime.current?.updateTargets();
    }, [props.activeProduct, props.rotation]);
    useEffect(() => {
      runtime.current?.updateAnnotations();
    }, [props.showDimensions]);
    return (
      <div ref={host} className="scene-canvas" aria-label="仓鼠屋 3D 装配画布">
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
          <div className="scene-loading">
            <strong>暂时无法显示 3D</strong>
            <span>请刷新页面，或使用支持 WebGL 的浏览器</span>
            <button onClick={() => location.reload()}>重新加载</button>
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
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  configureModelRenderer(renderer);
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#DDE0E2");
  const camera = new THREE.PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 10, 4500);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
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
  let framedTop = contentTop();
  let framedLayout = JSON.stringify(getPlatforms(props().state).map(p => [p.x, p.y]));
  const sceneCenter = () => {
    const platforms = getPlatforms(props().state);
    return new THREE.Vector3(
      platforms.reduce((sum, p) => sum + p.x + 150, 0) / platforms.length,
      platforms.reduce((sum, p) => sum + p.y + 150, 0) / platforms.length,
      contentTop() * .48,
    );
  };
  const home = () => {
    const height = contentTop();
    controls.target.copy(sceneCenter());
    camera.position.copy(
      new THREE.Vector3(...MODEL_CAMERA_DIRECTION)
        .normalize()
        .multiplyScalar(Math.max(1000 + (getPlatforms(props().state).length - 1) * 540, height * 2.85) * Math.max(1, .95 / camera.aspect))
        .add(controls.target),
    );
    controls.update();
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
  let lastDimensionKey = "";
  let ghost: THREE.Group | null = null;
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let disposed = false,
    revision = 0,
    ghostRevision = 0;
  let frame = 0;
  let pressed: { x: number; y: number; id: string | null; placement?: Placement } | null = null;
  const touchPointers = new Set<number>();
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
          child.add(seam);
        }
        group.add(child);
      }),
    );
    return group;
  }
  async function update() {
    const rev = ++revision;
    const s = props().state;
    const layout = JSON.stringify(getPlatforms(s).map(p => [p.x, p.y]));
    bedding.update(s);
    if (Math.abs(contentTop() - framedTop) > 30 || layout !== framedLayout) {
      framedTop = contentTop();
      framedLayout = layout;
      home();
    }
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
        objects.updateMatrixWorld(true);
        hamster?.update(s);
        const center = sceneCenter();
        lighting.centerAt(center.x, center.y);
        ready();
        updateTargets();
        updateAnnotations();
      }
    } catch (e) {
      if (!disposed) {
        console.error(e);
        fail("部分模型加载失败，请刷新页面重试。");
      }
    }
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
    clearTargets();
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
    for (const object of [...annotations.children]) {
      annotations.remove(object);
      disposeAnnotation(object);
    }
    modelBounds = getRenderedModelBounds(objects);
    selectedBounds = props().selectedId
      ? getRenderedModelBounds(objects, props().selectedId!)
      : new THREE.Box3();
    if (!selectedBounds.isEmpty()) annotations.add(createSelectionBox(selectedBounds));
    dimensionLines.visible = props().showDimensions && !modelBounds.isEmpty();
    dimensionLabels.forEach((element) => { element.hidden = !dimensionLines.visible; });
    lastDimensionKey = "";
  }
  function project(point: THREE.Vector3) {
    const projected = point.clone().project(camera);
    return { x: (projected.x + 1) * host.clientWidth / 2, y: (1 - projected.y) * host.clientHeight / 2, z: projected.z };
  }
  function layoutAnnotations() {
    const p = props();
    toolbar.hidden = selectedBounds.isEmpty() || !p.selectedTitle || !!drag?.moved;
    if (!toolbar.hidden) {
      const worldCorners = getBoxCorners(selectedBounds);
      let corners = worldCorners.map(project);
      let top = Math.min(...corners.map((corner) => corner.y));
      const halfWidth = toolbar.offsetWidth / 2;
      const toolbarHeight = toolbar.offsetHeight;
      const minimumTop = toolbarHeight + 18;
      // The website header is outside this clipped canvas. Keep an 8 px inset
      // at its upper edge and leave the bottom 56 px for the global controls.
      const maximumTop = Math.max(minimumTop, host.clientHeight - 64);
      const desiredTop = THREE.MathUtils.clamp(top, minimumTop, maximumTop);
      // Keep the toolbar in the air above the entire selection, even after a tight zoom.
      // Moving camera and target together preserves the viewing angle and selected object scale.
      if (Math.abs(desiredTop - top) > .5 && !drag) {
        const topCorner = worldCorners[corners.findIndex((corner) => corner.y === top)];
        const depth = Math.max(1, -topCorner.clone().applyMatrix4(camera.matrixWorldInverse).z);
        const mmPerPixel = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, host.clientHeight);
        const offset = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar((desiredTop - top) * mmPerPixel);
        camera.position.add(offset);
        controls.target.add(offset);
        camera.updateMatrixWorld();
        corners = worldCorners.map(project);
        top = Math.min(...corners.map((corner) => corner.y));
      }
      const left = Math.min(...corners.map((corner) => corner.x));
      const right = Math.max(...corners.map((corner) => corner.x));
      const x = Math.max(halfWidth + 8, Math.min(host.clientWidth - halfWidth - 8, (left + right) / 2));
      const y = Math.max(8, top - toolbarHeight - 10);
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
    const placement = pickPlacement(e.clientX, e.clientY);
    if (placement) {
      pressed = { x: e.clientX, y: e.clientY, id: props().selectedId, placement };
      return;
    }
    const id = pick(e.clientX, e.clientY) ?? null;
    pressed = { x: e.clientX, y: e.clientY, id };
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
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) return;
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
  function touchStart(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPointers.add(e.pointerId);
      if (touchPointers.size > 1) {
        cancel();
        pressed = null;
      }
    }
  }
  const element = renderer.domElement;
  window.addEventListener("pointerdown", touchStart, true);
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
  const resize = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    const aspectChanged = Math.abs(camera.aspect - w / h) > .05;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (aspectChanged) home();
  });
  resize.observe(host);
  const clock = new THREE.Clock();
  const draw = () => {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    controls.update();
    layoutAnnotations();
    const viewingUnderside = controls.getPolarAngle() > Math.PI / 2;
    bedding.setVisible(!viewingUnderside);
    floor.visible = grid.visible = !viewingUnderside;
    lighting.underside.visible = viewingUnderside;
    hamster?.tick(Math.min(clock.getDelta(), .05));
    renderer.render(scene, camera);
  };
  draw();
  return {
    update,
    updateTargets,
    updateAnnotations,
    startDrag: (productId: string, x: number, y: number, pointerId?: number) =>
      startDrag(productId, x, y, undefined, pointerId),
    home,
    top: () => {
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
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
