import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createModelBatches, MODEL_PICK_LAYER } from '../src/lib/model-batches';
import { createModelBatches as miniBatches } from '../minitool/src/lib/model-batches';

for (const [label, make] of [['web', createModelBatches], ['mini', miniBatches]] as const) {
  test(`${label}: repeated models share draws while picking and exploded transforms keep their owners`, () => {
    const scene = new THREE.Scene(), objects = new THREE.Group(); scene.add(objects);
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const material = new THREE.MeshPhysicalMaterial({ color: '#336644' });
    const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, material.clone());
    first.userData.modelMesh = second.userData.modelMesh = true;
    first.userData.itemId = 'first'; second.userData.itemId = 'second';
    second.position.x = 30;
    objects.add(first, second);
    const batches = make(scene, objects); batches.rebuild();
    const instances: THREE.InstancedMesh[] = [];
    scene.traverse(node => { if (node instanceof THREE.InstancedMesh) instances.push(node); });
    assert.equal(instances.length, 1); assert.equal(instances[0].count, 2);
    assert(!first.layers.test(new THREE.Layers()), 'originals are not drawn twice');
    const ray = new THREE.Raycaster(new THREE.Vector3(30, 0, 100), new THREE.Vector3(0, 0, -1));
    ray.layers.enable(MODEL_PICK_LAYER);
    assert.equal(ray.intersectObjects(objects.children, true)[0].object.userData.itemId, 'second');
    second.position.z = 70; objects.rotation.z = .5; batches.refresh();
    const instance = new THREE.Matrix4(); instances[0].getMatrixAt(1, instance);
    assert(instance.elements.every((value, index) => Math.abs(value - second.matrixWorld.elements[index]) < 1e-5));
    let geometryDisposals = 0, materialDisposals = 0;
    geometry.addEventListener('dispose', () => geometryDisposals++);
    material.addEventListener('dispose', () => materialDisposals++);
    batches.dispose();
    assert(first.layers.test(new THREE.Layers())); assert(second.layers.test(new THREE.Layers()));
    assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
    assert.equal(scene.children.length, 1);
    geometry.dispose(); material.dispose(); second.material.dispose();
  });
  test(`${label}: different colors and custom/transparent finishes are never incorrectly combined`, () => {
    const scene = new THREE.Scene(), objects = new THREE.Group(); scene.add(objects);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = [new THREE.MeshPhysicalMaterial({ color: 'red' }), new THREE.MeshPhysicalMaterial({ color: 'blue' }),
      new THREE.MeshPhysicalMaterial({ color: 'red', transparent: true }), new THREE.MeshPhysicalMaterial({ color: 'red' })];
    materials[3].onBeforeCompile = () => {};
    materials.forEach(material => { const mesh = new THREE.Mesh(geometry, material); mesh.userData.modelMesh = true; objects.add(mesh); });
    const batches = make(scene, objects); batches.rebuild();
    let count = 0; scene.traverse(node => { if (node instanceof THREE.InstancedMesh) count++; });
    assert.equal(count, 0);
    batches.dispose(); geometry.dispose(); materials.forEach(material => material.dispose());
  });
}
