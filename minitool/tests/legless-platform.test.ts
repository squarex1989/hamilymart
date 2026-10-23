import test from "node:test";
import assert from "node:assert/strict";
import modelIndex from "../src/data/model-index.json";
import { getBaseParts } from "../src/data/catalog";
import {
  addPlatform, autoPlace, createInitialState, getDisplayElevation, getOrderLines,
  getPlatforms, migrateAssembly, setBedding, setLegHeight, setPlatformPool, validateAssembly,
  type ActionResult, type AssemblyState, type Bedding,
} from "../src/lib/assembly";
import { createNewUserState } from "../src/lib/starter-assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";
import { decodePastedDesign } from "../src/lib/import-design";

const beddingOptions: Bedding[] = [
  { mode: "none", depth: 0 }, { mode: "thin", depth: 50 },
  { mode: "thick", depth: 100 }, { mode: "thick", depth: 200 }, { mode: "thick", depth: 300 },
];
function success(result: ActionResult): AssemblyState {
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.state;
}

test("the starter's existing pool and houses remain when selecting no legs at every bedding height", () => {
  for (const bedding of beddingOptions) {
    const previous = success(setBedding(createNewUserState(), bedding));
    const state = success(setLegHeight(previous, 0));
    assert.equal(state.legHeight, 0);
    assert.equal(state.baseInsert, "pool");
    assert.deepEqual(state.items, previous.items);
    assert.deepEqual(state.baseColors, previous.baseColors);
    assert.deepEqual(state.bedding, bedding);
    assert.equal(modelIndex.P01.bounds[2] + getDisplayElevation(state), bedding.depth,
      "the actual platform underside rests on the bedding surface, including z=0 without bedding");
    assert.ok(getBaseParts(state.legHeight, state.baseInsert).every(part => !/^[LXY]0[1-4]$/.test(part.id)));
  }
});

test("all bedding transitions preserve an explicit no-leg choice and its existing pool", () => {
  for (const from of beddingOptions) {
    const original = success(setLegHeight(success(setBedding(createNewUserState(), from)), 0));
    for (const to of beddingOptions) {
      const updated = success(setBedding(original, to));
      assert.equal(updated.legHeight, 0);
      assert.equal(updated.baseInsert, "pool");
      assert.deepEqual(updated.items, original.items);
      assert.equal(modelIndex.P01.bounds[2] + getDisplayElevation(updated), to.depth);
    }
  }
});

test("pools can be installed on every legless platform without changing support or removing existing pools", () => {
  for (const bedding of beddingOptions) {
    let state = success(setLegHeight(success(setBedding(createInitialState(), bedding)), 0));
    state = success(addPlatform(success(addPlatform(state))));
    state = success(setPlatformPool(state, "base", true));
    state = success(autoPlace(state, "pool", "base3"));
    assert.deepEqual(getPlatforms(state).map(platform => platform.baseInsert), ["pool", "lid", "pool"]);
    state = success(autoPlace(state, "pool", "base2"));
    assert.equal(state.legHeight, 0);
    assert.deepEqual(state.bedding, bedding);
    assert.deepEqual(getPlatforms(state).map(platform => platform.baseInsert), ["pool", "pool", "pool"]);
    assert.equal(getOrderLines(state).filter(line => line.parts.includes("B01")).length, 3);
    assert.ok(getOrderLines(state).every(line => line.parts.every(part => !/^[LXY]0[1-4]$/.test(part))));
    assert.deepEqual(validateAssembly(state), state);
  }
});

test("switching a populated three-pool design to no legs preserves all platforms and inserts", () => {
  let previous = success(addPlatform(success(addPlatform(createNewUserState()))));
  previous = success(setPlatformPool(previous, "base2", true));
  previous = success(setPlatformPool(previous, "base3", true));
  previous = success(setBedding(previous, { mode: "thick", depth: 300 }));
  const updated = success(setLegHeight(previous, 0));
  const shape = (state: AssemblyState) => getPlatforms(state).map(({legHeight: _height, elevation: _elevation, ...platform}) => platform);
  assert.deepEqual(shape(updated), shape(previous));
  assert.deepEqual(getPlatforms(updated).map(platform => platform.legHeight), [0, 300, 300], "only the selected base switches to no legs");
  assert.deepEqual(updated.items, previous.items);
  assert.equal(updated.legHeight, 0);
});

test("legless pools survive local migration, HM3 codes and pasted order text at every bedding height", () => {
  for (const bedding of beddingOptions) {
    const state = success(setLegHeight(success(setBedding(createNewUserState(), bedding)), 0));
    const code = encodeConfig(state);
    for (const restored of [
      migrateAssembly(JSON.parse(JSON.stringify(state))).state,
      decodeConfig(code),
      decodePastedDesign(`HamilyMart 搭配清单\n搭配编号：\n${code}`).state,
    ]) {
      assert.equal(restored.legHeight, 0);
      assert.equal(restored.baseInsert, "pool");
      assert.deepEqual(restored.bedding, bedding);
      assert.equal(encodeConfig(restored), code);
      assert.equal(modelIndex.P01.bounds[2] + getDisplayElevation(restored), bedding.depth);
    }
    const older = { ...success(setPlatformPool(success(setLegHeight(success(setBedding(createInitialState(), bedding)), 0)), "base", true)), catalogVersion: 6 };
    const upgraded = migrateAssembly(older).state;
    assert.equal(upgraded.legHeight, 0);
    assert.equal(upgraded.baseInsert, "pool");
    assert.deepEqual(upgraded.bedding, bedding);
  }
});

test("changing bedding keeps the existing supported-leg adjustment without restricting older leg choices", () => {
  let supported = createNewUserState();
  for (const bedding of beddingOptions) {
    supported = success(setBedding(supported, bedding));
    assert.ok(supported.legHeight >= bedding.depth);
  }
  for (const bedding of beddingOptions) {
    const bare = success(setLegHeight(success(setBedding(createNewUserState(), bedding)), 0));
    for (const height of [100, 200, 300] as const) {
      const selected = success(setLegHeight(bare, height));
      assert.equal(selected.legHeight, height);
      assert.equal(selected.baseInsert, "pool");
      assert.deepEqual(selected.bedding, bedding);
      assert.equal(encodeConfig(decodeConfig(encodeConfig(selected))), encodeConfig(selected),
        "previously accepted shorter positive-leg configurations remain importable");
      const changed = success(setBedding(selected, bedding));
      assert.ok(changed.legHeight >= bedding.depth, "changing bedding still raises positive legs when necessary");
    }
  }
});
