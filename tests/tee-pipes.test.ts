import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PRODUCTS, getProduct } from "../src/data/catalog";
import { createInitialState, getPlacements, tryPlace, getItemBounds, getTotalPrice, getOrderLines } from "../src/lib/assembly";
import { encodeConfig, decodeConfig } from "../src/lib/config-code";

async function load(id: string) {
  const bytes = readFileSync(new URL(`../public/models/${id}.glb`, import.meta.url));
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.side = THREE.DoubleSide;
    }
  });
  scene.updateMatrixWorld(true);
  return scene;
}

function cast(model: THREE.Object3D, origin: number[], direction: number[], far = 200) {
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, far).intersectObject(model, true);
}

test("T products append stable indices, occupy one square, and retain bundled eight-yuan pricing", () => {
  assert.deepEqual(PRODUCTS.slice(14, 17).map(product => product.id), ["pipe-lt2n", "pipe-tt1", "pipe-tt2"]);
  for (const id of ["pipe-tt1", "pipe-tt2"]) {
    const product = getProduct(id);
    assert.equal(product.price, 800);
    assert.deepEqual(product.bottomMagnets, [[10, 90, 0], [90, 90, 0]]);
    assert.deepEqual(product.parts.map(part => part.id), [id === "pipe-tt1" ? "TT1T" : "TT2T", "TTB"]);
    for (const rotation of [0, 90, 180, 270] as const) {
      const initial = createInitialState();
      const candidate = getPlacements(initial, id, rotation)[0];
      assert.ok(candidate, `${id} must install in every orientation`);
      const placed = tryPlace(initial, id, candidate, rotation);
      assert.ok(placed.ok);
      const bounds = getItemBounds(placed.item)[0];
      assert.equal(bounds[3]-bounds[0], 100);
      assert.equal(bounds[4]-bounds[1], 100);
      const restored = decodeConfig(encodeConfig(placed.state));
      assert.equal(restored.items[0].productId, id);
      assert.equal(restored.items[0].rotation, rotation);
      assert.equal(getTotalPrice(restored)-getTotalPrice(initial), 800);
      assert.deepEqual(getOrderLines(restored).find(line => line.sku === product.sku)?.parts, product.parts.map(part => part.id));
      assert.equal(tryPlace(restored, id, candidate, rotation).ok, false, "one grid space cannot be double occupied");
    }
  }
});

test("actual T meshes have three connected bores and only TT2 has the 60 mm top opening", async () => {
  const [closed, opened] = await Promise.all([load("TT1T"), load("TT2T")]);
  for (const model of [closed, opened]) {
    const bounds = new THREE.Box3().setFromObject(model);
    assert.ok(bounds.min.x >= 0 && bounds.min.y >= 0 && bounds.max.x <= 100 && bounds.max.y <= 100);
    assert.equal(cast(model, [-1, 50, 46.4], [1, 0, 0], 102).length, 0, "left and right mouths must pass through the junction");
    assert.equal(cast(model, [50, -1, 46.4], [0, 1, 0], 75).length, 0, "front mouth must reach the common lumen without a membrane");
    for (const [x, y] of [[.1, 50], [99.9, 50], [50, .1]]) {
      const outer = cast(model, [x, y, 110], [0, 0, -1])[0].point.z;
      const inner = cast(model, [x, y, 46.4], [0, 0, 1])[0].point.z;
      assert.ok(Math.abs(outer-89.6) < .02);
      assert.ok(Math.abs(inner-86.4) < .02);
      assert.ok(Math.abs(outer-inner-3.2) < .02, "every mouth retains the original 3.2 mm nominal wall");
    }
  }
  assert.ok(cast(closed, [50, 50, 120], [0, 0, -1])[0].point.z > 89);
  assert.ok(cast(opened, [50, 50, 120], [0, 0, -1])[0].point.z < 7);
  for (const x of [21, 79]) assert.ok(cast(opened, [x, 50, 120], [0, 0, -1])[0].point.z < 7);
  for (const x of [19, 81]) assert.ok(cast(opened, [x, 50, 120], [0, 0, -1])[0].point.z > 89);
});

test("T mouths align with original straight and elbow meshes in adjacent 100 mm cells", async () => {
  const [tee, straight, elbow] = await Promise.all([load("TT1T"), load("ST1T"), load("LT2NT")]);
  const straightPair = new THREE.Group();
  straight.position.x = -100;
  straightPair.add(tee, straight);
  straightPair.updateMatrixWorld(true);
  assert.equal(cast(straightPair, [-101, 50, 46.4], [1, 0, 0], 202).length, 0);
  // Rotate a standard ST1 into the cell directly in front of the T branch.
  straight.rotation.z = Math.PI/2;
  straight.position.set(100, -100, 0);
  straightPair.updateMatrixWorld(true);
  assert.equal(cast(straightPair, [50, -101, 46.4], [0, 1, 0], 175).length, 0);
  // LT2's [100,150,46.4] mouth becomes the opposite side of T's left mouth.
  elbow.rotation.z = Math.PI;
  elbow.position.set(100, 200, 0);
  const elbowPair = new THREE.Group();
  elbowPair.add(tee, elbow);
  elbowPair.updateMatrixWorld(true);
  assert.equal(cast(elbowPair, [-5, 50, 46.4], [1, 0, 0], 10).length, 0);
  for (const model of [tee, elbow]) {
    const side = model === tee ? .1 : -.1;
    const outer = cast(model, [side, 50, 120], [0, 0, -1])[0].point.z;
    const inner = cast(model, [side, 50, 46.4], [0, 0, 1])[0].point.z;
    assert.ok(Math.abs(outer-89.6) < .03 && Math.abs(inner-86.4) < .03, "matching outer and inner lip heights across the seam");
  }
});

test("T support keeps actual blind bottom pockets and no side holes", async () => {
  const base = await load("TTB");
  for (const x of [10, 90]) assert.ok(Math.abs(cast(base, [x, 90, -1], [0, 0, 1])[0].point.z-4.2) < .02);
  for (const [x, direction] of [[-1, 1], [101, -1]]) assert.ok(cast(base, [x, 88, 11], [direction, 0, 0])[0].distance < 1.02);
});
