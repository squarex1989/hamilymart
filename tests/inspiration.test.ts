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
  test(`${runtime}: all fifteen layouts retain every palette and support setting and round-trip as ordinary designs`, () => {
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
    assert.equal(api.findInspirationLayout(initial), undefined, "legacy starter pool combination is distinct from the audited dry-yard 1A");
    const next = success(api.createInspiredDesign(initial, 0, undefined, () => 0));
    assert.notEqual(encode(next.state), encode(initial));
    for (const count of [1, 2, 3]) {
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
    let before = success(api.applyInspirationLayout(base(3, 3), 3, "3D")).state;
    let hatNumber = 0;
    before = {
      ...before, legHeight: 100, bedding: { mode: "thick", depth: 300 }, removedCovers: ["H01"],
      baseColors: { ...before.baseColors, legs: "darkwood" },
      items: before.items.map(item => item.productId === "roof-cottage"
        ? { ...item, colors: setProductColor(item.colors, "G03", hatNumber++ === 0 ? "rose" : "black") } : item),
    };
    const beforeJSON = JSON.stringify(before);
    const { state } = success(api.applyInspirationLayout(before, 3, "3A"));
    assert.deepEqual(state.items.filter(item => item.productId === "roof-cottage").map(item => item.colors),
      before.items.filter(item => item.productId === "roof-cottage").map(item => item.colors));
    for (const villa of state.items.filter(item => item.productId === "villa")) assert.deepEqual(villa.colors, getProductStyleColors("villa", 3));
    assert.equal(state.baseColors.legs, "darkwood");
    assert.equal(state.baseColors.B01, getProductStyleColors("pool", 3).B01);
    assert.equal(state.legHeight, 100, "existing shorter-leg choices are not changed by a template");
    assert.deepEqual(state.bedding, before.bedding);
    assert.deepEqual(state.removedCovers, (INSPIRATION_LAYOUTS.find(layout => layout.id === "3A")!.openCovers ?? []).filter(cover => cover.platform === 0).map(cover => cover.coverId));
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
