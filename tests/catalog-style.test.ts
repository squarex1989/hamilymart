import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_ASSET_VERSION, VISIBLE_PRODUCTS, type ColorMap } from "../src/data/catalog";
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

test("official styles recognize either saved yellow ID without changing those saved choices", () => {
  let sample = success(autoPlace(createInitialState(), "villa"));
  sample = success(autoPlace(sample, "roof-cottage"));
  for (const [index] of COLOR_STYLES.entries()) {
    const styled = applyColorStyle(sample, index);
    for (const yellow of ["butter", "yellow"] as const) {
      const recolor = (colors: ColorMap): ColorMap => Object.fromEntries(Object.entries(colors).map(([part, color]) => [part, color === "butter" || color === "yellow" ? yellow : color]));
      const historical: AssemblyState = { ...styled, baseColors: recolor(styled.baseColors), items: styled.items.map(item => ({ ...item, colors: recolor(item.colors) })) };
      const code = encodeConfig(historical);
      assert.equal(detectColorStyle(historical), index);
      assert.equal(restoreCatalogStyle(decodeConfig(code), code), index);
      assert.equal(encodeConfig(historical), code);
    }
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

test("new second, third and fourth platforms inherit the current style while earlier palettes stay intact", () => {
  const original: AssemblyState = { ...createInitialState(), baseColors: { ...createInitialState().baseColors, P01: "red", H01: "rose" } };
  const second = colorNewAdditions(original, success(addPlatform(original)), 1);
  assert.deepEqual(second.baseColors, original.baseColors);
  assert.deepEqual(second.extension!.baseColors, getBaseStyleColors(1));
  const third = colorNewAdditions(second, success(addPlatform(second)), 4);
  assert.deepEqual(third.baseColors, original.baseColors);
  assert.deepEqual(third.extension!.baseColors, second.extension!.baseColors);
  assert.deepEqual(third.thirdPlatform!.baseColors, getBaseStyleColors(4));
  const fourth = colorNewAdditions(third, success(addPlatform(third)), 3);
  assert.deepEqual(fourth.baseColors, original.baseColors);
  assert.deepEqual(fourth.extension!.baseColors, second.extension!.baseColors);
  assert.deepEqual(fourth.thirdPlatform!.baseColors, third.thirdPlatform!.baseColors);
  assert.deepEqual(fourth.fourthPlatform!.baseColors, getBaseStyleColors(3));
  assert.deepEqual(applyColorStyle(fourth, 2).fourthPlatform!.baseColors, getBaseStyleColors(2));
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


test("all five flat houses share wall and roof colors in every official palette", async () => {
  const mini = await import('../minitool/src/lib/color-styles');
  for (const api of [{ getProductStyleColors }, mini]) for (const [index] of COLOR_STYLES.entries()) {
    const milk=api.getProductStyleColors('milk-house-double',index);
    for(const id of ['l-house','cube-house','milk-house-left','milk-house-right','milk-house-double']) {
      const colors=api.getProductStyleColors(id,index);
      for(const [part,color] of Object.entries(colors)) assert.equal(color,part.endsWith('R')?milk.MCDR:milk.MCDB,`${id} ${part} palette ${index}`);
    }
  }
});
