import * as THREE from 'three';

// Originals retain identity, hierarchy and geometry for picking / exploded views.
// Only their draw submission moves to a shared instance batch on the normal layer.
export const MODEL_PICK_LAYER = 1;

export function createModelBatches(scene: THREE.Scene, objects: THREE.Group) {
  const root = new THREE.Group();
  root.name = 'Repeated model draws';
  scene.add(root);
  const batches: { draw: THREE.InstancedMesh; sources: THREE.Mesh[] }[] = [];
  const layers = new Map<THREE.Mesh, number>();
  const inverse = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  function clear() {
    layers.forEach((mask, mesh) => { mesh.layers.mask = mask; });
    layers.clear();
    for (const { draw } of batches) { root.remove(draw); draw.dispose(); }
    batches.length = 0;
  }
  function refresh() {
    if (!batches.length) return;
    objects.updateWorldMatrix(true, true);
    root.updateWorldMatrix(true, false);
    inverse.copy(root.matrixWorld).invert();
    for (const { draw, sources } of batches) {
      sources.forEach((mesh, index) => draw.setMatrixAt(index, matrix.multiplyMatrices(inverse, mesh.matrixWorld)));
      draw.instanceMatrix.needsUpdate = true;
      draw.computeBoundingSphere();
    }
  }
  function rebuild() {
    clear();
    const compatible = new Map<string, THREE.Mesh[]>();
    objects.traverseVisible(node => {
      if (!(node instanceof THREE.Mesh) || node instanceof THREE.InstancedMesh || !node.userData.modelMesh
        || Array.isArray(node.material) || node.material.transparent
        || node.material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
        || node.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
      const material = node.material.toJSON();
      delete material.uuid; delete material.metadata; delete material.name; delete material.userData;
      const key = `${node.geometry.uuid}|${node.castShadow}|${node.receiveShadow}|${JSON.stringify(material)}`;
      const members = compatible.get(key) || [];
      members.push(node); compatible.set(key, members);
    });
    compatible.forEach(sources => {
      if (sources.length < 2) return;
      const first = sources[0];
      const draw = new THREE.InstancedMesh(first.geometry, first.material, sources.length);
      draw.castShadow = first.castShadow; draw.receiveShadow = first.receiveShadow;
      draw.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      sources.forEach(mesh => { layers.set(mesh, mesh.layers.mask); mesh.layers.set(MODEL_PICK_LAYER); });
      root.add(draw); batches.push({ draw, sources });
    });
    refresh();
  }
  return { rebuild, refresh, dispose() { clear(); scene.remove(root); } };
}
