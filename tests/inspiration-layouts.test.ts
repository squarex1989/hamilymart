import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INSPIRATION_LAYOUTS, type InspirationLayout } from "../src/data/inspiration-layouts";
import { INSPIRATION_LAYOUTS as MINI_LAYOUTS } from "../minitool/src/data/inspiration-layouts";
import * as web from "../src/lib/assembly";
import * as mini from "../minitool/src/lib/assembly";
import { getDefaultColors, getProduct } from "../src/data/catalog";

const aliases: Record<string, string> = {
  V: "villa", H: "roof-cottage", L: "l-house", C: "cube-house",
  ST: "pipe-st1", SO: "pipe-st2", E: "pipe-lt2n", EO: "pipe-lt2",
  T: "pipe-tt1", TO: "pipe-tt2", F: "planter", B: "food-bowl", S: "seesaw", P: "pool",
};
// Approved counts are independent of the authored coordinate fixtures.
const recipes: Record<string, string[]> = {
  "1A": ["V H P F"], "1B": ["L C S B"], "1C": ["H S F B"],
  "1D": ["C ST SO E B"], "1E": ["P C S F"],
  "2A": ["L C B", "V F S"], "2B": ["V H P F", "C S B"],
  "2C": ["H F B", "T ST SO EO S"], "2D": ["L F B", "H C S"],
  "2E": ["P C B F", "TO E SO S"],
  "3A": ["V H P F", "C S B", "V H F"],
  "3B": ["V H F", "P F F B", "L C S"],
  "3C": ["L C B", "TO ST SO E", "H P S F"],
  "3D": ["H F B", "P S F", "H C F"],
  "3E": ["C ST SO E B", "T TO ST EO", "P H S F"],
};

function assemble(layout: InspirationLayout, engine: typeof web | typeof mini = web) {
  let state = engine.createInitialState();
  state.bedding = { mode: "none", depth: 0 };
  for (let count = 1; count < layout.platformCount; count++) {
    const added = engine.addPlatform(state);
    assert(added.ok);
    state = added.state;
  }
  for (const platform of layout.poolPlatforms) {
    if (platform === 0) state.baseInsert = "pool";
    else if (platform === 1) state.extension!.baseInsert = "pool";
    else state.thirdPlatform!.baseInsert = "pool";
  }
  for (const item of layout.items) {
    const [x, y, z] = item.position;
    const parentId = item.parentKey ?? ["base", "base2", "base3"][item.platform];
    const match = engine.getPlacements(state, item.productId, item.rotation).find(placement =>
      Math.abs(placement.x - x) < .01 && Math.abs(placement.y - y) < .01 &&
      Math.abs(placement.z - z) < .01 && placement.parentId === parentId);
    assert(match, `${layout.id}: authored placement ${item.key} must already be magnetically valid`);
    assert(match.magnetCount >= (getProduct(item.productId).minimumMagnetMatches ?? 2));
    state.items.push({ id: item.key, productId: item.productId, x, y, z, parentId,
      rotation: item.rotation, colors: getDefaultColors(item.productId) });
  }
  return engine.validateAssembly(state);
}

test("15 official layouts preserve every approved recipe and platform assignment", () => {
  assert.equal(INSPIRATION_LAYOUTS.length, 15);
  assert.deepEqual(INSPIRATION_LAYOUTS.map(layout => layout.id), Object.keys(recipes));
  assert.equal(new Set(INSPIRATION_LAYOUTS.map(layout => layout.name)).size, 15);
  for (const count of [1, 2, 3]) assert.equal(INSPIRATION_LAYOUTS.filter(layout => layout.platformCount === count).length, 5);
  for (const layout of INSPIRATION_LAYOUTS) {
    assert.equal(layout.platformCount, recipes[layout.id].length);
    assert.equal(new Set(layout.items.map(item => item.key)).size, layout.items.length);
    recipes[layout.id].forEach((recipe, platform) => {
      const actual = layout.items.filter(item => item.platform === platform).map(item => item.productId);
      if (layout.poolPlatforms.some(index => index === platform)) actual.push("pool");
      assert.deepEqual(actual.sort(), recipe.split(" ").map(token => aliases[token]).sort(), `${layout.id} platform ${platform + 1}`);
    });
    for (const item of layout.items) if (item.parentKey) {
      const parent = layout.items.find(candidate => candidate.key === item.parentKey);
      assert(parent && parent.platform === item.platform, "roof attachments keep the correct owner and platform");
    }
  }
});

test("approved roof attachments remain upstairs and ground-floor hats remain on the base", () => {
  for (const layout of INSPIRATION_LAYOUTS) for (const item of layout.items) {
    const zone = layout.items.filter(candidate => candidate.platform === item.platform);
    let expectedOwner: string | undefined;
    if (item.productId === "roof-cottage" || item.productId === "planter")
      expectedOwner = zone.find(candidate => candidate.productId === "villa")?.key;
    if (item.productId === "cube-house" || (layout.id === "2D" && item.platform === 0 && item.productId === "planter"))
      expectedOwner = zone.find(candidate => candidate.productId === "l-house")?.key;
    assert.equal(item.parentKey, expectedOwner, `${layout.id}: correct floor for ${item.key}`);
  }
});

test("website and minitool ship identical authored coordinates", () => {
  assert.deepEqual(MINI_LAYOUTS, INSPIRATION_LAYOUTS);
  assert.equal(readFileSync(new URL("../src/data/inspiration-layouts.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../minitool/src/data/inspiration-layouts.ts", import.meta.url), "utf8"));
});

for (const [name, engine] of [["web", web], ["mini", mini]] as const) {
  test(`${name}: all 15 layouts pass the actual magnet, occupancy and dependency validator`, () => {
    for (const layout of INSPIRATION_LAYOUTS) {
      const state = assemble(layout, engine);
      assert.equal(state.items.length, layout.items.length);
      for (const height of [100, 200, 300] as const) {
        const elevated = engine.validateAssembly({ ...state, legHeight: height, bedding: { mode: "thick", depth: 200 } });
        assert.deepEqual(elevated.items, state.items, "display elevation cannot change authored magnetic coordinates");
      }
    }
  });
}

test("every official pipe zone forms one real connected run with opposing port faces", () => {
  let checkedZones = 0;
  for (const layout of INSPIRATION_LAYOUTS) {
    const state = assemble(layout);
    for (let platform = 0; platform < layout.platformCount; platform++) {
      const ids = new Set(layout.items.filter(item => item.platform === platform && item.productId.startsWith("pipe-")).map(item => item.key));
      const pipes = state.items.filter(item => ids.has(item.id));
      if (!pipes.length) continue;
      checkedZones++;
      const faces = pipes.map(item => getProduct(item.productId).pipeFaces!.map(face => ({
        center: web.transformPoint(face.center, getProduct(item.productId), item),
        normal: web.rotateVector(face.normal, item.rotation),
      })));
      const neighbors = pipes.map(() => new Set<number>());
      for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
        if (faces[i].some(a => faces[j].some(b =>
          a.center.every((coordinate, axis) => Math.abs(coordinate - b.center[axis]) < .01) &&
          a.normal.every((coordinate, axis) => Math.abs(coordinate + b.normal[axis]) < .01)))) {
          neighbors[i].add(j); neighbors[j].add(i);
        }
      }
      const visited = new Set<number>(), pending = [0];
      while (pending.length) {
        const index = pending.pop()!;
        if (visited.has(index)) continue;
        visited.add(index); pending.push(...neighbors[index]);
      }
      assert.equal(visited.size, pipes.length, `${layout.id}: pipe zone ${platform + 1} must have no isolated modules`);
      assert(neighbors.every(edges => edges.size > 0));
    }
  }
  assert.equal(checkedZones, 6);
});

test("single-contact accessories have at most 30mm overhang at the outside of the whole assembly", () => {
  let maximum = 0;
  for (const layout of INSPIRATION_LAYOUTS) {
    const state = assemble(layout);
    for (const item of state.items) for (const bounds of web.getItemBounds(item)) {
      const overhang = Math.max(0, -bounds[0], -bounds[1], bounds[3] - layout.platformCount * 300, bounds[4] - 300);
      maximum = Math.max(maximum, overhang);
      assert(overhang <= 30.01, `${layout.id} ${item.id}: ${overhang}mm overhang`);
      if (overhang > 6) assert.equal(getProduct(item.productId).minimumMagnetMatches, 1);
    }
  }
  assert.equal(maximum, 30);
});
