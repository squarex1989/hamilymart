import * as THREE from 'three';
import format from '../data/offline-model-format.json';
type ModelMesh = { v: number; name: string; extras: Record<string, unknown>; p: number[]; n: number[]; i: number[]; material: { doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[]; roughnessFactor?: number; metallicFactor?: number } } };
declare global { interface Window { HamilyModels?: Record<string, () => ModelMesh[]>; } }
const cache = new Map<string, Promise<THREE.Group>>();
let queue = Promise.resolve();
function readModel(id: string): Promise<ModelMesh[]> {
  return new Promise((resolve, reject) => {
    const present = window.HamilyModels?.[id];
    if (present) { resolve(present()); return; }
    const script = document.createElement('script');
    script.src = `./models/${id}.js?v=${format.cacheRevision}`;
    const timeout = setTimeout(() => { script.remove(); reject(new Error(`本地模型加载超时：${id}`)); }, 15000);
    script.onload = () => {
      clearTimeout(timeout); script.remove();
      const make = window.HamilyModels?.[id];
      try { if (make) resolve(make()); else reject(new Error(`模型内容不完整：${id}`)); }
      catch (error) { reject(error); }
    };
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
      // Reject stale resources before allocating GPU-owned objects. Normals and
      // shared hard-edge vertices have already been prepared during the build.
      if (!meshes.length || meshes.some(source => source.v !== format.version
        || !source.n || source.n.length !== source.p.length || source.p.length % 3))
        throw new Error(`模型格式已更新，请重新加载：${id}`);
      for (const source of meshes) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(source.p.length);
        for (let i = 0; i < positions.length; i++) positions[i] = source.p[i] / format.positionScale;
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(source.n), 3));
        geometry.setIndex(source.i);
        const settings = source.material.pbrMetallicRoughness || {};
        const rgb = settings.baseColorFactor || [1, 1, 1, 1];
        const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]), roughness: settings.roughnessFactor ?? .62, metalness: settings.metallicFactor ?? 0, side: source.material.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
        const mesh = new THREE.Mesh(geometry, material); mesh.name = source.name; mesh.userData = { ...source.extras }; group.add(mesh);
      }
      // Release numeric source arrays/factory after geometry upload; keep shared geometry.
      if (window.HamilyModels) delete window.HamilyModels[id];
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return group;
    });
    const cached = task.catch(error => {
      // A rejected promise is not a model: a user retry must be able to load it again.
      if (cache.get(id) === cached) cache.delete(id);
      // A failed script factory must also be re-requested, not reused on retry.
      if (window.HamilyModels) delete window.HamilyModels[id];
      throw error;
    });
    queue = cached.then(() => undefined, () => undefined);
    cache.set(id, cached);
  }
  return cache.get(id)!;
}
