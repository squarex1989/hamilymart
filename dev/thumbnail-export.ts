import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_ASSET_VERSION, VISIBLE_PRODUCTS } from '../src/data/catalog';
import modelIndex from '../src/data/model-index.json';
import { COLOR_STYLES } from '../src/lib/color-styles';
import { getThumbnailDefinition } from '../src/lib/catalog-thumbnail-contract';
import { configureModelRenderer, createModelLighting, createModelMaterial, MODEL_CAMERA_DIRECTION } from '../src/lib/model-presentation';

const button = document.querySelector<HTMLButtonElement>('#export')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const gallery = document.querySelector<HTMLDivElement>('#previews')!;
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
function loadPart(id: string) {
  if (!cache.has(id)) cache.set(id, loader.loadAsync(`${modelIndex[id as keyof typeof modelIndex].url}?v=${MODEL_ASSET_VERSION}`).then(gltf => gltf.scene).catch(error => {
    cache.delete(id);
    throw error;
  }));
  return cache.get(id)!;
}

function frame(camera: THREE.PerspectiveCamera, bounds: THREE.Box3) {
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(...MODEL_CAMERA_DIRECTION).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let distance = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const delta = new THREE.Vector3(x, y, z).sub(center), depth = delta.dot(direction);
    distance = Math.max(distance, depth + Math.abs(delta.dot(right)) / (tangent * camera.aspect * .83), depth + Math.abs(delta.dot(up)) / (tangent * .83));
  }
  camera.position.copy(center).addScaledVector(direction, Math.max(100, distance));
  camera.lookAt(center);
  camera.updateMatrixWorld();
}

button.addEventListener('click', async () => {
  button.disabled = true;
  gallery.replaceChildren();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  configureModelRenderer(renderer);
  renderer.setPixelRatio(1);
  renderer.setSize(480, 400);
  document.querySelector('#renderer')!.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  const lighting = createModelLighting(scene);
  lighting.centerAt(150, 150);
  const camera = new THREE.PerspectiveCamera(34, 480 / 400, 1, 4500);
  camera.up.set(0, 0, 1);
  let count = 0;
  try {
    for (const [styleIndex, style] of COLOR_STYLES.entries()) for (const product of VISIBLE_PRODUCTS) {
      status.textContent = `正在生成 ${++count}/60：${style.name} · ${product.name}`;
      const definition = getThumbnailDefinition(product.id, styleIndex);
      const group = new THREE.Group();
      try {
        for (const part of definition.parts) {
          const child = (await loadPart(part.id)).clone(true);
          child.position.set(...(part.offset ?? [0, 0, 0]));
          child.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const source = Array.isArray(object.material) ? object.material : [object.material];
            const materials = source.map(material => createModelMaterial(material, part, object.userData.sourcePart, object.userData.colorKey, definition.colors));
            object.material = Array.isArray(object.material) ? materials : materials[0];
            object.castShadow = true;
            object.receiveShadow = true;
          });
          group.add(child);
        }
        const bounds = new THREE.Box3().setFromObject(group), center = bounds.getCenter(new THREE.Vector3());
        group.position.set(150 - center.x, 150 - center.y, -bounds.min.z);
        scene.add(group);
        frame(camera, new THREE.Box3().setFromObject(group));
        renderer.render(scene, camera);
        const png = renderer.domElement.toDataURL('image/png');
        const response = await fetch('/__catalog-export/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ styleId: style.id, productId: product.id, png }) });
        if (!response.ok) throw new Error(await response.text());
        const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption');
        img.src = png;
        img.alt = `${style.name} ${product.name}`;
        caption.textContent = img.alt;
        figure.append(img, caption);
        gallery.append(figure);
      } finally {
        scene.remove(group);
        group.traverse(object => {
          if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        });
      }
      // Let status updates and browser input paint between exports.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    status.textContent = '完成：60 张组件图及原色回退图已保存';
  } catch (error) {
    status.textContent = `失败：${error instanceof Error ? error.message : String(error)}`;
    console.error(error);
  } finally {
    lighting.sun.shadow.map?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    button.disabled = false;
  }
});
