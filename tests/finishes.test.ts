import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AVAILABLE_COLORS, COLORS, WOOD_COLOR_IDS, getColorSwatch, getDefaultColors, getEditableProductColorParts, getProductColorParts, getLinkedColorPartId, setProductColor, getSourceColorSlot, resolveLinkedProductColors } from "../src/data/catalog";
import { addPlatform, autoPlace, createInitialState, getOrderLines, migrateAssembly } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";
import { applyFinish } from "../src/lib/scene-finishes";
import { applyColorStyle, COLOR_STYLES } from "../src/lib/color-styles";

test("wood finishes append to the HM3 palette and round-trip without changing original colors", () => {
  assert.deepEqual(COLORS.slice(0, 11).map(color => color.id), [
    "cream", "pine", "red", "butter", "sage", "rose", "sky", "lilac", "white", "marble", "jade",
  ]);
  assert.deepEqual(COLORS.slice(11).map(color => color.id), [...WOOD_COLOR_IDS]);
  assert.deepEqual(AVAILABLE_COLORS.slice(-3).map(color => color.name), ["桃木", "仿木", "深棕"]);
  for (const color of WOOD_COLOR_IDS) {
    const state = createInitialState();
    state.baseColors.P01 = color;
    state.baseColors.legs = color;
    const decoded = decodeConfig(encodeConfig(state));
    assert.deepEqual(decoded.baseColors, state.baseColors);
    if (color === "darkwood") assert.match(getColorSwatch(color), /gradient/);
    else assert.equal(getColorSwatch(color), COLORS.find(candidate => candidate.id === color)!.hex);
  }
  assert.equal(getColorSwatch("cream"), "#F1EADB");
});

test("retired marble designs remain valid without offering marble in the picker", () => {
  // HM3 catalog 6 used index 9 for marble before the wood finishes were added.
  const previousMarbleCode = "HM3.WzMsNiwxMDAsWzAsWzksMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFswLDUwXSxudWxsXQ.34F06C49";
  const decoded = decodeConfig(previousMarbleCode);
  assert.equal(decoded.baseColors.P01, "marble");
  assert.equal(encodeConfig(decoded), previousMarbleCode);
  assert.ok(!AVAILABLE_COLORS.some(color => (color.id as string) === "marble"));
  const material = new THREE.MeshPhysicalMaterial();
  applyFinish(material, decoded.baseColors.P01);
  assert.notEqual(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  material.dispose();
});

test("changing wood, marble or jade back to a solid color removes the previous finish", () => {
  const material = new THREE.MeshPhysicalMaterial();
  const plain = new THREE.MeshPhysicalMaterial();
  applyFinish(plain, "cream");
  for (const finish of [...WOOD_COLOR_IDS, "marble", "jade"]) {
    applyFinish(material, finish);
    const previousVersion = material.version;
    applyFinish(material, "cream");
    assert.equal(material.onBeforeCompile, plain.onBeforeCompile);
    assert.equal(material.customProgramCacheKey(), plain.customProgramCacheKey());
    assert.equal(material.roughness, plain.roughness);
    assert.equal(material.metalness, plain.metalness);
    assert.equal(material.clearcoat, plain.clearcoat);
    assert.equal(material.clearcoatRoughness, plain.clearcoatRoughness);
    assert.ok(material.color.equals(plain.color));
    assert.ok(material.version > previousVersion, "a reused material must invalidate its old program");
  }
  applyFinish(material, "jade");
  applyFinish(material, "darkwood");
  assert.equal(material.clearcoat, 0);
  assert.equal(material.metalness, 0);
  assert.notEqual(material.customProgramCacheKey(), plain.customProgramCacheKey());
  material.dispose();
  plain.dispose();
});

test("peachwood and imitation wood stay uniform after previously textured finishes", () => {
  const material = new THREE.MeshPhysicalMaterial();
  for (const color of ["peachwood", "wood"] as const) {
    applyFinish(material, "darkwood");
    applyFinish(material, color);
    assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
    assert.equal(material.map, null);
    assert.equal(material.bumpMap, null);
    assert.equal(material.normalMap, null);
    assert.equal(material.clearcoat, 0);
    assert.equal(material.color.getHexString().toUpperCase(), COLORS.find(c => c.id === color)!.hex.slice(1));
  }
  material.dispose();
});

test("stair base and window append independent slots while linked kit parts have a single control", () => {
  assert.deepEqual(getProductColorParts("villa").map(part => part.id), ["A01", "A02", "G05", "G15", "G16", "G17", "W01", "W02", "A01-ribbon", "A01-bow", "G05-base"]);
  assert.deepEqual(getProductColorParts("roof-cottage").map(part => part.id), ["G03", "G03-window", "G03-trim"]);
  assert.deepEqual(getEditableProductColorParts("villa").map(part => part.id), ["A01", "A02", "G05", "G15", "A01-ribbon", "A01-bow", "G05-base"]);
  const original = getDefaultColors("villa");
  let changed = setProductColor(original, "G15", "rose");
  assert.deepEqual([changed.G15, changed.G16, changed.G17], ["rose", "rose", "rose"]);
  changed = setProductColor(changed, "A02", "sky");
  assert.deepEqual([changed.A02, changed.W01, changed.W02], ["sky", "sky", "sky"]);
  changed = setProductColor(changed, "G05-base", "peachwood");
  assert.equal(changed.G05, "red");
  assert.equal(changed["G05-base"], "peachwood");
  assert.deepEqual(original, getDefaultColors("villa"));
  assert.equal(getLinkedColorPartId("G17"), "G15");
  assert.equal(getLinkedColorPartId("W02"), "A02");
  assert.equal(getSourceColorSlot("G05", "G05_Snow", "Snow"), "G05-base");
  assert.equal(getSourceColorSlot("G03", "G03_WindowSnow", "Snow"), "G03-window");
  assert.equal(getSourceColorSlot("G03", "G03_Snow", "Snow"), "G03-trim", "hat brim and pompom must not change with the window");
});

test("order colors follow the same linked parts as the preview without erasing old saved choices", () => {
  const state = autoPlace(createInitialState(), "villa").state;
  const colors = state.items[0].colors;
  colors.G15 = "rose"; colors.G16 = "sky"; colors.G17 = "lilac";
  colors.A02 = "wood"; colors.W01 = "red"; colors.W02 = "jade";
  const before = JSON.stringify(state);
  const order = getOrderLines(state).find(line => line.sku === "HM-HS-001")!;
  assert.deepEqual([order.colors.G15, order.colors.G16, order.colors.G17], ["rose", "rose", "rose"]);
  assert.deepEqual([order.colors.A02, order.colors.W01, order.colors.W02], ["wood", "wood", "wood"]);
  assert.deepEqual(decodeConfig(encodeConfig(state)).items[0].colors, colors);
  assert.equal(JSON.stringify(state), before);
});

test("old product color arrays and local saves acquire only default new surfaces", () => {
  const previousCode = "HM3.WzMsNiwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDUsNl0sLTFdLFszLDc4LDIzOSwyMDAsMCxbMl0sMF1dLG51bGwsWzAsNTBdLG51bGxd.BCDBE1C4";
  const decoded = decodeConfig(previousCode);
  const villa = decoded.items.find(item => item.productId === "villa")!;
  const hat = decoded.items.find(item => item.productId === "roof-cottage")!;
  assert.equal(villa.colors["G05-base"], "cream");
  assert.equal(villa.colors["A01-ribbon"], "rose");
  assert.equal(villa.colors["A01-bow"], "sky");
  assert.deepEqual(hat.colors, { G03: "red", "G03-window": "cream", "G03-trim": "cream" });
  const previousLocal = { ...decoded, items: decoded.items.map(item => ({ ...item, colors: Object.fromEntries(Object.entries(item.colors).filter(([id]) => id !== "G05-base" && id !== "G03-window" && id !== "G03-trim")) })) };
  assert.deepEqual(migrateAssembly(previousLocal).state, decoded);
  villa.colors["G05-base"] = "peachwood";
  hat.colors["G03-window"] = "sky";
  assert.deepEqual(decodeConfig(encodeConfig(decoded)).items.map(item => item.colors), decoded.items.map(item => item.colors));
});

test("five complete styles recolor default material roles and preserve every assembly setting", () => {
  let state = addPlatform(createInitialState()).state;
  state = addPlatform(state).state;
  state = autoPlace(state, "villa").state;
  state = autoPlace(state, "roof-cottage").state;
  assert.equal(state.items.length, 2);
  state = { ...state, legHeight: 300, bedding: { mode: "thick", depth: 200 }, removedCovers: ["H01"], baseColors: { ...state.baseColors, P01: "marble" } };
  const before = JSON.stringify(state);
  const stripColors = (value: typeof state) => ({ ...value, baseColors: null, extension: value.extension && { ...value.extension, baseColors: null }, thirdPlatform: value.thirdPlatform && { ...value.thirdPlatform, baseColors: null }, items: value.items.map(({ colors: _colors, ...item }) => item) });
  assert.equal(COLOR_STYLES.length, 5);
  for (let index = 0; index < COLOR_STYLES.length; index++) {
    const next = applyColorStyle(state, index);
    assert.deepEqual(stripColors(next), stripColors(state));
    assert.deepEqual(applyColorStyle(applyColorStyle(state, 3), index), next, "styles must depend on original roles, not prior edits");
    assert.deepEqual(next.extension!.baseColors, next.baseColors);
    assert.deepEqual(next.thirdPlatform!.baseColors, next.baseColors);
    assert.equal(encodeConfig(decodeConfig(encodeConfig(next))), encodeConfig(next));
    for (const item of next.items) assert.deepEqual(Object.keys(item.colors), Object.keys(getDefaultColors(item.productId)));
  }
  const original = applyColorStyle(state, 0);
  assert.deepEqual(original.baseColors, createInitialState().baseColors);
  for (const item of original.items) assert.deepEqual(item.colors, getDefaultColors(item.productId));
  const wood = applyColorStyle(state, 1);
  assert.ok(WOOD_COLOR_IDS.every(id => wood.items.some(item => Object.values(item.colors).includes(id))));
  assert.equal(JSON.stringify(state), before);
});

test("new themes separate adjacent regions and all hat details contrast with their body", () => {
  let state = autoPlace(createInitialState(), "villa").state;
  state = autoPlace(state, "roof-cottage").state;
  const edges = [["A01", "A01-ribbon"], ["A01-ribbon", "A01-bow"], ["A01", "A02"], ["A02", "G15"], ["G05", "G05-base"], ["A02", "G05-base"]];
  for (let index = 0; index < COLOR_STYLES.length; index++) {
    const colored = applyColorStyle(state, index);
    const hat = colored.items.find(item => item.productId === "roof-cottage")!.colors;
    assert.notEqual(hat.G03, hat["G03-window"]);
    assert.notEqual(hat.G03, hat["G03-trim"]);
    if (index === 0) continue; // Original source palette intentionally shares some touching colors.
    const villa = colored.items.find(item => item.productId === "villa")!.colors;
    for (const [left, right] of edges) assert.notEqual(villa[left], villa[right], `${COLOR_STYLES[index].name}: ${left}/${right}`);
    for (const part of ["legs", "H01", "H06", "B01"]) assert.notEqual(colored.baseColors.P01, colored.baseColors[part]);
  }
  for (const color of AVAILABLE_COLORS) {
    const hat = setProductColor(getDefaultColors("roof-cottage"), "G03", color.id);
    assert.notEqual(hat.G03, hat["G03-window"]);
    assert.notEqual(hat.G03, hat["G03-trim"]);
  }
  const oldCreamHat = { G03: "cream", "G03-window": "cream", "G03-trim": "cream" } as const;
  assert.deepEqual(resolveLinkedProductColors(oldCreamHat), { G03: "cream", "G03-window": "pine", "G03-trim": "pine" });
  assert.equal(oldCreamHat["G03-window"], "cream", "rendering must not mutate a legacy saved choice");
});

test("the old two-slot hat HM3 keeps its custom window and appends the original brim color", () => {
  const previous = "HM3.WzMsNiwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDUsNiwwXSwtMV0sWzMsNzgsMjM5LDIwMCwwLFsyLDZdLDBdXSxudWxsLFswLDUwXSxudWxsXQ.B084680A";
  const restored = decodeConfig(previous);
  assert.deepEqual(restored.items.find(item => item.productId === "roof-cottage")!.colors, { G03: "red", "G03-window": "sky", "G03-trim": "cream" });
  assert.equal(encodeConfig(decodeConfig(encodeConfig(restored))), encodeConfig(restored));
});
