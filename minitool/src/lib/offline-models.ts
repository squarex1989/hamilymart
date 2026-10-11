import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
type ModelMesh = { name: string; extras: Record<string, unknown>; p: number[]; i: number[]; material: { doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[]; roughnessFactor?: number; metallicFactor?: number } } };
declare global { interface Window { HamilyModels?: Record<string, () => ModelMesh[]>; } }
const cache = new Map<string, Promise<THREE.Group>>();
let queue = Promise.resolve();
function readModel(id: string): Promise<ModelMesh[]> {
  return new Promise((resolve, reject) => {
    const present = window.HamilyModels?.[id];
    if (present) { resolve(present()); return; }
    const script = document.createElement('script');
    script.src = `./models/${id}.js`;
    const timeout = setTimeout(() => { script.remove(); reject(new Error(`本地模型加载超时：${id}`)); }, 15000);
    script.onload = () => { clearTimeout(timeout); script.remove(); const make = window.HamilyModels?.[id]; if (make) resolve(make()); else reject(new Error(`模型内容不完整：${id}`)); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error(`缺少本地模型：${id}`)); };
    document.head.appendChild(script);
  });
}
/** Models are same-origin classic script resources; no network APIs or GLB loaders. */
export function loadPart(id: string): Promise<THREE.Group> {
  if (!/^[A-Z][A-Z0-9]+$/.test(id)) return Promise.reject(new Error('未知模型编号'));
  if (!cache.has(id)) {
    const task = queue.then(async () => {
      const meshes = await readModel(id);
      const group = new THREE.Group();
      for (const source of meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.p.map(v => v / 1000), 3));
        geometry.setIndex(source.i);
        const smooth = toCreasedNormals(geometry, Math.PI / 5); geometry.dispose();
        const settings = source.material.pbrMetallicRoughness || {};
        const rgb = settings.baseColorFactor || [1, 1, 1, 1];
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), roughness: settings.roughnessFactor ?? .62, metalness: settings.metallicFactor ?? 0, side: source.material.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
        const mesh = new THREE.Mesh(smooth, material); mesh.name = source.name; mesh.userData = { ...source.extras }; group.add(mesh);
      }
      // Release numeric source arrays/factory after geometry upload; keep shared geometry.
      if (window.HamilyModels) delete window.HamilyModels[id];
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return group;
    });
    queue = task.then(() => undefined, () => undefined);
    cache.set(id, task);
  }
  return cache.get(id)!;
}
