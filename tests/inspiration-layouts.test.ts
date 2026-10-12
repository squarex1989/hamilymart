import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INSPIRATION_LAYOUTS, type InspirationLayout } from "../src/data/inspiration-layouts";
import { INSPIRATION_LAYOUTS as MINI_LAYOUTS } from "../minitool/src/data/inspiration-layouts";
import { audit, portals, connected, visualBounds, visibleHouseOpening } from "../scripts/inspiration-audit";
import modelIndex from "../src/data/model-index.json";
import * as web from "../src/lib/assembly";
import * as mini from "../minitool/src/lib/assembly";
import { getDefaultColors, getProduct } from "../src/data/catalog";

const aliases: Record<string, string> = {
  V: "villa", H: "roof-cottage", L: "l-house", C: "cube-house",
  ST: "pipe-st1", SO: "pipe-st2", E: "pipe-lt2n", EO: "pipe-lt2",
  T: "pipe-tt1", TO: "pipe-tt2", F: "planter", B: "food-bowl", S: "seesaw", P: "pool",
};
// Audited recipes keep separate expectations from the coordinate fixtures.
const recipes: Record<string, string[]> = {
  "1A": ["V H F"], "1B": ["L C S"], "1C": ["H S F B"],
  "1D": ["C ST SO E B"], "1E": ["P C S F"],
  "2A": ["L C B", "V F S"], "2B": ["V H F", "P C S B"],
  "2C": ["H F B", "T ST SO EO S"], "2D": ["L F B", "H C S"],
  "2E": ["P C B F", "ST ST E S"],
  "3A": ["V H F", "P C S B", "V H F"],
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
  for (const cover of layout.openCovers ?? []) {
    if (cover.platform === 0) state.removedCovers = [cover.coverId];
    else if (cover.platform === 1) state.extension!.removedCovers = [cover.coverId];
    else state.thirdPlatform!.removedCovers = [cover.coverId];
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

test("15 official layouts preserve every audited recipe and platform assignment", () => {
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
    if (item.productId === "cube-house")
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
      const faces = pipes.map(portals);
      const neighbors = pipes.map(() => new Set<number>());
      for (let i = 0; i < pipes.length; i++) for (let j = i + 1; j < pipes.length; j++) {
        if (faces[i].some(a => faces[j].some(b => connected(a, b)))) {
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

test("all layouts stay within the platform and leave supported 60 by 50mm entrance landings", () => {
  for (const layout of INSPIRATION_LAYOUTS) assert.deepEqual(audit(assemble(layout)), [], layout.id);
});

test("open covers are limited to one and have a clear vertical passage", () => {
  let opened = 0;
  for (const layout of INSPIRATION_LAYOUTS) {
    assert((layout.openCovers?.length ?? 0) <= 1);
    const state = assemble(layout);
    for (const cover of layout.openCovers ?? []) {
      opened++;
      const b = modelIndex[cover.coverId].bounds;
      const cx = cover.platform * 300 + (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2;
      for (const item of state.items) for (const r of [...visualBounds(item), ...(item.productId === "seesaw" ? web.getItemBounds(item) : [])]) {
        assert(Math.hypot(Math.max(r[0], Math.min(cx, r[3])) - cx, Math.max(r[1], Math.min(cy, r[4])) - cy) >= 35,
          `${layout.id}: opening ${cover.coverId} is obstructed by ${item.id}`);
      }
    }
  }
  assert(opened >= 8, "provide open bedding access in the layouts with enough free space");
});

test("house directions vary across the official collection", () => {
  const turns = new Set(INSPIRATION_LAYOUTS.flatMap(l => l.items.filter(i => ["villa", "l-house", "cube-house", "roof-cottage"].includes(i.productId)).map(i => i.rotation)));
  assert.deepEqual([...turns].sort((a,b) => a-b), [0,90,180,270]);
});

test("audit catches the reported edge, outward-door and blocked-door regressions", () => {
  const base = web.createInitialState();
  const item = (productId:string, x:number, y:number, rotation:0|90|180|270=0) => ({id:productId,productId,parentId:"base",x,y,z:110,rotation,colors:getDefaultColors(productId)});
  assert(audit({...base,items:[item("food-bowl",290,190)]}).some(issue => issue.includes("overhang")));
  assert(audit({...base,items:[item("cube-house",250,250)]}).some(issue => issue.includes("doorway outside")));
  assert(audit({...base,items:[item("roof-cottage",78,240),item("planter",210,210)]}).some(issue => issue.includes("blocked")));
  assert(audit({...base,baseInsert:"pool",items:[item("villa",150,190)]}).some(issue => issue.includes("over opening")));
});


test("1D rotates the entire arrangement 180 degrees including its open cover", () => {
  const layout = INSPIRATION_LAYOUTS.find(l => l.id === "1D")!;
  const previous: Record<string, [number, number, number]> = {
    "p1-cube": [50,150,270], "p1-straight": [250,150,270], "p1-side": [150,50,180],
    "p1-elbow": [250,50,270], "p1-bowl": [190,190,0],
  };
  for (const item of layout.items) {
    const [x,y,rotation] = previous[item.key];
    assert.deepEqual(item.position, [300-x,300-y,110]);
    assert.equal(item.rotation, (rotation+180)%360);
  }
  assert.deepEqual(layout.openCovers, [{platform:0,coverId:"H05"}]);
});

test("3E is one connected pipe network across the platform seam", () => {
  const layout = INSPIRATION_LAYOUTS.find(l => l.id === "3E")!;
  const pipes = assemble(layout).items.filter(i => i.productId.startsWith("pipe-"));
  const visited = new Set<string>(), pending = [pipes[0]];
  while (pending.length) {
    const item = pending.pop()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    pending.push(...pipes.filter(other => !visited.has(other.id) && portals(item).some(a => portals(other).some(b => connected(a,b)))));
  }
  assert.equal(visited.size, pipes.length);
  assert(pipes.some(a => pipes.some(b => a.parentId !== b.parentId && portals(a).some(p => portals(b).some(q => connected(p,q))))), "an actual mouth-to-mouth join must cross the platform seam");
});

test("2E uses a simple closed-wall pipe run with only two terminal entrances", () => {
  const pipes = assemble(INSPIRATION_LAYOUTS.find(l => l.id === "2E")!).items.filter(i => i.productId.startsWith("pipe-"));
  assert.deepEqual(pipes.map(i => i.productId).sort(), ["pipe-lt2n", "pipe-st1", "pipe-st1"]);
  const faces = pipes.flatMap(portals);
  assert.equal(faces.filter(a => !faces.some(b => connected(a,b))).length, 2);
});


test("every official house shows a clear door or window in the default view", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    const state = assemble(layout);
    for (const item of state.items) assert(visibleHouseOpening(state, item), `${layout.id}/${item.id}: visible opening`);
  }
});

test("visibility audit rejects a back-facing hat and a foreground obstruction", () => {
  const state = assemble(INSPIRATION_LAYOUTS.find(l => l.id === "1A")!);
  const hat = state.items.find(i => i.productId === "roof-cottage")!;
  assert.equal(visibleHouseOpening({ ...state, items: [hat] }, { ...hat, rotation: 180 }), false);
  const cube = { ...hat, id: "screen", productId: "cube-house", parentId: "base", x: hat.x, y: hat.y - 90, z: hat.z, rotation: 0 as const };
  // The cottage's front window and right door are independently screened.
  const right = { ...cube, id: "right-screen", x: hat.x + 150, y: hat.y };
  assert.equal(visibleHouseOpening({ ...state, items: [hat, cube, right] }, hat), false);
});
