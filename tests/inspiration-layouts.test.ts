import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { INSPIRATION_LAYOUTS, type InspirationLayout } from "../src/data/inspiration-layouts";
import { INSPIRATION_LAYOUTS as MINI_LAYOUTS } from "../minitool/src/data/inspiration-layouts";
import { audit, portals, connected, visualBounds, visibleHouseOpening, stairAccessIssues, stairPorts } from "../scripts/inspiration-audit";
import modelIndex from "../src/data/model-index.json";
import * as web from "../src/lib/assembly";
import * as mini from "../minitool/src/lib/assembly";
import { getDefaultColors, getProduct, VISIBLE_PRODUCTS } from "../src/data/catalog";

function assemble(layout: InspirationLayout, engine: typeof web | typeof mini = web) {
  let state = engine.createInitialState();
  state.bedding = { mode: "none", depth: 0 };
  for (let count = 1; count < layout.platformCount; count++) {
    const added = engine.addPlatform(state); assert(added.ok); state = added.state;
  }
  const platforms = [state, state.extension, state.thirdPlatform, state.fourthPlatform];
  for (const index of layout.poolPlatforms) platforms[index]!.baseInsert = "pool";
  for (const cover of layout.openCovers ?? []) platforms[cover.platform]!.removedCovers.push(cover.coverId);
  for (const item of layout.items) {
    const [x, y, z] = item.position;
    const parentId = item.parentKey ?? ["base", "base2", "base3", "base4"][item.platform];
    const match = engine.getPlacements(state, item.productId, item.rotation).find(placement =>
      Math.abs(placement.x - x) < .01 && Math.abs(placement.y - y) < .01 &&
      Math.abs(placement.z - z) < .01 && placement.parentId === parentId);
    assert(match, `${layout.id}: authored placement ${item.key} must already be magnetically valid`);
    if (getProduct(item.productId).attachment !== "platform-hole")
      assert(match.magnetCount >= (getProduct(item.productId).minimumMagnetMatches ?? 2));
    state.items.push({ id: item.key, productId: item.productId, x, y, z, parentId,
      rotation: item.rotation, colors: getDefaultColors(item.productId) });
  }
  return engine.validateAssembly(state);
}

test("twenty distinct official layouts offer five choices at each platform count and cover the entire library", () => {
  assert.equal(INSPIRATION_LAYOUTS.length, 20);
  assert.equal(new Set(INSPIRATION_LAYOUTS.map(layout => layout.id)).size, 20);
  assert.equal(new Set(INSPIRATION_LAYOUTS.map(layout => layout.name)).size, 20);
  for (const count of [1, 2, 3, 4]) {
    const group = INSPIRATION_LAYOUTS.filter(layout => layout.platformCount === count);
    assert.equal(group.length, 5);
    assert(group.some(layout => layout.items.some(item => item.productId === "pokemon-center")), `Pokemon option for ${count} platforms`);
  }
  const used = new Set(INSPIRATION_LAYOUTS.flatMap(layout => [...layout.items.map(item => item.productId), ...(layout.poolPlatforms.length ? ["pool"] : [])]));
  for (const product of VISIBLE_PRODUCTS.filter(product => product.id !== "base")) assert(used.has(product.id), `showcase ${product.name}`);
  for (const layout of INSPIRATION_LAYOUTS) {
    assert.equal(new Set(layout.items.map(item => item.key)).size, layout.items.length);
    assert(layout.items.some(item => item.productId === "pipe-down"), `${layout.id}: include bedding access`);
    for (const item of layout.items) {
      assert(item.platform < layout.platformCount);
      if (item.parentKey) assert(layout.items.some(parent => parent.key === item.parentKey));
    }
  }
});

test("website and minitool ship identical authored coordinates", () => {
  assert.deepEqual(MINI_LAYOUTS, INSPIRATION_LAYOUTS);
  assert.equal(readFileSync(new URL("../src/data/inspiration-layouts.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../minitool/src/data/inspiration-layouts.ts", import.meta.url), "utf8"));
});

for (const [name, engine] of [["web", web], ["mini", mini]] as const) {
  test(`${name}: all twenty layouts pass real magnet, collision, roof-support and door-clearance checks`, () => {
    for (const layout of INSPIRATION_LAYOUTS) {
      const state = assemble(layout, engine);
      assert.equal(state.items.length, layout.items.length);
      for (const item of state.items) {
        const without = { ...state, items: state.items.filter(other => other.id !== item.id) };
        assert.deepEqual(engine.getAutomaticPlacementIssues(without, item.productId, { ...item, key: item.id, magnetCount: 0 }), [], `${layout.id}/${item.id}`);
      }
      for (const height of [100, 200, 300] as const) {
        const elevated = engine.validateAssembly({ ...state, legHeight: height, bedding: { mode: "thick", depth: 200 } });
        assert.deepEqual(elevated.items, state.items, "display elevation cannot change authored contacts");
      }
    }
  });
}

test("every horizontal pipe zone forms one connected run with opposing mouths", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    const state = assemble(layout);
    for (let platform = 0; platform < layout.platformCount; platform++) {
      const ids = new Set(layout.items.filter(item => item.platform === platform && getProduct(item.productId).pipeFaces).map(item => item.key));
      const pipes = state.items.filter(item => ids.has(item.id));
      if (!pipes.length) continue;
      const visited = new Set<string>(), pending = [pipes[0]];
      while (pending.length) {
        const item = pending.pop()!; if (visited.has(item.id)) continue; visited.add(item.id);
        pending.push(...pipes.filter(other => !visited.has(other.id) && portals(item).some(a => portals(other).some(b => connected(a,b)))));
      }
      assert.equal(visited.size, pipes.length, `${layout.id}: pipe zone ${platform + 1} has no isolated modules`);
    }
  }
});

test("all models stay inside the platform, with visible doors and clear supported entrance landings", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    const state = assemble(layout);
    assert.deepEqual(audit(state), [], layout.id);
    for (const item of state.items) assert(visibleHouseOpening(state, item, { doorsOnly: true }), `${layout.id}/${item.id}: actual door visible, not just a window`);
  }
});

test("manual open covers remain limited to one clear bedding passage", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    assert((layout.openCovers?.length ?? 0) <= 1);
    const state = assemble(layout);
    for (const cover of layout.openCovers ?? []) {
      const b = modelIndex[cover.coverId].bounds;
      const cx = cover.platform * 300 + (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2;
      for (const item of state.items) for (const r of [...visualBounds(item), ...(item.productId === "seesaw" ? web.getItemBounds(item) : [])])
        assert(Math.hypot(Math.max(r[0], Math.min(cx, r[3])) - cx, Math.max(r[1], Math.min(cy, r[4])) - cy) >= 35,
          `${layout.id}: opening ${cover.coverId} obstructed by ${item.id}`);
    }
  }
});

test("Pokemon doors and Central Garden Street's villa face the front without overhang", () => {
  for (const layout of INSPIRATION_LAYOUTS) for (const item of layout.items)
    if (item.productId === "pokemon-center") {
      assert.equal(item.rotation, 0);
      assert.equal(item.position[1], 200, "rear magnetic placement leaves the free space in front of the door");
    }
  const garden = INSPIRATION_LAYOUTS.find(layout => layout.id === "3B")!;
  assert.deepEqual(garden.items.find(item => item.productId === "villa")?.position, [150,190,110]);
  assert.equal(garden.items.find(item => item.productId === "villa")?.rotation, 0);
});

test("audit catches edge overflow, outward doors and blocked entrances", () => {
  const base = web.createInitialState();
  const item = (productId:string, x:number, y:number, rotation:0|90|180|270=0) => ({id:productId,productId,parentId:"base",x,y,z:110,rotation,colors:getDefaultColors(productId)});
  assert(audit({...base,items:[item("food-bowl",290,190)]}).some(issue => issue.includes("overhang")));
  assert(audit({...base,items:[item("cube-house",250,250)]}).some(issue => issue.includes("doorway outside")));
  assert(audit({...base,items:[item("roof-cottage",78,240),item("planter",210,210)]}).some(issue => issue.includes("blocked")));
  assert(audit({...base,items:[item("pokemon-center",150,100,180)]}).some(issue => issue.includes("no visible opening")));
});

test("3E and 4E retain one connected network across their first two platforms", () => {
  for (const id of ["3E", "4E"]) {
    const pipes = assemble(INSPIRATION_LAYOUTS.find(layout => layout.id === id)!).items.filter(item => getProduct(item.productId).pipeFaces);
    const visited = new Set<string>(), pending = [pipes[0]];
    while (pending.length) {
      const item = pending.pop()!; if (visited.has(item.id)) continue; visited.add(item.id);
      pending.push(...pipes.filter(other => !visited.has(other.id) && portals(item).some(a => portals(other).some(b => connected(a,b)))));
    }
    assert.equal(visited.size, pipes.length);
    assert(pipes.some(a => pipes.some(b => a.parentId !== b.parentId && portals(a).some(p => portals(b).some(q => connected(p,q))))));
  }
});

test("2E keeps its simple three-piece run and prior requested pipe/rocker positions", () => {
  const items = INSPIRATION_LAYOUTS.find(layout => layout.id === "2E")!.items;
  assert.deepEqual(items.filter(item => getProduct(item.productId).pipeFaces).map(item => [item.productId,item.position,item.rotation]),
    [["pipe-st1",[350,250,110],0],["pipe-st1",[450,250,110],0],["pipe-lt2n",[550,250,110],0]]);
  assert.deepEqual(items.find(item => item.productId === "seesaw")!.position, [400,150,110]);
});

test("every rocker presents its board toward the default viewer", () => {
  for (const layout of INSPIRATION_LAYOUTS) for (const item of layout.items) if (item.productId === "seesaw") {
    const angle = item.rotation * Math.PI / 180;
    assert(Math.cos(angle) * 480 + Math.sin(angle) * -710 > 0, `${layout.id}/${item.key}`);
  }
});


test("every stair connects an accessible lower entry to a clear, same-height roof landing", () => {
  for (const layout of INSPIRATION_LAYOUTS) assert.deepEqual(stairAccessIssues(assemble(layout)), [], layout.id);
});

test("stair audit rejects wrong exits, detached stairs, mismatched heights and blocked landings", () => {
  const courtyard = assemble(INSPIRATION_LAYOUTS.find(layout => layout.id === "1C")!);
  const mutate = (changes: Partial<web.AssemblyItem>) => ({ ...courtyard, items: courtyard.items.map(item =>
    item.productId.startsWith("stairs-") ? { ...item, ...changes } : item) });
  assert(stairAccessIssues(mutate({ rotation: 180 })).some(issue => issue.includes("same-height upper landing")));
  assert(stairAccessIssues(mutate({ x: 350 })).some(issue => issue.includes("same-height upper landing")));
  assert(stairAccessIssues(mutate({ z: 115 })).some(issue => issue.includes("same-height upper landing")));
  assert(stairAccessIssues(mutate({ productId: "stairs-straight-1", rotation: 90 })).some(issue => issue.includes("entry outside")));
  const stacked = assemble(INSPIRATION_LAYOUTS.find(layout => layout.id === "4C")!);
  const blocked = { ...stacked, items: stacked.items.map(item => item.id === "p1-cube" ? { ...item, x: 150 } : item) };
  assert(stairAccessIssues(blocked).some(issue => issue.includes("upper stair landing is blocked")));
});


test("each inspiration has at most one pool, on the villa platform whenever a villa is present", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    assert(layout.poolPlatforms.length <= 1, `${layout.id}: at most one pool`);
    for (const villa of layout.items.filter(item => item.productId === "villa"))
      assert.deepEqual(layout.poolPlatforms, [villa.platform], `${layout.id}: the villa includes its own pool`);
  }
});


test("all inspiration stair entrances face the front or visible side, including villa stairs", () => {
  for (const layout of INSPIRATION_LAYOUTS) {
    const state=assemble(layout);
    for (const item of state.items) {
      const entry=item.productId === 'villa' ? web.rotateVector([0,-1,0],item.rotation) : stairPorts(item)?.entry;
      if (entry) assert(entry[0]*480 + entry[1]*-710 > 0, `${layout.id}/${item.id}: stair entry faces the default viewer`);
    }
  }
});

test("stair audit rejects rear-facing entrances even when the upper landing connects", () => {
  const state=assemble(INSPIRATION_LAYOUTS.find(layout=>layout.id==='4C')!);
  const backwards={...state,items:state.items.map(item=>item.id==='p2-stairs'?{...item,productId:'stairs-right-1',rotation:180 as const}:item)};
  const issues=stairAccessIssues(backwards);
  assert(issues.includes('p2-stairs: stair entry faces away from home view'));
  assert(!issues.includes('p2-stairs: stairs do not meet a same-height upper landing'));
});


test('inspirations use 100 mm stairs with flush milk-house landings',()=>{
  for(const layout of INSPIRATION_LAYOUTS)for(const item of layout.items.filter(i=>i.productId.startsWith('stairs-')))
    assert(item.productId.endsWith('-1'),`${layout.id}/${item.key}`);
  const state=assemble(INSPIRATION_LAYOUTS.find(l=>l.id==='4C')!);
  const stair=state.items.find(i=>i.id==='p1-stairs')!;
  assert.equal(stair.productId,'stairs-left-1');
  assert(Math.abs(stairPorts(stair)!.top[2]-210)<.001);
  assert.deepEqual(stairAccessIssues(state),[]);
  assert(stairAccessIssues({...state,items:state.items.map(i=>i.id===stair.id?{...i,z:i.z-1}:i)}).some(issue=>issue.includes('same-height upper landing')));
});
