import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PRODUCTS, VISIBLE_PRODUCTS, getProduct, PLATFORM_BODY_PRICE, LEG_SET_PRICES } from "../src/data/catalog";
import { autoPlace, createInitialState, getPlacements, getOrderLines, getTotalPrice, setLegHeight } from "../src/lib/assembly";
import { encodeConfig, decodeConfig } from "../src/lib/config-code";

test("pipe catalog shows four distinct forms while old product indices remain intact", () => {
  assert.deepEqual(VISIBLE_PRODUCTS.filter(p => p.category === "pipe").map(p => [p.id, p.name]), [
    ["pipe-st1", "直管道"], ["pipe-lt2n", "弯管道"], ["pipe-st2", "侧开口直管道"], ["pipe-lt2", "顶开口弯管道"],
  ]);
  assert.deepEqual(PRODUCTS.slice(0, 14).map(p => p.id), ["villa", "l-house", "cube-house", "roof-cottage", "pipe-st1", "pipe-st2", "pipe-st3", "pipe-lt1", "pipe-lt2", "pipe-lt3", "planter", "food-bowl", "pool", "seesaw"]);
  assert.equal(PRODUCTS[14].id, "pipe-lt2n");
  for (const id of ["pipe-st3", "pipe-lt1", "pipe-lt3"]) {
    const placed = autoPlace(createInitialState(), id);
    assert.ok(placed.ok);
    assert.equal(decodeConfig(encodeConfig(placed.state)).items[0].productId, id);
    assert.equal(getOrderLines(placed.state).find(line => line.sku === getProduct(id).sku)?.unitPrice, 800);
  }
});

test("closed elbow shares the actual LT2 support, magnet coordinates, and installation choices", () => {
  const elbow = getProduct("pipe-lt2n"), open = getProduct("pipe-lt2");
  assert.deepEqual(elbow.parts.map(p => p.id), ["LT2NT", "LT2B"]);
  assert.deepEqual(elbow.origin, [150, 150, 0]);
  assert.deepEqual(elbow.bottomMagnets, [[110, 190, 0], [190, 110, 0]]);
  assert.deepEqual(elbow.collisionBoxes, open.collisionBoxes);
  assert.deepEqual(elbow.pipeFaces, open.pipeFaces);
  for (const rotation of [0, 90, 180, 270] as const) assert.deepEqual(getPlacements(createInitialState(), elbow.id, rotation), getPlacements(createInitialState(), open.id, rotation));
  const placed = autoPlace(createInitialState(), elbow.id);
  assert.ok(placed.ok);
  assert.equal(decodeConfig(encodeConfig(placed.state)).items[0].productId, elbow.id);
  assert.deepEqual(getOrderLines(placed.state).find(line => line.sku === "HM-TB-LT2N")?.parts, ["LT2NT", "LT2B"]);
});

test("updated names and accessory prices match the current purchase catalog", () => {
  const prices: Record<string, number> = { villa: 8000, "roof-cottage": 4000, "l-house": 3500, "cube-house": 1500, "pipe-st1": 800, "pipe-st2": 800, "pipe-lt2": 800, "pipe-lt2n": 800, planter: 500, "food-bowl": 500, pool: 2500, seesaw: 1500 };
  for (const [id, value] of Object.entries(prices)) assert.equal(getProduct(id).price, value);
  assert.deepEqual(["roof-cottage", "planter", "food-bowl", "pool", "seesaw"].map(id => getProduct(id).name), ["帽子小屋", "袜子花圃", "方块食盆", "圆形泳池", "跷跷板"]);
  for (const product of PRODUCTS.filter(product => product.category === "pipe")) {
    const placed = autoPlace(createInitialState(), product.id);
    assert.ok(placed.ok);
    const restored = decodeConfig(encodeConfig(placed.state));
    assert.equal(product.price, 800, `${product.id} must include its dedicated support at the same eight-yuan price`);
    assert.equal(getOrderLines(restored).find(line => line.sku === product.sku)!.unitPrice, 800);
    assert.equal(getTotalPrice(restored) - getTotalPrice(createInitialState()), 800);
  }
});

test("platform pricing charges one four-leg set and keeps the bare platform at twenty yuan", () => {
  assert.equal(PLATFORM_BODY_PRICE, 2000);
  assert.deepEqual(LEG_SET_PRICES, { 0: 0, 100: 1000, 200: 1200, 300: 1400 });
  for (const height of [0, 100, 200, 300] as const) {
    const result = setLegHeight(createInitialState(), height);
    assert.ok(result.ok);
    const order = getOrderLines(result.state);
    assert.equal(getTotalPrice(result.state), PLATFORM_BODY_PRICE + LEG_SET_PRICES[height]);
    assert.equal(order[0].unitPrice, PLATFORM_BODY_PRICE + LEG_SET_PRICES[height]);
    assert.equal(order[0].parts.filter(id => /^[LXY]0[1-4]$/.test(id)).length, height ? 4 : 0);
  }
});

test("actual closed elbow GLB closes the top opening and keeps the real shared support pockets", async () => {
  const load = async (id: string) => {
    const bytes = readFileSync(new URL(`../public/models/${id}.glb`, import.meta.url));
    const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    scene.updateMatrixWorld(true);
    return scene;
  };
  const [closed, open, base] = await Promise.all([load("LT2NT"), load("LT2T"), load("LT2B")]);
  const center = 100 + 50 / Math.sqrt(2);
  const down = new THREE.Raycaster(new THREE.Vector3(center, center, 150), new THREE.Vector3(0, 0, -1));
  assert.ok(down.intersectObject(closed, true)[0].point.z > 89);
  assert.ok(down.intersectObject(open, true)[0].point.z < 20);
  for (const [x, y] of [[110, 190], [190, 110]]) {
    const up = new THREE.Raycaster(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1));
    assert.ok(Math.abs(up.intersectObject(base, true)[0].point.z - 4.2) < .02);
  }
});
