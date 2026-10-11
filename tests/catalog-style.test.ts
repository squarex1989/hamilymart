import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_ASSET_VERSION, VISIBLE_PRODUCTS } from "../src/data/catalog";
import { addPlatform, autoPlace, createInitialState, getPlatforms, type ActionResult, type AssemblyState } from "../src/lib/assembly";
import { COLOR_STYLES, applyColorStyle, getBaseStyleColors, getProductStyleColors } from "../src/lib/color-styles";
import { colorNewAdditions, createCatalogStyleHint, detectColorStyle, originalProductThumbnailUrl, productThumbnailUrl, restoreCatalogStyle } from "../src/lib/catalog-style";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";

function success(result: ActionResult): AssemblyState {
  assert(result.ok, result.ok ? "" : result.reason);
  return result.state;
}

test("official styles are recognized from the saved assembly without a new HM3 field", () => {
  let sample = success(autoPlace(createInitialState(), "villa"));
  sample = success(autoPlace(sample, "roof-cottage"));
  sample = success(addPlatform(sample));
  for (const [index] of COLOR_STYLES.entries()) {
    const state = applyColorStyle(sample, index), code = encodeConfig(state), restored = decodeConfig(code);
    assert.equal(detectColorStyle(restored), index);
    assert.equal(restoreCatalogStyle(restored, code), index);
    assert.equal(encodeConfig(restored), code);
    assert(!Object.hasOwn(restored, "styleIndex"));
  }
});

test("a matching local hint restores the selected style after manual edits; stale hints do not", () => {
  const styled = applyColorStyle(createInitialState(), 3);
  const custom: AssemblyState = { ...styled, baseColors: { ...styled.baseColors, H03: "rose" } };
  const code = encodeConfig(custom), hint = JSON.stringify(createCatalogStyleHint(3, code));
  assert.equal(detectColorStyle(custom), -1);
  assert.equal(restoreCatalogStyle(decodeConfig(code), code, hint), 3);
  const wood = applyColorStyle(createInitialState(), 1), woodCode = encodeConfig(wood);
  assert.equal(restoreCatalogStyle(wood, woodCode, hint), 1);
  assert.equal(restoreCatalogStyle(custom, code, JSON.stringify({ styleId: "missing", configurationCode: code })), 0);
  assert.equal(restoreCatalogStyle(wood, woodCode, "{broken"), 1);
  assert.equal(encodeConfig(custom), code);
});

test("adding a product takes the catalog style without recoloring previous custom items or platforms", () => {
  let previous = success(autoPlace(applyColorStyle(createInitialState(), 3), "villa"));
  previous = { ...previous, baseColors: { ...previous.baseColors, H02: "rose" }, items: previous.items.map(item => ({ ...item, colors: { ...item.colors, A01: "red", "A01-bow": "cream" } })) };
  const before = JSON.stringify(previous), placed = success(autoPlace(previous, "roof-cottage"));
  const next = colorNewAdditions(previous, placed, 3);
  assert.deepEqual(next.items[0].colors, previous.items[0].colors);
  assert.deepEqual(next.items[1].colors, getProductStyleColors("roof-cottage", 3));
  assert.deepEqual(next.baseColors, previous.baseColors);
  assert.deepEqual(next.items.map(({ colors, ...item }) => item), placed.items.map(({ colors, ...item }) => item));
  assert.equal(JSON.stringify(previous), before);
});

test("new second and third platforms inherit the current style while earlier palettes stay intact", () => {
  const original: AssemblyState = { ...createInitialState(), baseColors: { ...createInitialState().baseColors, P01: "red", H01: "rose" } };
  const second = colorNewAdditions(original, success(addPlatform(original)), 1);
  assert.deepEqual(second.baseColors, original.baseColors);
  assert.deepEqual(second.extension!.baseColors, getBaseStyleColors(1));
  const third = colorNewAdditions(second, success(addPlatform(second)), 4);
  assert.deepEqual(third.baseColors, original.baseColors);
  assert.deepEqual(third.extension!.baseColors, second.extension!.baseColors);
  assert.deepEqual(third.thirdPlatform!.baseColors, getBaseStyleColors(4));
});

test("new pool inherits only B01; old pool and independently colored covers retain their colors", () => {
  let previous = success(addPlatform(createInitialState()));
  previous = { ...previous, baseInsert: "pool", baseColors: { ...previous.baseColors, B01: "red" }, extension: { ...previous.extension!, baseColors: { ...previous.extension!.baseColors, H02: "rose", P01: "butter", B01: "butter" } } };
  const installed = success(autoPlace(previous, "pool", "base2"));
  const next = colorNewAdditions(previous, installed, 3);
  assert.deepEqual(next.baseColors, previous.baseColors);
  assert.deepEqual(next.extension!.baseColors, { ...previous.extension!.baseColors, B01: getProductStyleColors("pool", 3).B01 });
  assert.deepEqual(getPlatforms(next).map(p => p.baseInsert), ["pool", "pool"]);
});

test("all catalog styles use offline render URLs with the shared asset revision and a legacy fallback", () => {
  for (const product of VISIBLE_PRODUCTS) for (const [index, style] of COLOR_STYLES.entries()) {
    assert.equal(productThumbnailUrl(product.id, index), `/thumbnails/${style.id}/${product.id}.png?v=${MODEL_ASSET_VERSION}`);
  }
  assert.equal(productThumbnailUrl("villa", -1), productThumbnailUrl("villa", 0));
  assert.equal(originalProductThumbnailUrl("villa"), `/thumbnails/villa.png?v=${MODEL_ASSET_VERSION}`);
});
