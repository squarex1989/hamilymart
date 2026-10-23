import assert from "node:assert/strict";
import test from "node:test";
import { INSPIRATION_LAYOUTS } from "../src/data/inspiration-layouts";
import * as web from "../src/lib/inspiration";
import * as mini from "../minitool/src/lib/inspiration";
import { addPlatform, createInitialState, getPlatforms, getTotalPrice, type AssemblyState, type Bedding } from "../src/lib/assembly";
import { COLOR_STYLES, applyColorStyle, getProductStyleColors } from "../src/lib/color-styles";
import { setProductColor } from "../src/data/catalog";
import { createNewUserState } from "../src/lib/starter-assembly";
import { encodeConfig, decodeConfig } from "../src/lib/config-code";
import { encodeConfig as encodeMini, decodeConfig as decodeMini } from "../minitool/src/lib/config-code";

function base(count: number, style = 0): AssemblyState {
  let state = createInitialState();
  for (let i = 1; i < count; i++) { const added = addPlatform(state); assert(added.ok); state = added.state; }
  return applyColorStyle(state, style);
}
function success(result: web.InspirationResult) {
  if (!result.ok) assert.fail(result.reason);
  return result;
}

for (const [runtime, api, encode, decode] of [["web", web, encodeConfig, decodeConfig], ["mini", mini, encodeMini, decodeMini]] as const) {
  test(`${runtime}: all twenty layouts retain every palette and support setting and round-trip as ordinary designs`, () => {
    const beddingOptions: Bedding[] = [
      { mode: "none", depth: 0 }, { mode: "thin", depth: 50 },
      { mode: "thick", depth: 100 }, { mode: "thick", depth: 200 }, { mode: "thick", depth: 300 },
    ];
    const legHeights = [0, 100, 200, 300, 0] as const;
    for (const layout of INSPIRATION_LAYOUTS) for (let style = 0; style < COLOR_STYLES.length; style++) {
      const before = { ...base(layout.platformCount, style), legHeight: legHeights[style], bedding: beddingOptions[style] };
      const original = JSON.stringify(before);
      const { state } = success(api.applyInspirationLayout(before, style, layout.id));
      assert.equal(getPlatforms(state).length, layout.platformCount);
      const pools = getPlatforms(state).filter(platform => platform.baseInsert === "pool");
      assert(pools.length <= 1, `${layout.id}: pool limit after generation`);
      for (const villa of state.items.filter(item => item.productId === "villa"))
        assert.equal(pools[0]?.id, villa.parentId, `${layout.id}: paired villa pool`);
      assert.equal(state.legHeight, before.legHeight);
      assert.deepEqual(state.bedding, before.bedding);
      assert.deepEqual(getPlatforms(state).map(platform => platform.baseColors), getPlatforms(before).map(platform => platform.baseColors));
      for (const item of state.items) assert.deepEqual(item.colors, getProductStyleColors(item.productId, style));
      assert.equal(api.findInspirationLayout(state)?.id, layout.id);
      const code = encode(state), restored = decode(code);
      assert.equal(encode(restored), code);
      assert.equal(api.findInspirationLayout(restored)?.id, layout.id, "imported IDs must not affect layout recognition");
      assert.equal(getTotalPrice(restored), getTotalPrice(state));
      assert.equal(JSON.stringify(before), original, "applying a preset must not mutate history snapshots");
    }
  });

  test(`${runtime}: new-user defaults and the previous layout never repeat immediately`, () => {
    const initial = createNewUserState();
    assert.equal(api.findInspirationLayout(initial), undefined, "starter without a downward pipe is distinct from 1A");
    const next = success(api.createInspiredDesign(initial, 0, undefined, () => 0));
    assert.notEqual(encode(next.state), encode(initial));
    for (const count of [1, 2, 3, 4]) {
      const seen = new Set<string>();
      for (const random of [0, .2, .4, .6, .8, .999, 1, -1, NaN]) {
        const applied = success(api.createInspiredDesign(base(count), 2, undefined, () => random));
        assert.equal(applied.layout.platformCount, count);
        seen.add(applied.layout.id);
      }
      assert.equal(seen.size, 5, "every matching layout is selectable");
      let state = base(count), previous: string | undefined;
      for (let i = 0; i < 8; i++) {
        const next = success(api.createInspiredDesign(state, 2, previous, () => .35));
        assert.notEqual(next.layout.id, previous);
        assert.notEqual(encode(next.state), encode(state));
        state = next.state; previous = next.layout.id;
      }
      // Undo/import may restore a different layout from the remembered last one.
      const existing = success(api.applyInspirationLayout(base(count), 2, `${count}A`)).state;
      const fromUndo = success(api.createInspiredDesign(existing, 2, `${count}B`, () => 0));
      assert(![`${count}A`, `${count}B`].includes(fromUndo.layout.id));
    }
  });

  test(`${runtime}: retained types preserve manual colors and new types use the active palette`, () => {
    let before = success(api.applyInspirationLayout(base(3, 3), 3, "3A")).state;
    let hatNumber = 0;
    before = {
      ...before, legHeight: 100, bedding: { mode: "thick", depth: 300 }, removedCovers: ["H01"],
      baseColors: { ...before.baseColors, legs: "darkwood" },
      items: before.items.map(item => item.productId === "roof-cottage"
        ? { ...item, colors: setProductColor(item.colors, "G03", hatNumber++ === 0 ? "rose" : "black") } : item),
    };
    const beforeJSON = JSON.stringify(before);
    const { state } = success(api.applyInspirationLayout(before, 3, "3B"));
    assert.deepEqual(state.items.filter(item => item.productId === "roof-cottage").map(item => item.colors),
      before.items.filter(item => item.productId === "roof-cottage").map(item => item.colors));
    for (const villa of state.items.filter(item => item.productId === "villa")) assert.deepEqual(villa.colors, getProductStyleColors("villa", 3));
    assert.equal(state.baseColors.legs, "darkwood");
    assert.equal(state.baseColors.B01, getProductStyleColors("pool", 3).B01);
    assert.equal(state.legHeight, 100, "existing shorter-leg choices are not changed by a template");
    assert.deepEqual(state.bedding, before.bedding);
    assert.deepEqual(state.removedCovers, (INSPIRATION_LAYOUTS.find(layout => layout.id === "3B")!.openCovers ?? []).filter(cover => cover.platform === 0).map(cover => cover.coverId));
    assert.equal(JSON.stringify(before), beforeJSON);
  });

  test(`${runtime}: invalid choices fail atomically without discarding the current design`, () => {
    const state = createNewUserState();
    for (const [id, style] of [["missing", 0], ["3A", 0], ["1A", 99], ["1A", .5]] as const) {
      const result = api.applyInspirationLayout(state, style, id);
      assert.equal(result.ok, false); assert.equal(result.state, state);
    }
  });
}

for (const [runtime, api, encode, decode] of [["web", web, encodeConfig, decodeConfig], ["mini", mini, encodeMini, decodeMini]] as const) {
  test(`${runtime}: each official design includes a downward pipe only when platform clearance is at least 5 cm`, () => {
    for (const layout of INSPIRATION_LAYOUTS) {
      const authoredPipes = layout.items.filter(item => item.productId === "pipe-down").length;
      assert(authoredPipes >= 1, layout.id);
      const cases = [
        { legHeight: 0 as const, bedding: { mode: "none", depth: 0 } as Bedding, expected: 0 },
        { legHeight: 0 as const, bedding: { mode: "thin", depth: 50 } as Bedding, expected: authoredPipes },
        { legHeight: 0 as const, bedding: { mode: "thick", depth: 100 } as Bedding, expected: authoredPipes },
        { legHeight: 100 as const, bedding: { mode: "none", depth: 0 } as Bedding, expected: authoredPipes },
      ];
      for (const options of cases) {
        const before = { ...base(layout.platformCount, 2), legHeight: options.legHeight, bedding: options.bedding };
        const { state } = success(api.applyInspirationLayout(before, 2, layout.id));
        assert.equal(state.items.filter(item => item.productId === "pipe-down").length, options.expected, `${layout.id}: ${options.legHeight} mm legs / ${options.bedding.depth} mm bedding`);
        assert.equal(state.items.filter(item => item.productId !== "pipe-down").length, layout.items.length - authoredPipes);
        assert.equal(api.findInspirationLayout(state)?.id, layout.id, "height-conditioned variants remain recognizable");
        const restored = decode(encode(state));
        assert.equal(api.findInspirationLayout(restored)?.id, layout.id, "import preserves conditional recognition");
        assert.equal(restored.items.filter(item => item.productId === "pipe-down").length, options.expected);
        assert.deepEqual(state.removedCovers, (layout.openCovers ?? []).filter(cover => cover.platform === 0).map(cover => cover.coverId), "automatic openings must not become manual removals");
      }
    }
  });
}


for (const [runtime, api] of [["web", web], ["mini", mini]] as const) {
  test(`${runtime}: changing inspiration replaces existing pools instead of accumulating them`, () => {
    const initial = base(4, 3);
    const manyPools: AssemblyState = { ...initial, baseInsert: "pool",
      extension: {...initial.extension!, baseInsert: "pool"},
      thirdPlatform: {...initial.thirdPlatform!, baseInsert: "pool"},
      fourthPlatform: {...initial.fourthPlatform!, baseInsert: "pool"} };
    const {state} = success(api.applyInspirationLayout(manyPools, 3, "4B"));
    assert.deepEqual(getPlatforms(state).map(platform=>platform.baseInsert), ["lid", "lid", "lid", "pool"]);
    assert.equal(getPlatforms(manyPools).filter(platform=>platform.baseInsert==="pool").length, 4, "history remains unchanged");
  });
}
