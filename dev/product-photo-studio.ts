import * as THREE from 'three';
import { VISIBLE_PRODUCTS, getBaseParts, getProduct, type ProductPart, type ColorMap } from '../src/data/catalog';
import { getBaseStyleColors, getProductStyleColors } from '../src/lib/color-styles';
import { loadPart } from '../src/lib/model-loader';
import { configureModelRenderer, createModelLighting, createModelMaterial, MODEL_CAMERA_DIRECTION, MODEL_RENDER_VERSION } from '../src/lib/model-presentation';
import { createExplodedLayout } from './photo-exploded-view';
import { getRenderedModelBounds, dimensionSegments, dimensionsInCentimeters } from '../src/lib/scene-annotations';
import { createNewUserState } from '../src/lib/starter-assembly';
import { applyInspirationLayout } from '../src/lib/inspiration';
import { getPlatforms } from '../src/lib/assembly';

type Mode = 'preview' | 'dimensions' | 'exploded' | 'exploded-reverse';
interface PhotoDefinition { id: string; name: string; kind: 'product' | 'platform' | 'set'; legHeight?: 0 | 100 | 200 | 300 }
const SIZE = 2400, RENDER_SIZE = 3000;
const definitions: PhotoDefinition[] = [
  ...([0, 100, 200, 300] as const).map(legHeight => ({ id: `platform-${legHeight}`, name: `基础平台（${legHeight ? `${legHeight / 10}cm腿` : '无腿'}）`, kind: 'platform' as const, legHeight })),
  ...VISIBLE_PRODUCTS.map(product => ({ id: product.id, name: product.name, kind: 'product' as const })),
  { id: 'christmas-pool-villa', name: '圣诞泳池小屋', kind: 'set' },
];
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
configureModelRenderer(renderer);
renderer.setClearColor('#ffffff', 1);
renderer.setPixelRatio(1); renderer.setSize(RENDER_SIZE, RENDER_SIZE);
document.querySelector('#renderer')!.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
const lighting = createModelLighting(scene);
lighting.sun.shadow.mapSize.set(4096, 4096);
const camera = new THREE.OrthographicCamera(-200, 200, 200, -200, .1, 20000);
camera.up.set(0, 0, 1);
// A short, soft studio contact shadow keeps the white backdrop seamless.
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 256;
const shadowContext = shadowCanvas.getContext('2d')!, gradient = shadowContext.createRadialGradient(128, 128, 20, 128, 128, 128);
gradient.addColorStop(0, 'rgba(38,52,44,.12)'); gradient.addColorStop(.5, 'rgba(38,52,44,.055)'); gradient.addColorStop(1, 'rgba(38,52,44,0)');
shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 256, 256);
const shadowTexture = new THREE.CanvasTexture(shadowCanvas); shadowTexture.colorSpace = THREE.SRGBColorSpace;
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
scene.add(shadowPlane);
const output = document.createElement('canvas'); output.width = SIZE; output.height = SIZE;
const context = output.getContext('2d')!;

async function owner(parts: ProductPart[], colors: ColorMap, id: string) {
  const group = new THREE.Group(); group.userData.itemId = id;
  for (const part of parts) {
    const child = (await loadPart(part.id)).clone(true);
    child.userData.partId = part.id; child.position.set(...(part.offset ?? [0, 0, 0]));
    child.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.userData.modelMesh = true;
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(material => createModelMaterial(material, part, part.id === 'PCR' ? `PCR_${object.userData.colorKey}` : object.userData.sourcePart, object.userData.colorKey, colors));
      object.material = Array.isArray(object.material) ? materials : materials[0];
      object.castShadow = true; object.receiveShadow = true;
    });
    group.add(child);
  }
  return group;
}
async function makeModel(definition: PhotoDefinition) {
  const root = new THREE.Group();
  if (definition.kind === 'platform') root.add(await owner(getBaseParts(definition.legHeight!, 'lid'), getBaseStyleColors(0), definition.id));
  else if (definition.kind === 'product') {
    const product = getProduct(definition.id);
    root.add(await owner(product.parts, getProductStyleColors(product.id, 0), product.id));
  } else {
    const preset = applyInspirationLayout(createNewUserState(), 0, '1A');
    if (!preset.ok) throw new Error(preset.reason);
    const state = preset.state;
    if (!state.items.some(item => item.productId === 'pipe-down')) throw new Error('圣诞小屋缺少向下管道');
    root.add(await owner(getBaseParts(state.legHeight, state.baseInsert, getPlatforms(state)[0].removedCovers), state.baseColors, 'base'));
    for (const item of state.items) {
      const product = getProduct(item.productId), group = await owner(product.parts, item.colors, item.id);
      const source = new THREE.Group(); source.position.set(-product.origin[0], -product.origin[1], -product.origin[2]);
      for (const child of [...group.children]) source.add(child);
      // The exploded-layout contract expects the physical parts directly under the owner.
      for (const child of [...source.children]) {
        child.position.add(source.position); group.add(child);
      }
      group.rotation.z = THREE.MathUtils.degToRad(item.rotation); group.position.set(item.x, item.y, item.z);
      root.add(group);
    }
  }
  root.updateWorldMatrix(true, true);
  const box = getRenderedModelBounds(root), center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -center.y, -box.min.z);
  root.updateWorldMatrix(true, true);
  return root;
}
function frame(bounds: THREE.Box3, direction: THREE.Vector3) {
  const center = bounds.getCenter(new THREE.Vector3());
  camera.position.copy(center).addScaledVector(direction, Math.max(1500, bounds.getSize(new THREE.Vector3()).length() * 4));
  camera.lookAt(center); camera.updateMatrixWorld();
  const inverse = camera.matrixWorldInverse;
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inverse);
    left = Math.min(left, p.x); right = Math.max(right, p.x); bottom = Math.min(bottom, p.y); top = Math.max(top, p.y);
  }
  const half = Math.max(right - left, top - bottom) / 2 / .79;
  const cx = (left + right) / 2, cy = (bottom + top) / 2;
  camera.left = cx - half; camera.right = cx + half; camera.bottom = cy - half; camera.top = cy + half;
  camera.updateProjectionMatrix();
}
function projected(point: THREE.Vector3) {
  const p = point.clone().project(camera); return { x: (p.x + 1) * SIZE / 2, y: (1 - p.y) * SIZE / 2 };
}
function roundedRectangle(x: number, y: number, width: number, height: number, r: number) {
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r); context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}
function drawDimensions(bounds: THREE.Box3) {
  const values = dimensionsInCentimeters(bounds), axes = ['长', '宽', '高'];
  const segments = dimensionSegments(bounds, camera.position);
  const labels: { x: number; y: number; width: number; height: number }[] = [];
  context.lineWidth = 3; context.strokeStyle = '#849b98'; context.lineCap = 'round';
  for (const [a, b] of segments) {
    const p = projected(a), q = projected(b), dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
    const tick = { x: -dy / length * 13, y: dx / length * 13 };
    context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y);
    for (const v of [p, q]) { context.moveTo(v.x - tick.x, v.y - tick.y); context.lineTo(v.x + tick.x, v.y + tick.y); }
    context.stroke();
  }
  context.font = '500 54px "PingFang SC","Noto Sans CJK SC",sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  const labelTexts: string[] = [];
  segments.forEach(([a, b], i) => {
    const midpoint = projected(a.clone().lerp(b, .5)), text = `${axes[i]} ${values[i]} cm`;
    const width = context.measureText(text).width + 44, height = 86;
    let x = THREE.MathUtils.clamp(midpoint.x, width / 2 + 45, SIZE - width / 2 - 45);
    let y = THREE.MathUtils.clamp(midpoint.y, height / 2 + 45, SIZE - height / 2 - 45);
    for (let n = 0; n < 4; n++) {
      const overlap = labels.find(other => Math.abs(x - other.x) < (width + other.width) / 2 + 12 && Math.abs(y - other.y) < (height + other.height) / 2 + 12);
      if (!overlap) break;
      y = Math.max(height / 2 + 45, overlap.y - (height + overlap.height) / 2 - 15);
    }
    labels.push({ x, y, width, height }); labelTexts.push(text);
    roundedRectangle(x - width / 2, y - height / 2, width, height, 18);
    context.fillStyle = 'rgba(255,255,255,.97)'; context.fill();
    context.lineWidth = 2; context.strokeStyle = '#dde5df'; context.stroke();
    context.fillStyle = '#496463'; context.fillText(text, x, y + 2);
  });
  return labelTexts;
}
function dispose(root: THREE.Group) {
  root.traverse(node => {
    if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
}
const direction = new THREE.Vector3(...MODEL_CAMERA_DIRECTION).normalize();
const metadata: Record<string, unknown> = {};
let current: { definition: PhotoDefinition; root: THREE.Group; bounds: THREE.Box3; layout: ReturnType<typeof createExplodedLayout> } | null = null;
async function render(id: string, mode: Mode) {
  const definition = definitions.find(entry => entry.id === id); if (!definition) throw new Error('Unknown product');
  if (!current || current.definition.id !== id) {
    if (current) { current.layout.restore(); scene.remove(current.root); dispose(current.root); }
    const root = await makeModel(definition); scene.add(root);
    const bounds = getRenderedModelBounds(root);
    current = { definition, root, bounds, layout: createExplodedLayout(root, 'assembly', id === 'pokemon-center' ? 44 : 22) };
  }
  const { root, bounds, layout } = current;
  layout.apply(mode.startsWith('exploded') ? 1 : 0);
  const modelBounds = getRenderedModelBounds(root), framing = modelBounds.clone();
  // Rulers share the live model's camera-facing box edges and cm rounding.
  if (mode === 'dimensions') for (const segment of dimensionSegments(bounds, bounds.getCenter(new THREE.Vector3()).addScaledVector(direction, 10000))) for (const point of segment) framing.expandByPoint(point);
  const viewDirection = mode === 'exploded-reverse' ? new THREE.Vector3(direction.x, direction.y, -direction.z) : direction;
  frame(framing, viewDirection);
  const center = modelBounds.getCenter(new THREE.Vector3()), span = Math.max(100, modelBounds.getSize(new THREE.Vector3()).length());
  lighting.centerAt(center.x, center.y);
  lighting.underside.visible = mode === 'exploded-reverse';
  shadowPlane.visible = mode !== 'exploded-reverse';
  for (const light of [lighting.sun, lighting.fill, lighting.underside]) { light.position.z += center.z; light.target.position.z += center.z; }
  const shadow = lighting.sun.shadow;
  Object.assign(shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: 4000 });
  shadow.camera.updateProjectionMatrix(); shadow.normalBias = .5; shadow.bias = -.0003;
  const footprint = modelBounds.getSize(new THREE.Vector3());
  shadowPlane.position.set(center.x, center.y, -.5); shadowPlane.scale.set(Math.max(30, footprint.x * 1.55), Math.max(30, footprint.y * 1.55), 1);
  renderer.render(scene, camera);
  context.clearRect(0, 0, SIZE, SIZE); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
  const labelTexts = mode === 'dimensions' ? drawDimensions(bounds) : [];
  const result = {
    id, name: definition.name, mode, width: SIZE, height: SIZE,
    assembledBoundsMm: [...bounds.min.toArray(), ...bounds.max.toArray()], dimensionsCm: dimensionsInCentimeters(bounds),
    renderedBoundsMm: [...modelBounds.min.toArray(), ...modelBounds.max.toArray()],
    pieces: layout.pieces.length, hasExplodedDisplacement: layout.pieces.some(piece => piece.offset.length() > .01),
    sourcePartIds: root.children.flatMap(owner => owner.children.map(part => String(part.userData.partId))),
    cameraDirection: viewDirection.toArray(), explosionGapMm: id === 'pokemon-center' ? 44 : 22, labelTexts, renderVersion: MODEL_RENDER_VERSION, palette: '圣诞礼物', explosionGrouping: 'minitool-main-assembly',
  };
  metadata[id] = result;
  document.querySelector('#status')!.textContent = `${definition.name} · ${mode} · ${SIZE}×${SIZE}`;
  return { ...result, png: output.toDataURL('image/png') };
}
Object.assign(window, { productPhotoStudio: { definitions, render, metadata, size: SIZE } });
document.querySelector('#status')!.textContent = `已就绪：${definitions.length} 组，每组 4 张，${SIZE}×${SIZE} PNG`;
