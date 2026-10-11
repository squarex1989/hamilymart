import test from "node:test";
import assert from "node:assert/strict";
import modelIndex from "../src/data/model-index.json";
import { PRODUCTS, getProduct, getDefaultColors, type Rotation } from "../src/data/catalog";
import { autoPlace, createInitialState, getMagnetPoints, getOrderLines, getPlacements, getTotalPrice, tryPlace, validateAssembly } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";

test("V12 seesaw keeps its centered source magnet and full swing clearance", () => {
  const product = getProduct("seesaw");
  assert.equal(PRODUCTS[13]?.id, "seesaw");
  assert.deepEqual(PRODUCTS.slice(0, 13).map(p => p.id), [
    "villa", "l-house", "cube-house", "roof-cottage", "pipe-st1", "pipe-st2", "pipe-st3",
    "pipe-lt1", "pipe-lt2", "pipe-lt3", "planter", "food-bowl", "pool",
  ]);
  assert.deepEqual(product.origin, [90, 90, 110]);
  assert.deepEqual(product.bottomMagnets, [[90, 90, 110]]);
  assert.deepEqual(getDefaultColors("seesaw"), { SS01: "butter" });
  assert.deepEqual(product.collisionBoxes, [[0, 50, 110, 180, 130, 159.8]]);
  const b = modelIndex.SS01.bounds;
  assert.ok(Math.abs(b[3] - b[0] - 180) < .001);
  assert.ok(Math.abs(b[4] - b[1] - 80) < .001);
  assert.ok(Math.abs(b[5] - b[2] - 31.6) < .001);
  assert.equal(modelIndex.SS01.components[0].color, "#C99B46");
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
