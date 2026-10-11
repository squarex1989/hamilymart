import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import modelIndex from "../src/data/model-index.json";
import { PRODUCTS, getProduct, getDefaultColors, type Rotation } from "../src/data/catalog";
import { autoPlace, createInitialState, getMagnetPoints, getOrderLines, getPlacements, getTotalPrice, tryPlace, validateAssembly } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";

test("V16 tilted seesaw keeps its centered source magnet and full swing clearance", () => {
  const product = getProduct("seesaw");
  assert.equal(PRODUCTS[13]?.id, "seesaw");
  assert.deepEqual(PRODUCTS.slice(0, 13).map(p => p.id), [
    "villa", "l-house", "cube-house", "roof-cottage", "pipe-st1", "pipe-st2", "pipe-st3",
    "pipe-lt1", "pipe-lt2", "pipe-lt3", "planter", "food-bowl", "pool",
  ]);
  assert.deepEqual(product.origin, [90, 90, 110]);
  assert.deepEqual(product.bottomMagnets, [[90, 90, 110]]);
  assert.deepEqual(getDefaultColors("seesaw"), { SS01: "butter" });
  assert.deepEqual(product.collisionBoxes, [[-.7, 50, 110, 180.7, 130, 159.8]]);
  const b = modelIndex.SS01.bounds;
  assert.ok(Math.abs(b[3] - b[0] - 177.612692) < .001);
  assert.ok(Math.abs(b[4] - b[1] - 80) < .001);
  assert.ok(Math.abs(b[5] - b[2] - 46.947923) < .001);
  assert.equal(b[2], 110, "the stationary base still rests on the platform");
  assert.equal(modelIndex.SS01.components[0].color, "#C99B46");
});

test("the real V16 GLB slopes by 10 degrees while its magnet seat and base remain level", async () => {
  const bytes = readFileSync(new URL('../public/models/SS01.glb', import.meta.url));
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  model.updateMatrixWorld(true);
  const hits = (x: number, y: number, below = false) => new THREE.Raycaster(new THREE.Vector3(x, y, below ? 100 : 180), new THREE.Vector3(0, 0, below ? 1 : -1)).intersectObject(model, true).map(hit => hit.point.z);
  const high = hits(20, 90)[0], low = hits(160, 90)[0];
  assert.ok(high - low > 24, "the two ends must visibly differ in height");
  assert.ok(Math.abs(Math.atan((high - low) / 140) * 180 / Math.PI - 10) < .02);
  for (const x of [80, 100]) assert.ok(Math.abs(hits(x, 90, true)[0] - 110) < .01);
  assert.ok(Math.abs(hits(90, 90, true)[0] - 114.2) < .02, "centered magnet cavity retains its original depth");
  const box = new THREE.Box3().setFromObject(model);
  const [xmin, ymin, zmin, xmax, ymax, zmax] = getProduct('seesaw').collisionBoxes[0];
  assert.ok(box.min.x >= xmin && box.min.y >= ymin && box.min.z >= zmin && box.max.x <= xmax && box.max.y <= ymax && box.max.z <= zmax);
});

test("seesaw can attach at every real empty platform receiver in four directions", () => {
  const state = createInitialState();
  const magnets = getMagnetPoints(state);
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const positions = getPlacements(state, "seesaw", rotation);
    assert.equal(positions.length, magnets.length);
    for (const { point } of magnets) {
      assert.ok(positions.some(p => p.x === point[0] && p.y === point[1] && p.z === point[2] && p.parentId === "base"));
    }
  }
});

test("seesaw auto-placement, pricing, colors and HM3 code round-trip stay intact", () => {
  const initial = createInitialState();
  const result = autoPlace(initial, "seesaw");
  assert.equal(result.ok, true);
  const item = result.state.items[0];
  assert.equal(item.productId, "seesaw");
  assert.deepEqual([item.x, item.y, item.z], [90, 90, 110]);
  assert.equal(getTotalPrice(result.state) - getTotalPrice(initial), 1500);
  const line = getOrderLines(result.state).find(l => l.sku.startsWith("HM-TY-001"));
  assert.ok(line);
  assert.deepEqual(line.parts, ["SS01"]);
  const recolored = { ...result.state, items: [{ ...item, colors: { SS01: "sky" as const } }] };
  assert.deepEqual(decodeConfig(encodeConfig(recolored)).items[0].colors, { SS01: "sky" });
});

test("seesaw reserves space against other objects and cannot occupy a used magnet", () => {
  const result = tryPlace(createInitialState(), "seesaw", { x: 90, y: 90, z: 110 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!getPlacements(result.state, "seesaw").some(p => p.x === 90 && p.y === 90));
  assert.ok(!getPlacements(result.state, "food-bowl").some(p => p.x === 110 && p.y === 90));
  assert.throws(() => validateAssembly({ ...result.state, items: [...result.state.items, { ...result.item, id: "another-seesaw" }] }), /磁吸|重叠|碰撞|放置/);
});
