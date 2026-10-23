import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createExplodedLayout, fitExplodedCamera } from "../src/lib/exploded-view";
import { createBlankDoubleTap } from "../src/lib/scene-gestures";
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

test("exploded GLBs keep requested assembly groups intact without losing geometry", async () => {
  const root = new THREE.Group();
  root.add(await realOwner("base", getBaseParts(100), [0, 0, 0], [0, 0, 0]));
  for (const [id, position, rotation] of [
    ["villa", [150, 190, 110], Math.PI / 2],
    ["roof-cottage", [50, 250, 200], 0],
    ["seesaw", [250, 60, 110], 0],
    ["pipe-tt1", [350, 50, 110], 0],
    ["pipe-tt2", [450, 50, 110], Math.PI / 2],
  ] as const) {
    const product = getProduct(id);
    root.add(await realOwner(id, product.parts, product.origin, [...position], rotation));
  }
  try {
    const original = allTransforms(root);
    const layout = createExplodedLayout(root);
    const keys = layout.pieces.map(piece => piece.key);
    for (const expected of ["base:platform", "villa:A01", "villa:G05", "villa:upper-platform", "villa:grass", "roof-cottage:G03", "pipe-tt1:pipe", "pipe-tt2:pipe"])
      assert.ok(keys.includes(expected), `missing intact assembly ${expected}`);
    const groupedParts: Record<string, string[]> = {
      "base:platform": ["P01", "H01", "H02", "H03", "H04", "H05", "H06", "L01", "L02", "L03", "L04"],
      "villa:upper-platform": ["A02", "W01", "W02"],
      "villa:grass": ["G15", "G16", "G17"],
      "pipe-tt1:pipe": ["TT1T", "TTB"],
      "pipe-tt2:pipe": ["TT2T", "TTB"],
    };
    for (const [key, partIds] of Object.entries(groupedParts))
      assert.deepEqual(layout.pieces.find(piece => piece.key === key)?.partIds, partIds.sort());
    for (const partId of ["A01", "G03", "G05"])
      assert.equal(layout.pieces.filter(piece => piece.partIds.includes(partId)).length, 1, `${partId} decorations remain attached`);
    assert.ok(layout.pieces.some(piece => piece.partId === "SS01"), "all seesaw meshes are retained");
    let originalMeshCount = 0;
    root.traverse(node => { if (node.userData.modelMesh) originalMeshCount++; });
    assert.equal(layout.pieces.flatMap(piece => piece.meshes).length, originalMeshCount);
    const expanded = layout.pieces.map(piece => piece.originalBounds.clone().translate(piece.offset));
    for (let i = 0; i < expanded.length; i++) for (let j = i + 1; j < expanded.length; j++)
      assert.equal(["x", "y", "z"].every(axis => Math.min(expanded[i].max[axis as "x"|"y"|"z"], expanded[j].max[axis as "x"|"y"|"z"]) - Math.max(expanded[i].min[axis as "x"|"y"|"z"], expanded[j].min[axis as "x"|"y"|"z"]) > .01), false, `${keys[i]} overlaps ${keys[j]}`);
    layout.apply(.5); layout.apply(1);
    assert.notDeepEqual(allTransforms(root), original);
    layout.apply(.4); layout.restore();
    assert.deepEqual(allTransforms(root), original, "every local and world transform returns exactly to the assembly");
  } finally { dispose(root); }
});

test("rotated and stacked real houses keep roofs directly above their own bodies", async () => {
  for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const root = new THREE.Group();
    root.add(await realOwner("base", getBaseParts(100), [0, 0, 0], [0, 0, 0]));
    const lHouse = getProduct("l-house"), cube = getProduct("cube-house");
    root.add(await realOwner("lower", lHouse.parts, lHouse.origin, [150, 150, 110], rotation));
    // The cube stands on the occupied back-left square of the L roof. Rotate
    // its position with the L so all four real assembly orientations are covered.
    const upperPosition = new THREE.Vector3(-50, 50, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotation)
      .add(new THREE.Vector3(150, 150, 200));
    root.add(await realOwner("upper", cube.parts, cube.origin, upperPosition.toArray(), rotation));
    try {
      const original = allTransforms(root);
      const layout = createExplodedLayout(root);
      const chain = ["P01", "LHB", "LHR", "SHB", "SHR"].map(partId => {
        const piece = layout.pieces.find(entry => entry.partId === partId)!;
        assert.equal(piece.offset.x, 0, `${partId} keeps its original horizontal alignment`);
        assert.equal(piece.offset.y, 0, `${partId} keeps its original horizontal alignment`);
        return piece.originalBounds.clone().translate(piece.offset);
      });
      for (let i = 1; i < chain.length; i++)
        assert.ok(chain[i].min.z >= chain[i - 1].max.z + 21.99, `vertical assembly order inverted at ${i}, rotation ${rotation}`);
      layout.apply(1); layout.restore();
      assert.deepEqual(allTransforms(root), original);
    } finally { dispose(root); }
  }
});

test("all supported platform legs and covers stay in the same exploded assembly", async () => {
  for (const height of [0, 100, 200, 300] as const) {
    const root = new THREE.Group();
    const parts = getBaseParts(height, false, ["H02"]);
    root.add(await realOwner("base", parts, [0, 0, 0], [300, 0, 0]));
    try {
      const layout = createExplodedLayout(root);
      assert.equal(layout.pieces.length, 1);
      assert.deepEqual(layout.pieces[0].partIds, parts.map(part => part.id).sort());
      assert.ok(!layout.pieces[0].partIds.includes("H02"), "removed cover is not recreated");
      const original = allTransforms(root);
      layout.apply(1); layout.restore();
      assert.deepEqual(allTransforms(root), original);
    } finally { dispose(root); }
  }
});

test("three edge-sharing platforms stay level while each house stays above its own base", async () => {
  const root = new THREE.Group(), house = getProduct("cube-house");
  for (let index = 0; index < 3; index++) {
    root.add(await realOwner(`base${index}`, getBaseParts(100), [0, 0, 0], [index * 300, 0, 0]));
    root.add(await realOwner(`house${index}`, house.parts, house.origin, [index * 300 + 150, 150, 110], index * Math.PI / 2));
  }
  try {
    const layout = createExplodedLayout(root);
    for (let index = 0; index < 3; index++) {
      const base = layout.pieces.find(piece => piece.key === `base${index}:platform`)!;
      const body = layout.pieces.find(piece => piece.key === `house${index}:SHB:body`)!;
      const roof = layout.pieces.find(piece => piece.key === `house${index}:SHR:body`)!;
      assert.deepEqual(base.offset.toArray(), [0, 0, 0], "neighboring platforms do not lift one another");
      assert.ok(body.originalBounds.min.z + body.offset.z >= base.originalBounds.max.z + 21.99);
      assert.ok(roof.originalBounds.min.z + roof.offset.z >= body.originalBounds.max.z + body.offset.z + 21.99);
    }
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

test('isolated part mode separates platform covers/legs and restores every original transform', async () => {
  const root = new THREE.Group();
  root.add(await realOwner('base', getBaseParts(100), [0,0,0], [0,0,0]));
  try {
    const before = allTransforms(root);
    const layout = createExplodedLayout(root, 'parts');
    assert(layout.pieces.length >= 11);
    const deck = layout.pieces.find(piece => piece.partId === 'P01')!;
    assert(deck.offset.z > 0, 'deck lifts off the separate legs');
    for (const piece of layout.pieces.filter(piece => /^H0/.test(piece.partId))) assert(piece.offset.z > deck.offset.z, 'covers lift above the deck');
    layout.apply(1); assert.notDeepEqual(allTransforms(root), before);
    layout.apply(.3); layout.restore(); assert.deepEqual(allTransforms(root), before);
  } finally { dispose(root); }
});
