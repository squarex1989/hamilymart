import test from "node:test";
import assert from "node:assert/strict";
import * as website from "../src/lib/assembly";
import * as minitool from "../minitool/src/lib/assembly";
import * as webCode from "../src/lib/config-code";
import * as miniCode from "../minitool/src/lib/config-code";
import { decodePastedDesign } from "../src/lib/import-design";
import { applyColorStyle } from "../src/lib/color-styles";

function success(result: website.ActionResult) {
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.state;
}

for (const [name, api, codec] of [["website", website, webCode], ["minitool", minitool, miniCode]] as const) {
  test(`${name}: four-platform codes preserve covers, colors, pool, cage and fourth-platform families`, () => {
    let state = api.createInitialState();
    for (let i = 0; i < 3; i++) state = success(api.addPlatform(state));
    state = success(api.setCoverRemoved(state, "base4", "H05", true));
    state = success(api.setPlatformPool(state, "base4", true));
    state = success(api.setPlatformColors(state, "base4", { ...state.fourthPlatform!.baseColors, P01: "rose", legs: "jade" }));
    const villa = api.getPlacements(state, "villa").find(placement => placement.parentId === "base4");
    assert.ok(villa);
    state = success(api.tryPlace(state, "villa", villa));
    assert.equal(state.items[0].parentId, "base4");
    const upper = api.getPlacements(state, "roof-cottage").find(placement => placement.parentId === state.items[0].id);
    assert.ok(upper);
    state = success(api.tryPlace(state, "roof-cottage", upper));
    assert.equal(state.items[1].parentId, state.items[0].id);
    const code = codec.encodeConfig(state);
    assert.match(code, /^HM5\./);
    const restored = codec.decodeConfig(code);
    assert.equal(api.getPlatforms(restored).length, 4);
    assert.deepEqual(restored.fourthPlatform, state.fourthPlatform);
    assert.deepEqual(restored.cage, state.cage);
    assert.equal(restored.items[0].parentId, "base4");
    assert.equal(restored.items[1].parentId, restored.items[0].id);
    assert.equal(webCode.encodeConfig(restored), code);
    assert.equal(miniCode.encodeConfig(restored), code);
    assert.equal(codec.encodeConfig(api.validateAssembly(JSON.parse(JSON.stringify(state)))), code);
    assert.equal(codec.encodeConfig(decodePastedDesign(`HamilyMart 搭配清单\n搭配编号：${code}`).state), code);
    const renamed = { ...state, items: state.items.map(item => ({ ...item, id: `renamed-${item.id}`, parentId: /^base[234]?$/.test(item.parentId) ? item.parentId : `renamed-${item.parentId}` })).reverse() };
    assert.equal(codec.encodeConfig(renamed), code, "IDs and array ordering do not change configuration codes");
    const recolored = applyColorStyle(restored, 3);
    assert.equal(codec.decodeConfig(codec.encodeConfig(recolored)).fourthPlatform!.baseColors.P01, "white");
  });

  test(`${name}: historical HM3 and local saves remain compatible without a fourth platform`, () => {
    const oldCode = "HM3.WzMsNiwzMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFsxLDMwMF0sbnVsbF0.323C1BFF";
    assert.equal(codec.decodeConfig(oldCode).fourthPlatform, null);
    let state = api.createInitialState();
    for (let count = 1; count <= 3; count++) {
      const code = codec.encodeConfig(state);
      assert.match(code, /^HM5\./);
      assert.equal(codec.encodeConfig(codec.decodeConfig(code)), code);
      const { fourthPlatform: _fourth, ...oldLocalSave } = state;
      assert.equal(api.migrateAssembly(oldLocalSave).state.fourthPlatform, null);
      assert.equal(codec.encodeConfig(api.migrateAssembly(oldLocalSave).state), code);
      if (count < 3) state = success(api.addPlatform(state));
    }
  });
}
