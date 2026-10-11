import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createExplodedLayout, fitExplodedCamera } from "../src/lib/exploded-view";
import { createBlankDoubleTap, createShakeDetector } from "../src/lib/scene-gestures";
import { getBaseParts, getProduct, type ProductPart } from "../src/data/catalog";

async function realOwner(id: string, parts: ProductPart[], origin: number[], position: number[], rotation = 0) {
  const owner = new THREE.Group();
  owner.userData.itemId = id;
  owner.position.fromArray(position);
  owner.rotation.z = rotation;
  for (const part of parts) {
    const buffer = await readFile(new URL(`../public/models/${part.id}.glb`, import.meta.url));
    const loaded = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
    const child = loaded.scene;
    child.userData.partId = part.id;
    child.position.set(-origin[0] + (part.offset?.[0] ?? 0), -origin[1] + (part.offset?.[1] ?? 0), -origin[2] + (part.offset?.[2] ?? 0));
    child.traverse(node => { if (node instanceof THREE.Mesh) node.userData.modelMesh = true; });
    owner.add(child);
  }
  return owner;
}
function dispose(root: THREE.Object3D) {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose());
  });
}
function allTransforms(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const result: Record<string, number[]> = {};
  root.traverse(node => { result[node.uuid] = [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray(), ...node.matrixWorld.elements]; });
  return result;
}

test("real GLBs separate every color control and linked physical part, without losing seesaw geometry", async () => {
  const root = new THREE.Group();
  root.add(await realOwner("base", getBaseParts(100), [0, 0, 0], [0, 0, 0]));
  for (const [id, position, rotation] of [
    ["villa", [150, 190, 110], Math.PI / 2],
    ["roof-cottage", [50, 250, 200], 0],
    ["seesaw", [250, 60, 110], 0],
  ] as const) {
    const product = getProduct(id);
    root.add(await realOwner(id, product.parts, product.origin, [...position], rotation));
  }
  try {
    const original = allTransforms(root);
    const layout = createExplodedLayout(root);
    const keys = layout.pieces.map(piece => piece.key);
    for (const expected of ["villa:A01:A01-ribbon", "villa:A01:A01-bow", "villa:G05:G05-base", "villa:G05:body", "roof-cottage:G03:G03-window", "roof-cottage:G03:G03-trim"])
      assert.ok(keys.includes(expected), `missing independent color region ${expected}`);
    for (const part of ["G15", "G16", "G17", "W01", "W02", "L01", "L02", "L03", "L04", "SS01"])
      assert.ok(layout.pieces.some(piece => piece.partId === part), `missing physical part ${part}`);
    let originalMeshCount = 0;
    root.traverse(node => { if (node.userData.modelMesh) originalMeshCount++; });
    assert.equal(layout.pieces.flatMap(piece => piece.meshes).length, originalMeshCount);
    const expanded = layout.pieces.map(piece => piece.originalBounds.clone().translate(piece.offset));
    for (let i = 0; i < expanded.length; i++) for (let j = i + 1; j < expanded.length; j++)
      assert.equal(expanded[i].intersectsBox(expanded[j]), false, `${keys[i]} overlaps ${keys[j]}`);
    layout.apply(.5); layout.apply(1);
    assert.notDeepEqual(allTransforms(root), original);
    layout.apply(.4); layout.restore();
    assert.deepEqual(allTransforms(root), original, "every local and world transform returns exactly to the assembly");
  } finally { dispose(root); }
});

test("exploded camera fits all corners in landscape and narrow portrait views", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-270, -100, 10), new THREE.Vector3(1520, 660, 830));
  for (const aspect of [.45, .65, 1.7]) {
    const camera = new THREE.PerspectiveCamera(34, aspect, 10, 12000);
    camera.up.set(0, 0, 1);
    camera.position.set(1000, -600, 550);
    const fitted = fitExplodedCamera(bounds, camera, new THREE.Vector3(450, 150, 150));
    camera.position.copy(fitted.position);
    camera.lookAt(fitted.target);
    camera.updateMatrixWorld(true);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(projected.x) <= .821 && Math.abs(projected.y) <= .781 && projected.z < 1, `corner clipped at aspect ${aspect}: ${projected.toArray()}`);
    }
  }
});

test("nested moving meshes are not translated twice and restore scaled, rotated parents", () => {
  const root = new THREE.Group(), owner = new THREE.Group(), part = new THREE.Group();
  owner.userData.itemId = "nested"; owner.rotation.z = .7; owner.scale.set(1.4, .8, 1.2);
  part.userData.partId = "A01";
  const body = new THREE.Mesh(new THREE.BoxGeometry(100, 70, 80), new THREE.MeshStandardMaterial());
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(10, 72, 20), new THREE.MeshStandardMaterial());
  body.userData = { modelMesh: true, sourcePart: "A01_PineGreen" };
  ribbon.userData = { modelMesh: true, sourcePart: "A01_Gold" };
  ribbon.position.set(5, 0, 7); body.add(ribbon); part.add(body); owner.add(part); root.add(owner);
  const original = allTransforms(root), start = ribbon.getWorldPosition(new THREE.Vector3());
  const layout = createExplodedLayout(root), piece = layout.pieces.find(entry => entry.meshes.includes(ribbon))!;
  layout.apply(1);
  const actual = ribbon.getWorldPosition(new THREE.Vector3()).sub(start);
  assert.ok(actual.distanceTo(piece.offset) < 1e-10);
  layout.restore();
  assert.deepEqual(allTransforms(root), original);
  dispose(root);
});

test("shake needs opposing impulses and debounces walking, rotation, isolated bumps and repeated shakes", () => {
  const detector = createShakeDetector();
  const sample = (x: number, y: number, z: number, at: number) => detector.sample({ acceleration: { x, y, z } }, at);
  for (let at = 0; at < 800; at += 20) assert.equal(sample(Math.sin(at) * 3, 1, 2, at), false);
  assert.equal(sample(21, 0, 0, 1000), false);
  assert.equal(sample(-21, 0, 0, 1800), false, "an isolated bump expires");
  assert.equal(sample(21, 0, 0, 1920), true);
  assert.equal(sample(-25, 0, 0, 2050), false);
  assert.equal(sample(25, 0, 0, 2190), false);
  assert.equal(sample(-21, 0, 0, 4000), false);
  assert.equal(sample(22, 0, 0, 4110), true);
  detector.reset();
  const gravityOnly = createShakeDetector();
  for (let step = 0; step < 120; step++) {
    const angle = step / 120 * Math.PI;
    assert.equal(gravityOnly.sample({ acceleration: null, accelerationIncludingGravity: { x: Math.sin(angle) * 9.81, y: 0, z: Math.cos(angle) * 9.81 } }, step * 20), false);
  }
  assert.equal(detector.sample({ acceleration: { x: null, y: NaN, z: 0 } }, 8000), false);
});

test("blank double taps require nearby consecutive clicks of the same pointer type and can be cancelled", () => {
  const taps = createBlankDoubleTap();
  assert.equal(taps.tap(12, 24, 100, "touch"), false);
  assert.equal(taps.tap(15, 22, 290, "touch"), true);
  assert.equal(taps.tap(15, 22, 450, "touch"), false, "third tap does not toggle again");
  taps.reset();
  assert.equal(taps.tap(12, 24, 900, "touch"), false);
  assert.equal(taps.tap(12, 24, 950, "mouse"), false);
  assert.equal(taps.tap(60, 24, 1000, "mouse"), false);
  assert.equal(taps.tap(60, 24, 1350, "mouse"), false);
  taps.reset(); // Model hit, drag, pinch, cancellation, or hidden document breaks the pair.
  assert.equal(taps.tap(60, 24, 1400, "mouse"), false);
  assert.equal(taps.tap(60, 24, 1400, "mouse"), true, "native fast double clicks remain supported");
});
