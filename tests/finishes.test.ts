import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AVAILABLE_COLORS, COLORS, PRODUCTS, WOOD_COLOR_IDS, canonicalColorId, getColorSwatch, getDefaultColors, getEditableProductColorParts, getProductColorParts, getLinkedColorPartId, setProductColor, getSourceColorSlot, resolveLinkedProductColors } from "../src/data/catalog";
import { addPlatform, autoPlace, createInitialState, getOrderLines, migrateAssembly } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";
import { applyFinish } from "../src/lib/scene-finishes";
import { applyColorStyle, COLOR_STYLES, getBaseStyleColors, getProductStyleColors } from "../src/lib/color-styles";

test("wood finishes append to the HM3 palette and round-trip without changing original colors", () => {
  assert.deepEqual(COLORS.slice(0, 11).map(color => color.id), [
    "cream", "pine", "red", "butter", "sage", "rose", "sky", "lilac", "white", "marble", "jade",
  ]);
  assert.deepEqual(COLORS.slice(11, 14).map(color => color.id), [...WOOD_COLOR_IDS]);
  assert.deepEqual(AVAILABLE_COLORS.filter(color => WOOD_COLOR_IDS.some(id => id === color.id)).map(color => color.name), ["桃木", "仿木", "深棕"]);
  for (const color of WOOD_COLOR_IDS) {
    const state = createInitialState();
    state.baseColors.P01 = color;
    state.baseColors.legs = color;
    const decoded = decodeConfig(encodeConfig(state));
    assert.deepEqual(decoded.baseColors, state.baseColors);
    assert.equal(getColorSwatch(color), COLORS.find(candidate => candidate.id === color)!.hex);
  }
  assert.equal(getColorSwatch("cream"), "#D8C1A0");
});

test("one warm yellow occupies the original picker position while all serialized color indices remain valid", () => {
  assert.deepEqual(COLORS.slice(0, 14).map(({ id, hex }) => [id, hex]), [
    ["cream", "#D8C1A0"], ["pine", "#174A3A"], ["red", "#B8273C"], ["butter", "#F3B34E"],
    ["sage", "#A7BEA4"], ["rose", "#E9AEBC"], ["sky", "#A6C8DF"], ["lilac", "#C7B4D8"],
    ["white", "#FAFAF7"], ["marble", "#E2E2DE"], ["jade", "#299C82"],
    ["peachwood", "#BE896F"], ["wood", "#CCAB7A"], ["darkwood", "#654333"],
  ]);
  assert.deepEqual(COLORS.slice(14), [
    { id: "yellow", name: "黄色", hex: "#F3B34E" },
    { id: "black", name: "黑色", hex: "#303331" },
    { id: "gray", name: "灰色", hex: "#A4ABA9" },
  ]);
  assert.equal(COLORS[3].name, "黄色");
  assert.equal(AVAILABLE_COLORS.length, 13);
  assert.deepEqual(AVAILABLE_COLORS[3], COLORS[3]);
  assert.equal(AVAILABLE_COLORS.filter(color => color.name === "黄色").length, 1);
  assert.ok(!AVAILABLE_COLORS.some(color => (color.name as string) === "原金黄"));
  assert.equal(getDefaultColors("villa")["A01-bow"], "butter");
  for (const color of COLORS.slice(14)) {
    assert.equal(AVAILABLE_COLORS.some(available => available.id === color.id), color.id !== "yellow");
    let state = autoPlace(createInitialState(), "villa").state;
    state = { ...state, baseColors: { ...state.baseColors, P01: color.id }, items: state.items.map(item => ({ ...item, colors: { ...item.colors, "A01-ribbon": color.id } })) };
    const restored = decodeConfig(encodeConfig(state));
    assert.deepEqual(restored.baseColors, state.baseColors);
    assert.deepEqual(restored.items[0].colors, state.items[0].colors);
  }
});

test("historical yellow aliases retain their exact HM3 data but share render, order and contrast behavior", () => {
  const previous = "HM3.WzMsNywxMDAsWzAsWzE0LDEsMCwwLDAsMCwwLDAsMF0sW11dLG51bGwsW1syLDI1MCw1MCwxMTAsMCxbMTQsMTRdLC0xXSxbMiw1MCw1MCwxMTAsMCxbMywzXSwtMV1dLG51bGwsWzAsNTBdLG51bGxd.46E5DFD2";
  const state = decodeConfig(previous), before = JSON.stringify(state);
  assert.equal(encodeConfig(state), previous);
  assert.equal(state.baseColors.P01, "yellow");
  assert.deepEqual(state.items.map(item => item.colors.SHB), ["yellow", "butter"]);
  const order = getOrderLines(state).filter(line => line.sku === "HM-HS-003");
  assert.equal(order.reduce((total, line) => total + line.quantity, 0), 2);
  for (const line of order) for (const color of Object.values(line.colors)) {
    assert.equal(COLORS.find(entry => entry.id === color)!.name, "黄色");
    assert.equal(getColorSwatch(color), "#F3B34E");
  }
  assert.equal(canonicalColorId("yellow"), "butter");
  assert.equal(getColorSwatch("butter"), getColorSwatch("yellow"));
  for (const [body, detail] of [["butter", "yellow"], ["yellow", "butter"]] as const) {
    const oldHat = { G03: body, "G03-window": detail, "G03-trim": detail };
    assert.deepEqual(resolveLinkedProductColors(oldHat), { G03: body, "G03-window": "cream", "G03-trim": "cream" });
    const changed = setProductColor(oldHat, "G03-window", detail);
    assert.equal(changed["G03-window"], "cream");
    assert.equal(changed["G03-trim"], "cream");
    assert.equal(oldHat["G03-window"], detail);
  }
  assert.equal(JSON.stringify(state), before);
});

test("retired marble designs remain valid without offering marble in the picker", () => {
  // HM3 catalog 6 used index 9 for marble before the wood finishes were added.
  const previousMarbleCode = "HM3.WzMsNiwxMDAsWzAsWzksMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFswLDUwXSxudWxsXQ.34F06C49";
  const decoded = decodeConfig(previousMarbleCode);
  assert.equal(decoded.baseColors.P01, "marble");
  assert.deepEqual(decodeConfig(encodeConfig(decoded)), decoded);
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
  assert.equal(material.clearcoat, .8);
  assert.equal(material.roughness, .22);
  assert.equal(material.metalness, .04);
  applyFinish(material, "darkwood");
  assert.equal(material.clearcoat, 0);
  assert.equal(material.metalness, 0);
  assert.equal(material.customProgramCacheKey(), plain.customProgramCacheKey());
  assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  material.dispose();
  plain.dispose();
});

test("all wood tones clear inherited texture maps and shader patterns on reused materials", () => {
  const material = new THREE.MeshPhysicalMaterial(), texture = new THREE.Texture();
  for (const previous of ["marble", "jade"]) for (const color of WOOD_COLOR_IDS) {
    applyFinish(material, previous);
    material.map = texture;
    material.bumpMap = texture;
    material.normalMap = texture;
    const version = material.version;
    applyFinish(material, color);
    assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile, `${previous} → ${color} retains a procedural texture`);
    assert.equal(material.map, null);
    assert.equal(material.bumpMap, null);
    assert.equal(material.normalMap, null);
    assert.equal(material.clearcoat, 0);
    assert.equal(material.metalness, 0);
    assert.equal(material.roughness, .72);
    assert.ok(material.version > version);
    assert.equal(material.customProgramCacheKey(), "hamily-solid-1");
    assert.equal(material.color.getHexString().toUpperCase(), COLORS.find(c => c.id === color)!.hex.slice(1));
    assert.equal(getColorSwatch(color), COLORS.find(c => c.id === color)!.hex);
  }
  material.dispose();
  texture.dispose();
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
  const edges = [["A01", "A01-ribbon"], ["A01-ribbon", "A01-bow"], ["A01", "A02"], ["A02", "G15"], ["G05", "G05-base"]];
  for (let index = 0; index < COLOR_STYLES.length; index++) {
    const colored = applyColorStyle(state, index);
    const hat = colored.items.find(item => item.productId === "roof-cottage")!.colors;
    const villa = colored.items.find(item => item.productId === "villa")!.colors;
    assert.equal(villa.A02, villa["G05-base"], "the deck and stair base form one continuous color region");
    for (const cover of ["H01", "H02", "H03", "H04", "H05", "H06"]) assert.equal(colored.baseColors[cover], colored.baseColors.P01, `${COLOR_STYLES[index].name}: ${cover} must blend into its platform`);
    assert.notEqual(hat.G03, hat["G03-window"]);
    assert.notEqual(hat.G03, hat["G03-trim"]);
    if (index === 0) continue; // Original source palette intentionally shares some touching colors.
    for (const [left, right] of edges) assert.notEqual(villa[left], villa[right], `${COLOR_STYLES[index].name}: ${left}/${right}`);
    for (const part of ["legs", "B01"]) assert.notEqual(colored.baseColors.P01, colored.baseColors[part]);
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

test("catalog previews and placement share complete palettes, with a light sky theme and unchanged source defaults", () => {
  let state = autoPlace(createInitialState(), "villa").state;
  state = autoPlace(state, "roof-cottage").state;
  const before = JSON.stringify(state);
  const skyIndex = COLOR_STYLES.findIndex(style => style.id === "sky");
  const skyColors = new Set(["white", "sky", "cream", "yellow", "gray"]);
  for (let index = 0; index < COLOR_STYLES.length; index++) {
    const full = applyColorStyle(state, index);
    assert.deepEqual(getBaseStyleColors(index), full.baseColors);
    for (const item of full.items) assert.deepEqual(getProductStyleColors(item.productId, index), item.colors);
    assert.equal(getProductStyleColors("pool", index).B01, getBaseStyleColors(index).B01);
    for (const product of PRODUCTS) {
      const colors = getProductStyleColors(product.id, index);
      assert.deepEqual(Object.keys(colors), Object.keys(getDefaultColors(product.id)));
      assert.deepEqual(resolveLinkedProductColors(colors), colors, "preview colors must already match linked rendered parts");
      if (index === 0) assert.deepEqual(colors, getDefaultColors(product.id));
      if (index === skyIndex) assert.ok(Object.values(colors).every(color => skyColors.has(color)), `${product.id} introduces a dark or off-theme tone`);
    }
  }
  assert.ok(Object.values(getBaseStyleColors(skyIndex)).every(color => skyColors.has(color)));
  const preview = getProductStyleColors("villa", skyIndex);
  preview.A01 = "black";
  assert.equal(getProductStyleColors("villa", skyIndex).A01, "sky", "callers must receive independent color maps");
  assert.equal(JSON.stringify(state), before);
  assert.throws(() => getProductStyleColors("villa", -1), /未知配色/);
  assert.throws(() => getBaseStyleColors(1.5), /未知配色/);
});

test("official palettes use matching L-house and cube-house roofs, with apricot Christmas defaults", () => {
  assert.equal(COLOR_STYLES[0].id, "original");
  assert.equal(COLOR_STYLES[0].name, "圣诞礼物");
  const placed = autoPlace(createInitialState(), "l-house");
  assert.ok(placed.ok);
  const roofs = ["cream", "peachwood", "cream", "white", "rose"];
  for (const [index] of COLOR_STYLES.entries()) {
    const preview = getProductStyleColors("l-house", index);
    const styled = applyColorStyle(placed.state, index);
    assert.equal(preview.LHR, roofs[index]);
    assert.equal(styled.items[0].colors.LHR, roofs[index]);
    assert.notEqual(preview.LHB, preview.LHR);
    assert.equal(getProductStyleColors("cube-house", index).SHR, roofs[index], "both house shapes must share the theme roof color");
  }
});
