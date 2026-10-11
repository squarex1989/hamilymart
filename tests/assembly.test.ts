import { HAMSTER_VARIANTS } from "../src/data/hamsters";
import test from "node:test";
import modelIndex from "../src/data/model-index.json";
import assert from "node:assert/strict";
import {
  CATALOG_VERSION,
  COLORS, AVAILABLE_COLORS, P01_TOP_XY, H06_TOP_XY,
  PRODUCTS,
  PRIMARY_COLOR_KEYS,
  SOURCE_TRIM_COLORS,
  SOURCE_PART_TRIM_COLORS,
  SOURCE_PART_COLOR_SLOTS,
  getSourceColorSlot,
  getProductColorParts,
  getDefaultColors,
  getBaseParts,
  getProduct,
} from "../src/data/catalog";
import {
  changeBaseInsert, setBedding, setHamster, getDisplayElevation, setPlatformColors,
  createInitialState,
  getMagnetPoints,
  getOrderLines,
  getPlacements,
  getTotalPrice,
  removeItem,
  rotateItem,
  tryPlace,
  validateAssembly,
  migrateAssembly,
  transformPoint,
  addPlatform, movePlatform, removePlatform, getPlatforms, setLegHeight, setCoverRemoved, setPlatformPool, autoPlace,
} from "../src/lib/assembly";
import type { AssemblyItem, AssemblyState, ActionResult, Placement } from "../src/lib/assembly";
import { decodeConfig, decodeConfigWithMigration, encodeConfig } from "../src/lib/config-code";

/** Frozen before V4 changes using the actual catalog-2 encoder (custom colors + reversed loft). */
const LEGACY_CATALOG_2_CODE = "HM1.WzEsMiwyMDAsMCxbNywxLDAsMCwwLDAsMCwwLDBdLFtbMCwxNTAsMTkwLDExMCwwLFs0LDYsNSwzXSwtMV0sWzMsNzgsMjM5LDIwMCwyLFsyXSwwXV1d.4AF01816";
/** Frozen before the bow-to-star model update, with separate custom ribbon/bow colors. */
const LEGACY_BOW_HM2_CODE = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDUsNl0sLTFdXV0.A72A079F";
const LEGACY_LOCAL_STATE = {
  version: 1, legHeight: 200, baseInsert: "lid",
  baseColors: { P01: "lilac", legs: "pine", H01: "cream", H02: "cream", H03: "cream", H04: "cream", H05: "cream", H06: "cream", B01: "cream" },
  items: [
    { id: "i1", productId: "villa", x: 150, y: 190, z: 110, rotation: 0, parentId: "base", colors: { A01: "sage", A02: "sky", G05: "rose", G15: "butter" } },
    { id: "i2", productId: "roof-cottage", x: 78, y: 239, z: 200, rotation: 180, parentId: "i1", colors: { G03: "red" } },
  ],
};

function place(
  state: AssemblyState,
  product: string,
  x: number,
  y: number,
  z?: number,
) {
  const result = tryPlace(state, product, { x, y, z });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result;
}

test("catalog covers source groups, four 30 cm legs and three T-pipe groups across bundles and alternatives", () => {
  const ids = new Set([
    ...PRODUCTS.flatMap((p) => p.parts.map((part) => part.id)),
    ...getBaseParts(100).map((p) => p.id),
    ...getBaseParts(200, true).map((p) => p.id),
    ...getBaseParts(300).map((p) => p.id),
  ]);
  assert.equal(ids.size, 52);
  assert.equal(Object.keys(modelIndex).length, 52);
  assert.equal(Object.values(modelIndex).reduce((total, model) => total + model.components.length, 0), 60);
  assert.equal(CATALOG_VERSION, 7);
  assert.equal(COLORS.length, 17);
  for (const p of PRODUCTS) assert.ok(p.installation === "insert" || p.bottomMagnets.length >= (p.minimumMagnetMatches ?? 2));
});
test("base starts with exactly four 10 cm legs; 20 cm substitutes the complete set", () => {
  const state = createInitialState();
  assert.equal(state.legHeight, 100);
  assert.deepEqual(
    getBaseParts(100)
      .filter((p) => /^L\d/.test(p.id))
      .map((p) => p.id),
    ["L01", "L02", "L03", "L04"],
  );
  const tall = { ...state, legHeight: 200 as const };
  assert.equal(getTotalPrice(tall) - getTotalPrice(state), 200);
  assert.deepEqual(
    getOrderLines(tall)[0].parts.filter((p) => /^X\d/.test(p)),
    ["X01", "X02", "X03", "X04"],
  );
});
test("real platform has 32 magnets plus 4 on H06, pool removes H06 magnets", () => {
  const state = createInitialState();
  assert.equal(getMagnetPoints(state).length, 36);
  const pool = changeBaseInsert(state, "pool");
  assert.equal(pool.ok, true);
  assert.equal(getMagnetPoints(pool.state).length, 32);
  assert.ok(
    !getMagnetPoints(pool.state).some(
      ({ point: [x, y] }) => [90, 110].includes(x) && [90, 110].includes(y),
    ),
  );
});
test("all seven villa external magnet points align and bundle is indivisible", () => {
  const state = createInitialState();
  const placements = getPlacements(state, "villa");
  const original = placements.find(
    (p) => p.x === 150 && p.y === 190 && p.z === 110,
  );
  assert.equal(original?.magnetCount, 7);
  const result = place(state, "villa", 150, 190);
  assert.deepEqual(getOrderLines(result.state)[1].parts, [
    "A01",
    "A02",
    "G05",
    "G15", "G16", "G17", "W01", "W02",
  ]);
  assert.equal(result.state.items.length, 1);
});
test("near pointer snaps precisely while far point springs back with unchanged state", () => {
  const state = createInitialState();
  const snapped = place(state, "cube-house", 53, 47);
  assert.equal(snapped.item.x, 50);
  assert.equal(snapped.item.y, 50);
  const miss = tryPlace(state, "cube-house", { x: -200, y: -200 });
  assert.equal(miss.ok, false);
  assert.equal(miss.state, state);
});
test("incomplete magnetic match and intersections are rejected on strict import", () => {
  const result = place(createInitialState(), "cube-house", 50, 50);
  assert.throws(
    () =>
      validateAssembly({ ...result.state, items: [{ ...result.item, x: 57 }] }),
    /磁吸位/,
  );
  const collision = tryPlace(result.state, "cube-house", { x: 50, y: 50 });
  assert.equal(collision.ok, false);
});
test("hat can use the first floor while the upper planter cannot rotate into its fence", () => {
  assert.ok(getPlacements(createInitialState(), "roof-cottage").length > 0);
  assert.ok(getPlacements(createInitialState(), "planter").length > 0);
  const villa = place(createInitialState(), "villa", 150, 190);
  const loft = place(villa.state, "roof-cottage", 78, 239, 200);
  const planter = place(loft.state, "planter", 280.5, 264, 200);
  assert.equal(planter.item.parentId, villa.item.id);
  assert.equal(getPlacements(loft.state, "planter", 180).filter(position => position.parentId === villa.item.id).length, 0);
  assert.equal(rotateItem(planter.state, planter.item.id).ok, false);
  assert.equal(removeItem(planter.state, villa.item.id).items.length, 0);
});
test("L-house roof hosts cube at actual 85.6 mm elevation and rotation preserves child dependency", () => {
  const house = place(createInitialState(), "l-house", 100, 100);
  const cube = place(house.state, "cube-house", 50, 150, 195.6);
  assert.equal(cube.item.parentId, house.item.id);
  assert.equal(cube.item.z, 195.6);
  const rotated = rotateItem(cube.state, house.item.id);
  assert.equal(rotated.ok, true, rotated.ok ? "" : rotated.reason);
  if (rotated.ok) {
    const child = rotated.state.items.find((i) => i.id === cube.item.id)!;
    assert.deepEqual(
      [child.x, child.y, child.z, child.rotation],
      [50, 50, 195.6, 90],
    );
    assert.equal(child.parentId, house.item.id);
  }
});
test("pipe and correct support are sold together; adjacent original pipe interfaces align", () => {
  const a = place(createInitialState(), "pipe-st1", 50, 50);
  const b = place(a.state, "pipe-st2", 150, 50);
  const c = place(b.state, "pipe-st3", 250, 50);
  assert.equal(c.state.items.length, 3);
  assert.deepEqual(getOrderLines(c.state)[1].parts, ["ST1T", "ST1B"]);
});
test("pipe supports retain all twelve bottom holes and allow reversed neighboring pipes without side poles", () => {
  assert.deepEqual(PRODUCTS.filter(product => product.category === "pipe").map(product => [product.id, product.bottomMagnets]), [
    ["pipe-st1", [[10, 90, 0], [90, 90, 0]]],
    ["pipe-st2", [[110, 90, 0], [190, 90, 0]]],
    ["pipe-st3", [[210, 90, 0], [290, 90, 0]]],
    ["pipe-lt1", [[10, 190, 0], [90, 190, 0]]],
    ["pipe-lt2", [[110, 190, 0], [190, 110, 0]]],
    ["pipe-lt3", [[190, 90, 0], [190, 10, 0]]],
    ["pipe-lt2n", [[110, 190, 0], [190, 110, 0]]],
    ["pipe-tt1", [[10, 90, 0], [90, 90, 0]]],
    ["pipe-tt2", [[10, 90, 0], [90, 90, 0]]],
  ]);
  for (const product of PRODUCTS.filter(product => product.category === "pipe")) {
    assert.equal(product.pipeFaces?.length, product.id.startsWith("pipe-tt") ? 3 : 2);
    assert.ok(product.pipeFaces?.every(face => !("pole" in face)));
  }
  const left = place(createInitialState(), "pipe-st1", 50, 50);
  const right = tryPlace(left.state, "pipe-st2", { x: 150, y: 130, z: 110 }, 180);
  assert.equal(right.ok, true);
  if (!right.ok || !right.item) return;
  assert.deepEqual([right.item.x, right.item.y, right.item.rotation], [150, 130, 180]);
  const product = getProduct("pipe-st2");
  assert.deepEqual(product.bottomMagnets.map(point => transformPoint(point, product, right.item!)), [[190, 90, 110], [110, 90, 110]]);
  const matchingPlacement = getPlacements(left.state, product.id, 180).find(candidate => candidate.x === 150 && candidate.y === 130);
  assert.equal(matchingPlacement?.magnetCount, 2);
  assert.deepEqual(validateAssembly(right.state), right.state);
  assert.throws(() => validateAssembly({ ...right.state, items: right.state.items.map(item => item.id === right.item!.id ? { ...item, x: 151 } : item) }), /磁吸位/);
  assert.throws(() => validateAssembly({ ...right.state, items: right.state.items.map(item => item.id === right.item!.id ? { ...item, x: 50 } : item) }), /磁吸位/);
});
test("pool variant is rejected when it would remove occupied magnets or intersect the opening", () => {
  const cube = place(createInitialState(), "cube-house", 50, 50);
  const result = changeBaseInsert(cube.state, "pool");
  assert.equal(result.ok, false);
  assert.equal(result.state, cube.state);
});
test("config is self-contained, stable across item ids and input order, and reproduces assembly", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  const state = place(cottage.state, "cube-house", 50, 50).state;
  const code = encodeConfig(state);
  assert.match(code, /^HM3\.[A-Za-z0-9_-]+\.[A-F0-9]{8}$/);
  assert.equal(encodeConfig(decodeConfig(code)), code);
  assert.equal(getTotalPrice(decodeConfig(code)), getTotalPrice(state));
  const renamed = state.items
    .map((i) => ({
      ...i,
      id: `rename-${i.id}`,
      parentId: i.parentId === "base" ? "base" : `rename-${i.parentId}`,
    }))
    .reverse();
  assert.equal(encodeConfig({ ...state, items: renamed }), code);
});
test("config changes with color, leg length, rotation or placement and checks corruption/version", () => {
  const cube = place(createInitialState(), "cube-house", 50, 50);
  const code = encodeConfig(cube.state);
  assert.notEqual(encodeConfig({ ...cube.state, legHeight: 200 }), code);
  assert.notEqual(
    encodeConfig({
      ...cube.state,
      baseColors: { ...cube.state.baseColors, P01: "rose" },
    }),
    code,
  );
  const moved = tryPlace(
    cube.state,
    "cube-house",
    { x: 150, y: 50 },
    0,
    cube.item.colors,
    cube.item.id,
  );
  assert.equal(moved.ok, true);
  if (moved.ok) assert.notEqual(encodeConfig(moved.state), code);
  const rotated = rotateItem(cube.state, cube.item.id);
  assert.equal(rotated.ok, true);
  if (rotated.ok) assert.notEqual(encodeConfig(rotated.state), code);
  assert.throws(
    () => decodeConfig(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0")),
    /校验/,
  );
  assert.throws(() => decodeConfig(code.replace("HM3.", "HM9.")), /版本/);
});
test("import rejects unknown products/colors, invalid lengths, circular dependencies and duplicates", () => {
  const cube = place(createInitialState(), "cube-house", 50, 50);
  assert.throws(() => validateAssembly({ ...cube.state, legHeight: 150 }));
  assert.throws(() =>
    validateAssembly({
      ...cube.state,
      items: [{ ...cube.item, colors: { SHB: "invisible" } }],
    }),
  );
  assert.throws(
    () =>
      validateAssembly({
        ...cube.state,
        items: [{ ...cube.item, parentId: cube.item.id }],
      }),
    /依赖/,
  );
  assert.throws(
    () => validateAssembly({ ...cube.state, items: [cube.item, cube.item] }),
    /重复/,
  );
  assert.throws(
    () =>
      validateAssembly({
        ...cube.state,
        items: [{ ...cube.item, productId: "made-up-part" }],
      }),
    /未知/,
  );
});

test("V4 loft rotation rejects 90 and 180 degrees because the new rear fence intersects the reversed cottage", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  assert.equal(rotateItem(cottage.state, cottage.item.id, 90).ok, false);
  assert.equal(rotateItem(cottage.state, cottage.item.id, 180).ok, false);
  assert.equal(rotateItem(cottage.state, cottage.item.id, 270).ok, false);
});
test("order colors contain only purchased parts and one shared leg color", () => {
  const initial = createInitialState();
  const flat = getOrderLines(initial)[0];
  assert.ok("H06" in flat.colors);
  assert.ok(!("B01" in flat.colors));
  assert.equal(flat.colors.legs, "pine");
  const poolLines = getOrderLines({ ...initial, baseInsert: "pool" });
  assert.ok(!("B01" in poolLines[0].colors));
  assert.ok(!("H06" in poolLines[0].colors));
  assert.deepEqual(poolLines[1].colors, { B01: "cream" });
  assert.equal(poolLines[1].unitPrice, 2500);
});
test("each bundled part color survives encode/decode and parent movement carries child colors intact", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  const changed = {
    ...cottage.state,
    items: cottage.state.items.map(
      (i): AssemblyItem =>
        i.id === villa.item.id
          ? {
              ...i,
              colors: {
                ...i.colors,
                A01: "lilac" as const,
                A02: "sky" as const,
                G05: "butter" as const,
                G15: "red" as const,
              },
            }
          : { ...i, colors: { G03: "pine" as const } },
    ),
  };
  const roundTrip = decodeConfig(encodeConfig(changed));
  assert.deepEqual(
    roundTrip.items.find((i) => i.productId === "villa")?.colors,
    changed.items[0].colors,
  );
  assert.deepEqual(
    roundTrip.items.find((i) => i.productId === "roof-cottage")?.colors,
    { G03: "pine", "G03-window": "cream", "G03-trim": "cream" },
  );
  const rotated = rotateItem(changed, villa.item.id, 180);
  assert.equal(rotated.ok, true, rotated.ok ? "" : rotated.reason);
  if (rotated.ok) {
    const child = rotated.state.items.find((i) => i.id === cottage.item.id)!;
    assert.deepEqual(
      [child.x, child.y, child.z, child.rotation],
      [222, 141, 200, 180],
    );
    assert.deepEqual(child.colors, { G03: "pine", "G03-window": "cream", "G03-trim": "cream" });
  }
});

test("source colors stay available with the approved warm-yellow replacement", () => {
  assert.equal(COLORS.length, 17);
  const entries = modelIndex as Record<
    string,
    { components: { colorKey: string; color: string }[] }
  >;
  const parts = [
    ...getBaseParts(100),
    ...getBaseParts(200, "pool"),
    ...PRODUCTS.flatMap((p) => p.parts),
  ];
  for (const part of parts) {
    const source = entries[part.id].components;
    const primaryKey = PRIMARY_COLOR_KEYS[part.id] ?? source[0].colorKey;
    for (const component of source) {
      const colorId =
        component.colorKey === primaryKey
          ? part.defaultColor
          : SOURCE_PART_TRIM_COLORS[part.id]?.[component.colorKey] ?? SOURCE_TRIM_COLORS[component.colorKey];
      assert.equal(
        COLORS.find((c) => c.id === colorId)?.hex.toUpperCase(),
        part.id === "LHR" || part.id === "SHR" || component.colorKey === "Snow" ? "#D8C1A0"
          : component.colorKey === "Gold" || (part.id === "A01" && component.colorKey === "ChristmasRed") ? "#F3B34E" : component.color.toUpperCase(),
        part.id + ":" + component.colorKey,
      );
    }
  }
  assert.equal(createInitialState().baseColors.legs, "pine");
  assert.equal(createInitialState().baseColors.B01, "cream");
});


test("the source palette uses the approved yellow and keeps all eight villa default slots", () => {
  assert.deepEqual(COLORS.slice(0, 4).map(color => color.hex), ["#D8C1A0", "#174A3A", "#B8273C", "#F3B34E"]);
  assert.deepEqual(getProduct("villa").parts.map(part => [part.id, part.defaultColor]), [
    ["A01", "pine"], ["A02", "cream"], ["G05", "red"], ["G15", "pine"],
    ["G16", "pine"], ["G17", "pine"], ["W01", "cream"], ["W02", "cream"],
  ]);
  assert.deepEqual(getProduct("villa").collisionBoxes[0], [0, 178.2, 110, 300, 300, 238]);
});
test("cottage follows the villa safe direction at all four parent orientations", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const initial = createInitialState();
    const target = getPlacements(initial, "villa", rotation)[0];
    assert.ok(target, `villa ${rotation}`);
    const parent = tryPlace(initial, "villa", target, rotation);
    assert.equal(parent.ok, true);
    if (!parent.ok) continue;
    const safe = getPlacements(parent.state, "roof-cottage", rotation).filter(p => p.parentId === parent.item.id);
    assert.equal(safe.length, 1);
    const original = transformPoint(getProduct("roof-cottage").origin, getProduct("villa"), parent.item);
    const originalPlacement = safe.find(p => [p.x, p.y, p.z].every((n, i) => n === original[i]));
    assert.ok(originalPlacement);
    assert.equal(originalPlacement.magnetCount, 4);
    const cottage = tryPlace(parent.state, "roof-cottage", originalPlacement, rotation);
    assert.equal(cottage.ok, true);
    assert.equal(getPlacements(parent.state, "roof-cottage", ((rotation + 180) % 360) as AssemblyItem["rotation"]).filter(p => p.parentId === parent.item.id).length, 0);
    if (cottage.ok) assert.equal(cottage.item.parentId, parent.item.id);
  }
});
function assertLegacyUpgrade(state: AssemblyState) {
  assert.equal(state.catalogVersion, 7);
  assert.equal(state.legHeight, 200);
  assert.equal(state.baseColors.P01, "lilac");
  assert.equal(state.items.length, 2);
  const villa = state.items.find(item => item.productId === "villa")!;
  const cottage = state.items.find(item => item.productId === "roof-cottage")!;
  assert.deepEqual(villa.colors, { A01: "sage", A02: "sky", G05: "rose", G15: "butter", G16: "butter", G17: "butter", W01: "sky", W02: "sky", "A01-ribbon": "butter", "A01-bow": "butter", "G05-base": "cream" });
  assert.deepEqual([cottage.x, cottage.y, cottage.z, cottage.rotation], [78, 239, 200, 0]);
  assert.deepEqual(cottage.colors, { G03: "red", "G03-window": "cream", "G03-trim": "cream" });
  assert.equal(cottage.parentId, villa.id);
}
test("frozen catalog-2 code migrates four custom colors and reports the V4 loft safety change", () => {
  const migrated = decodeConfigWithMigration(LEGACY_CATALOG_2_CODE);
  assertLegacyUpgrade(migrated.state);
  assert.match(migrated.messages.join(" "), /V4.*白柱/);
  assert.match(migrated.messages.join(" "), /围栏安全方向调整/);
  assert.deepEqual(decodeConfig(LEGACY_CATALOG_2_CODE), migrated.state);
  const currentCode = encodeConfig(migrated.state);
  assert.notEqual(currentCode, LEGACY_CATALOG_2_CODE);
  assert.deepEqual(decodeConfigWithMigration(currentCode).messages, []);
  assert.equal(encodeConfig(decodeConfig(currentCode)), currentCode);
});
test("legacy raw localStorage migrates without mutating the original or clearing any item", () => {
  const before = JSON.stringify(LEGACY_LOCAL_STATE);
  const migrated = migrateAssembly(LEGACY_LOCAL_STATE);
  assertLegacyUpgrade(migrated.state);
  assert.match(migrated.messages.join(" "), /围栏安全方向调整/);
  assert.equal(JSON.stringify(LEGACY_LOCAL_STATE), before);
  assert.deepEqual(migrateAssembly(migrated.state).messages, []);
  assert.deepEqual(migrateAssembly({ ...LEGACY_LOCAL_STATE, catalogVersion: 2 }).state, migrated.state);
});
test("legacy loft orientation migration respects every rotated parent frame", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const target = getPlacements(createInitialState(), "villa", rotation)[0];
    const parent = { ...LEGACY_LOCAL_STATE.items[0], ...target, rotation };
    const point = transformPoint([78, 239, 200], getProduct("villa"), parent);
    const child = { ...LEGACY_LOCAL_STATE.items[1], x: point[0], y: point[1], z: point[2], rotation: (rotation + 180) % 360 };
    const migrated = migrateAssembly({ ...LEGACY_LOCAL_STATE, items: [parent, child] });
    assert.deepEqual([migrated.state.items[1].x, migrated.state.items[1].y, migrated.state.items[1].z], point);
    assert.equal(migrated.state.items[1].rotation, rotation);
    assert.match(migrated.messages.join(" "), /围栏安全方向调整/);
  }
});
test("current states and unversioned eight-color villas never receive legacy direction repairs", () => {
  const valid = migrateAssembly(LEGACY_LOCAL_STATE).state;
  const bad = { ...valid, items: valid.items.map(item => item.productId === "roof-cottage" ? { ...item, rotation: 180 as const } : item) };
  assert.throws(() => validateAssembly(bad), /磁吸位/);
  assert.throws(() => migrateAssembly(bad), /磁吸位/);
  assert.throws(() => encodeConfig(bad), /磁吸位/);
  const { catalogVersion: _catalogVersion, ...unversioned } = bad;
  assert.throws(() => migrateAssembly(unversioned), /磁吸位/);
  assert.throws(() => migrateAssembly(bad, 2), /版本标记冲突/);
  assert.throws(() => migrateAssembly({ ...valid, catalogVersion: 8 }), /版本/);
});
test("legacy migration only repairs the documented 180-degree loft, never malformed positions or 90-degree lofts", () => {
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, items: LEGACY_LOCAL_STATE.items.map(item => item.productId === "roof-cottage" ? { ...item, rotation: 90 } : item) }), /磁吸位/);
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, items: LEGACY_LOCAL_STATE.items.map(item => item.productId === "roof-cottage" ? { ...item, x: item.x + 5 } : item) }), /磁吸位/);
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, catalogVersion: 3 }), /颜色不完整/);
  const { catalogVersion: _catalogVersion, ...oldEmpty } = createInitialState();
  assert.deepEqual(migrateAssembly(oldEmpty).messages, []);
  assert.equal(migrateAssembly(oldEmpty).state.catalogVersion, 7);
});

test("catalog-3 code with a valid checksum still rejects an unsafe reversed loft", () => {
  // Independent Python zlib CRC32 over a deliberately invalid current-schema payload.
  const invalidCurrentCode = "HM1.WzEsMywyMDAsMCxbNywxLDAsMCwwLDAsMCwwLDBdLFtbMCwxNTAsMTkwLDExMCwwLFs0LDYsNSwzLDMsMyw2LDZdLC0xXSxbMyw3OCwyMzksMjAwLDIsWzJdLDBdXV0.90935166";
  assert.throws(() => decodeConfigWithMigration(invalidCurrentCode), /磁吸位/);
  assert.throws(() => decodeConfig(invalidCurrentCode), /磁吸位/);
});

function success(result: ActionResult): AssemblyState {
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result.state;
}

test("three platforms share full 300 mm edges in a rightward row and reject other directions or a fourth", () => {
  let state = createInitialState();
  for (let count = 2; count <= 3; count++) {
    state = success(addPlatform(state));
    assert.deepEqual(getPlatforms(state).map(platform => [platform.id, platform.x, platform.y]), [["base", 0, 0], ["base2", 300, 0], ...(count === 3 ? [["base3", 600, 0]] : [])]);
    assert.equal(getMagnetPoints(state).length, 36 * count);
    const candidate = getPlacements(state, "cube-house").find(position => position.parentId === `base${count}`)!;
    assert.ok(tryPlace(state, "cube-house", candidate).ok);
  }
  assert.equal(addPlatform(state).ok, false);
  for (const direction of ["left", "front", "back"] as const) {
    assert.equal(addPlatform(createInitialState(), direction).ok, false);
    assert.equal(movePlatform(state, direction).ok, false);
  }
});

test("removing the middle platform shifts the third platform and its whole family left", () => {
  const first = place(createInitialState(), "cube-house", 50, 50);
  let state = success(addPlatform(success(addPlatform(first.state))));
  state = success(setPlatformColors(state, "base3", { ...state.thirdPlatform!.baseColors, P01: "jade" }));
  const villa = place(state, "villa", 750, 190, 110);
  const loft = place(villa.state, "roof-cottage", 678, 239, 200);
  const moved = success(removePlatform(loft.state, "base2"));
  assert.deepEqual(moved.items.find(item => item.id === first.item.id), first.item);
  assert.equal(moved.thirdPlatform, null);
  assert.equal(moved.extension?.baseColors.P01, "jade");
  const movedVilla = moved.items.find(item => item.id === villa.item.id)!;
  const movedLoft = moved.items.find(item => item.id === loft.item.id)!;
  assert.deepEqual([movedVilla.x, movedVilla.y, movedVilla.rotation, movedVilla.parentId], [450, 190, 0, "base2"]);
  assert.deepEqual([movedLoft.x, movedLoft.y, movedLoft.z, movedLoft.parentId], [378, 239, 200, movedVilla.id]);
  const removed = success(removePlatform(moved));
  assert.equal(removed.extension, null);
  assert.deepEqual(removed.items, [first.item]);
});

test("two magnetic contacts suffice even when the first component magnet does not align", () => {
  const state = createInitialState();
  const product = getProduct("l-house");
  const target = getPlacements(state, "l-house").find(p => p.x === 100 && p.y === 120)!;
  assert.ok(target);
  assert.equal(target.magnetCount, 2);
  const unmatchedFirst = transformPoint(product.bottomMagnets[0], product, target);
  assert.ok(!getMagnetPoints(state).some(({ point }) => point.toString() === unmatchedFirst.toString()));
  const placed = place(state, "l-house", 100, 120, 110);
  assert.equal(placed.item.x, 100);
  assert.equal(placed.item.y, 120);
  assert.deepEqual(validateAssembly(placed.state), placed.state);
  assert.throws(() => validateAssembly({ ...placed.state, items: [{ ...placed.item, y: 125 }] }), /磁吸位/);
});

test("auto placement chooses a real strongest fit and adds components in one action", () => {
  const initial = createInitialState();
  const villa = autoPlace(initial, "villa");
  assert.equal(villa.ok, true);
  if (!villa.ok) return;
  assert.equal(villa.state.items.length, 1);
  assert.deepEqual([villa.item?.x, villa.item?.y, villa.item?.z], [150, 190, 110]);
  const cottage = autoPlace(villa.state, "roof-cottage");
  assert.equal(cottage.ok, true);
  if (cottage.ok) assert.equal(cottage.item?.parentId, villa.item?.id);
  const withPool = success(autoPlace(villa.state, "pool"));
  assert.equal(withPool.baseInsert, "pool");
  assert.equal(withPool.items.length, 1);
  const second = success(addPlatform(initial));
  const preferred = autoPlace(second, "cube-house", "base2");
  assert.equal(preferred.ok, true);
  if (preferred.ok) assert.equal(preferred.item?.parentId, "base2");
});

test("auto placement fills all available space then reports the exact no-space message without changing state", () => {
  let state = createInitialState();
  for (let i = 0; i < 9; i++) state = success(autoPlace(state, "cube-house"));
  assert.equal(state.items.length, 9);
  const full = autoPlace(state, "cube-house");
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.reason, "放不下去了");
  assert.equal(full.state, state);
  const expanded = success(addPlatform(state, "right"));
  const next = autoPlace(expanded, "cube-house");
  assert.equal(next.ok, true);
  if (next.ok) assert.equal(next.item?.parentId, "base2");
});

test("small covers may be removed independently and restored; pool owns the large opening", () => {
  let state = success(addPlatform(createInitialState()));
  const price = getTotalPrice(state);
  state = success(setCoverRemoved(state, "base", "H01", true));
  state = success(setCoverRemoved(state, "base2", "H04", true));
  assert.deepEqual(state.removedCovers, ["H01"]);
  assert.deepEqual(state.extension?.removedCovers, ["H04"]);
  assert.equal(getTotalPrice(state), price);
  assert.equal(getMagnetPoints(state).length, 72);
  const orders = getOrderLines(state);
  assert.ok(!orders.find(line => line.id === "base")!.parts.includes("H01"));
  assert.ok(!orders.find(line => line.id === "base2")!.parts.includes("H04"));
  assert.ok(!("H01" in orders.find(line => line.id === "base")!.colors));
  assert.equal(setCoverRemoved(state, "base", "H06", true).ok, false);
  assert.equal(setCoverRemoved(state, "base", "P01", true).ok, false);
  state = success(setCoverRemoved(state, "base", "H01", false));
  assert.deepEqual(state.removedCovers, []);
  assert.ok(getOrderLines(state)[0].parts.includes("H01"));
});

test("no-leg mode removes all legs from the order and is incompatible with either platform pool", () => {
  let state = success(addPlatform(createInitialState(), "right"));
  const originalPrice = getTotalPrice(state);
  const noLegs = success(setLegHeight(state, 0));
  assert.equal(noLegs.legHeight, 0);
  assert.equal(originalPrice - getTotalPrice(noLegs), 2000);
  for (const line of getOrderLines(noLegs)) {
    assert.ok(!line.parts.some(id => /^[LX]0[1-4]$/.test(id)));
    assert.ok(!("legs" in line.colors));
  }
  assert.equal(getBaseParts(0).length, 7);
  assert.equal(setPlatformPool(noLegs, "base", true).ok, false);
  assert.equal(setPlatformPool(noLegs, "base2", true).ok, false);
  assert.equal(autoPlace(noLegs, "pool").ok, false);
  assert.throws(() => validateAssembly({ ...noLegs, baseInsert: "pool" }), /不兼容/);
  state = success(setPlatformPool(state, "base2", true));
  const refused = setLegHeight(state, 0);
  assert.equal(refused.ok, false);
  assert.equal(refused.state, state);
  assert.equal(state.baseInsert, "lid");
  assert.equal(state.extension?.baseInsert, "pool");
  assert.equal(getMagnetPoints(state).length, 68);
  const poolLine = getOrderLines(state).find(line => line.id === "pool-base2")!;
  assert.deepEqual(poolLine.parts, ["B01"]);
  assert.equal(poolLine.total, 2500);
  const restored = success(setPlatformPool(state, "base2", false));
  assert.equal(setLegHeight(restored, 0).ok, true);
});

test("pool auto-placement tries the other platform when the first is occupied", () => {
  const occupied = place(createInitialState(), "cube-house", 50, 50).state;
  const state = success(addPlatform(occupied, "right"));
  const withPool = success(autoPlace(state, "pool"));
  assert.equal(withPool.baseInsert, "lid");
  assert.equal(withPool.extension?.baseInsert, "pool");
  const noRoom = autoPlace(withPool, "pool");
  assert.equal(noRoom.ok, false);
  if (!noRoom.ok) assert.equal(noRoom.reason, "放不下去了");
  assert.equal(noRoom.state, withPool);
});

test("Steel V9 food bowl uses the real center-magnet interface and cannot overlap the stocking planter", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const bowl = autoPlace(villa.state, "food-bowl");
  assert.equal(bowl.ok, true);
  if (!bowl.ok || !bowl.item) return;
  assert.equal(bowl.item.parentId, villa.item.id);
  assert.deepEqual([bowl.item.x, bowl.item.y, bowl.item.z], [280.5, 264, 200]);
  assert.equal(getPlacements(bowl.state, "planter").filter(position => position.parentId === villa.item.id).length, 0);
  assert.equal(autoPlace(bowl.state, "planter").ok, true, "the other single-contact accessory may use a free first-floor position");
  assert.deepEqual(getOrderLines(bowl.state).at(-1)?.parts, ["O01"]);
  assert.deepEqual(decodeConfig(encodeConfig(bowl.state)).items.map(i => i.productId).sort(), ["food-bowl", "villa"]);
});

test("HM3 preserves platforms, pool, missing covers, colors, parent families and canonical ordering", () => {
  let state = success(addPlatform(createInitialState()));
  state = success(setCoverRemoved(state, "base", "H03", true));
  state = success(setCoverRemoved(state, "base2", "H05", true));
  state = success(setPlatformPool(state, "base2", true));
  state = success(setLegHeight(state, 200));
  state = { ...state, extension: { ...state.extension!, baseColors: { ...state.extension!.baseColors, P01: "lilac", B01: "sky" } } };
  const villa = place(state, "villa", 450, 190, 110);
  const loft = place(villa.state, "roof-cottage", 378, 239, 200);
  state = place(loft.state, "cube-house", 50, 50).state;
  const code = encodeConfig(state), restored = decodeConfig(code);
  assert.equal(encodeConfig(restored), code);
  assert.equal(restored.extension?.direction, "right");
  assert.deepEqual(restored.removedCovers, ["H03"]);
  assert.deepEqual(restored.extension?.removedCovers, ["H05"]);
  assert.equal(restored.extension?.baseColors.P01, "lilac");
  assert.equal(restored.extension?.baseColors.B01, "sky");
  assert.equal(restored.items.find(item => item.productId === "villa")?.parentId, "base2");
  assert.equal(getTotalPrice(restored), getTotalPrice(state));
  const reordered = { ...state, items: state.items.map(item => ({ ...item, id: `new-${item.id}`, parentId: ["base", "base2"].includes(item.parentId) ? item.parentId : `new-${item.parentId}` })).reverse() };
  assert.equal(encodeConfig(reordered), code);
  const third = success(addPlatform(state));
  assert.notEqual(encodeConfig(third), code);
  assert.notEqual(encodeConfig(success(setCoverRemoved(state, "base", "H03", false))), code);
});

test("valid HM1 catalog 3 migrates without moving, recoloring or dropping the existing pool", () => {
  const code = "HM1.WzEsMywxMDAsMSxbMCwxLDAsMCwwLDAsMCwwLDZdLFtbMCwxNTAsMTkwLDExMCwwLFsxLDAsMiwxLDQsNSw2LDddLC0xXSxbMyw3OCwyMzksMjAwLDAsWzJdLDBdXV0.3B0F2D99";
  const result = decodeConfigWithMigration(code);
  assert.equal(result.state.catalogVersion, 7);
  assert.equal(result.state.extension, null);
  assert.deepEqual(result.state.removedCovers, []);
  assert.equal(result.state.baseInsert, "pool");
  assert.equal(result.state.baseColors.B01, "sky");
  assert.deepEqual(result.state.items[0].colors, { A01: "pine", A02: "cream", G05: "red", G15: "pine", G16: "sage", G17: "rose", W01: "sky", W02: "lilac", "A01-ribbon": "butter", "A01-bow": "butter", "G05-base": "cream" });
  assert.deepEqual(result.state.items.map(item => [item.x, item.y, item.z, item.rotation]), [[150, 190, 110, 0], [78, 239, 200, 0]]);
  assert.match(result.messages.join(" "), /Steel V9.*30 厘米/);
  assert.deepEqual(decodeConfigWithMigration(encodeConfig(result.state)).messages, []);
});

test("strict import rejects bad extension direction, missing platform parent, duplicate covers and illegal pool items", () => {
  const initial = createInitialState();
  assert.throws(() => validateAssembly({ ...initial, extension: { direction: "diagonal", baseInsert: "lid", baseColors: initial.baseColors, removedCovers: [] } }), /第二个/);
  assert.throws(() => validateAssembly({ ...initial, removedCovers: ["H01", "H01"] }), /小圆盖/);
  assert.throws(() => validateAssembly({ ...initial, removedCovers: ["H06"] }), /小圆盖/);
  const cube = place(initial, "cube-house", 50, 50);
  assert.throws(() => validateAssembly({ ...cube.state, items: [{ ...cube.item, parentId: "base2" }] }), /依赖/);
  assert.throws(() => validateAssembly({ ...cube.state, items: [{ ...cube.item, id: "base2" }] }), /编号/);
  assert.throws(() => validateAssembly({ ...cube.state, items: [{ ...cube.item, productId: "pool" }] }), /泳池/);
});

test("changing platform direction is rejected without moving any descendant", () => {
  const main = place(createInitialState(), "villa", 150, 190);
  const expanded = success(addPlatform(main.state));
  const second = tryPlace(expanded, "villa", { x: 490, y: 150, z: 110 }, 90);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const before = JSON.stringify(second.state);
  const blocked = movePlatform(second.state, "left");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, second.state);
  assert.equal(JSON.stringify(second.state), before);
  if (!blocked.ok) assert.match(blocked.reason, /向右/);
});

test("gift ribbon and star retain the two stable color slots after eight physical kit parts", () => {
  const physical = getProduct("villa").parts.map(part => part.id);
  assert.equal(physical.length, 8);
  assert.deepEqual(getProductColorParts("villa").map(part => part.id), [...physical, "A01-ribbon", "A01-bow", "G05-base"]);
  assert.deepEqual(SOURCE_PART_COLOR_SLOTS.A01, { Gold: "A01-ribbon", ChristmasRed: "A01-bow" });
  const defaults = getDefaultColors("villa");
  assert.equal(defaults["A01-ribbon"], "butter");
  assert.equal(defaults["A01-bow"], "butter");
  assert.equal(getProductColorParts("villa").find(part => part.id === "A01-bow")?.role, "五角星");
  assert.deepEqual(getProductColorParts("cube-house"), getProduct("cube-house").parts);
});

test("Gold ribbon and Gold star use independent component IDs before the material fallback", () => {
  const selected: AssemblyItem["colors"] = { ...getDefaultColors("villa"), "A01-ribbon": "rose", "A01-bow": "sky" };
  const bodies = [
    { sourcePart: "A01_Gold", colorKey: "Gold" },
    { sourcePart: "A01_StarGold", colorKey: "Gold" },
  ];
  assert.deepEqual(bodies.map(body => selected[getSourceColorSlot("A01", body.sourcePart, body.colorKey)!]), ["rose", "sky"]);
  assert.equal(getSourceColorSlot("A01", "A01_BowGold", "Gold"), "A01-bow");
  assert.equal(getSourceColorSlot("A01", "A01_ChristmasRed", "ChristmasRed"), "A01-bow");
  assert.equal(getSourceColorSlot("A01", undefined, "ChristmasRed"), "A01-bow");
  assert.equal(getSourceColorSlot("A01", undefined, "Gold"), "A01-ribbon");
  assert.equal(getSourceColorSlot("A01", "A01_PineGreen", "PineGreen"), undefined);
  assert.equal(getSourceColorSlot("LHR", "A01_StarGold", "Gold"), undefined);
});

test("existing HM2 and local bow choices carry over to the star across the catalog upgrade", () => {
  const decoded = decodeConfig(LEGACY_BOW_HM2_CODE);
  const previousLocal = {
    ...decoded,
    items: [{ ...decoded.items[0], colors: {
      A01: "pine", A02: "cream", G05: "red", G15: "pine", G16: "pine", G17: "pine", W01: "cream", W02: "cream",
      "A01-ribbon": "rose", "A01-bow": "sky",
    } }],
  };
  for (const state of [decoded, migrateAssembly(previousLocal).state]) {
    assert.equal(state.items[0].colors["A01-ribbon"], "rose");
    assert.equal(state.items[0].colors["A01-bow"], "sky");
    assert.equal(encodeConfig(state), encodeConfig(decoded));
    assert.equal(state.catalogVersion, 7);
    assert.equal(state.items[0].colors[getSourceColorSlot("A01", "A01_StarGold", "Gold")!], "sky");
    assert.equal(getOrderLines(state).find(line => line.sku === "HM-HS-001")?.parts.length, 8);
  }
});

test("ribbon changes survive HM2, local migration and movement without recoloring the star or other parts", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const before = encodeConfig(villa.state);
  const changed = { ...villa.state, items: [{ ...villa.item, colors: { ...villa.item.colors, "A01-ribbon": "rose" as const } }] };
  const code = encodeConfig(changed);
  assert.notEqual(code, before);
  const decoded = decodeConfig(code), local = migrateAssembly(changed).state;
  for (const state of [decoded, local]) {
    assert.equal(state.items[0].colors["A01-ribbon"], "rose");
    assert.equal(state.items[0].colors["A01-bow"], "butter");
    assert.equal(state.items[0].colors.A01, "pine");
    assert.equal(state.items[0].colors.G05, "red");
  }
  const rotated = rotateItem(changed, villa.item.id, 180);
  assert.equal(rotated.ok, true);
  if (rotated.ok) assert.deepEqual(rotated.item.colors, changed.items[0].colors);
  const bowChanged = { ...changed, items: [{ ...changed.items[0], colors: { ...changed.items[0].colors, "A01-bow": "sky" as const } }] };
  assert.notEqual(encodeConfig(bowChanged), code);
  assert.equal(decodeConfig(encodeConfig(bowChanged)).items[0].colors["A01-ribbon"], "rose");
  const line = getOrderLines(bowChanged).find(line => line.sku === "HM-HS-001")!;
  assert.equal(line.parts.length, 8);
  assert.ok(!line.parts.includes("A01-ribbon"));
  assert.equal(line.colors["A01-ribbon"], "rose");
  assert.equal(line.colors["A01-bow"], "sky");
  assert.equal(getTotalPrice(changed), getTotalPrice(villa.state));
});

test("pre-slot catalog-4 HM2 and local data add default yellow slots while preserving custom physical colors", () => {
  const oldCode = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbNCwwLDIsNSwxLDEsMCwwXSwtMV1dXQ.9390F3EF";
  const decoded = decodeConfig(oldCode);
  assert.equal(decoded.items[0].colors.A01, "sage");
  assert.equal(decoded.items[0].colors.G15, "rose");
  assert.equal(decoded.items[0].colors["A01-ribbon"], "butter");
  assert.equal(decoded.items[0].colors["A01-bow"], "butter");
  const colors = Object.fromEntries(Object.entries(decoded.items[0].colors).filter(([key]) => !key.startsWith("A01-"))) as AssemblyItem["colors"];
  const oldLocal = { ...decoded, items: [{ ...decoded.items[0], colors }] };
  const before = JSON.stringify(oldLocal);
  assert.deepEqual(migrateAssembly(oldLocal).state, decoded);
  assert.equal(JSON.stringify(oldLocal), before);
  const updatedCode = encodeConfig(decoded);
  assert.notEqual(updatedCode, oldCode);
  assert.equal(encodeConfig(decodeConfig(updatedCode)), updatedCode);
});

test("different decorative colors produce separate order lines without adding physical kit parts", () => {
  const main = place(createInitialState(), "villa", 150, 190);
  const expanded = success(addPlatform(main.state));
  const second = tryPlace(expanded, "villa", { x: 490, y: 150, z: 110 }, 90);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(getOrderLines(second.state).find(line => line.sku === "HM-HS-001")?.quantity, 2);
  const changed = { ...second.state, items: second.state.items.map(item => item.id === second.item.id ? { ...item, colors: { ...item.colors, "A01-ribbon": "lilac" as const } } : item) };
  const lines = getOrderLines(changed).filter(line => line.sku === "HM-HS-001");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => line.quantity), [1, 1]);
  assert.deepEqual(lines.map(line => line.colors["A01-ribbon"]).sort(), ["butter", "lilac"]);
  assert.ok(lines.every(line => line.parts.length === 8));
  assert.throws(() => validateAssembly({ ...changed, items: changed.items.map(item => ({ ...item, colors: { ...item.colors, "A01-ribbon": "not-a-stock-color" } })) }), /未知颜色/);
});

test("Steel V16 keeps the 162 mm hat and uses audited partial overlap on real base steel", () => {
  const state = createInitialState();
  const product = getProduct("roof-cottage");
  assert.deepEqual(product.origin, [78, 239, 200]);
  assert.deepEqual(product.bottomMagnets, [[10, 192, 200], [10, 286, 200], [156, 192, 200], [156, 286, 200]]);
  assert.equal(product.collisionBoxes[0][3] - product.collisionBoxes[0][0], 162);
  assert.deepEqual(product.collisionBoxes[0], modelIndex.G03.bounds, "collision bounds must match the actual Steel V15 G03 asset");
  for (const rotation of [0, 90, 180, 270] as const) assert.equal(getPlacements(state, product.id, rotation).length, 24);
  assert.equal(autoPlace(state, product.id).ok, true);
  const extended = success(addPlatform(state, "right"));
  assert.equal(autoPlace(extended, product.id, "base2").ok, true);
});

test("Steel V15 hat keeps its stable upper-floor transform with all four source contacts", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const product = getProduct("roof-cottage");
  const candidate = getPlacements(villa.state, product.id).find(p => p.parentId === villa.item.id && p.x === 78 && p.y === 239)!;
  assert.ok(candidate);
  assert.equal(candidate.magnetCount, 4);
  const hostPoints = getMagnetPoints(villa.state).filter(point => point.parentId === villa.item.id).map(({ point }) => point.join(","));
  const matching = product.bottomMagnets.map(point => transformPoint(point, product, candidate)).filter(point => hostPoints.includes(point.join(",")));
  assert.deepEqual(matching, [[10, 192, 200], [10, 286, 200], [156, 192, 200], [156, 286, 200]]);
  const automatic = autoPlace(villa.state, product.id);
  assert.equal(automatic.ok, true);
  if (automatic.ok) assert.deepEqual([automatic.item?.x, automatic.item?.y, automatic.item?.z, automatic.item?.parentId], [78, 239, 200, villa.item.id]);
});

test("frozen pre-resize HM2 keeps its hat position and upgrades the catalog without component loss", () => {
  const oldCode = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTFdLFszLDc4LDIzOSwyMDAsMCxbMl0sMF1dXQ.825BCB03";
  const restored = decodeConfigWithMigration(oldCode);
  assert.match(restored.messages.join(" "), /Steel V9/);
  assert.equal(restored.state.items.length, 2);
  const villa = restored.state.items.find(item => item.productId === "villa")!;
  const cottage = restored.state.items.find(item => item.productId === "roof-cottage")!;
  assert.deepEqual([cottage.x, cottage.y, cottage.z, cottage.rotation, cottage.parentId], [78, 239, 200, 0, villa.id]);
  assert.deepEqual(decodeConfig(encodeConfig(restored.state)), restored.state);
});


test("rotation resnapping carries the whole villa family as a rigid transform with independent colors", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  const bowl = tryPlace(cottage.state, "food-bowl", { x: 280.5, y: 264, z: 200 });
  assert.equal(bowl.ok, true);
  if (!bowl.ok || !bowl.item) return;
  const state = { ...bowl.state, items: bowl.state.items.map(item => item.id === villa.item.id ? { ...item, colors: { ...item.colors, "A01-ribbon": "rose" as const, "A01-bow": "sky" as const } } : item.id === cottage.item.id ? { ...item, colors: { ...item.colors, G03: "lilac" as const } } : item) };
  const before = JSON.stringify(state);
  const rotated = rotateItem(state, villa.item.id);
  assert.equal(rotated.ok, true, rotated.ok ? "" : rotated.reason);
  if (!rotated.ok) return;
  assert.deepEqual([rotated.item.x, rotated.item.y, rotated.item.z, rotated.item.rotation], [110, 150, 110, 90]);
  const hat = rotated.state.items.find(item => item.id === cottage.item.id)!;
  assert.deepEqual([hat.x, hat.y, hat.z, hat.rotation, hat.parentId], [61, 78, 200, 90, villa.item.id]);
  const movedBowl = rotated.state.items.find(item => item.id === bowl.item!.id)!;
  assert.deepEqual([movedBowl.x, movedBowl.y, movedBowl.z, movedBowl.rotation, movedBowl.parentId], [36, 280.5, 200, 90, villa.item.id]);
  for (const item of rotated.state.items) assert.deepEqual(item.colors, state.items.find(previous => previous.id === item.id)!.colors);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(validateAssembly(rotated.state), rotated.state);
});

test("rotation keeps a valid original pivot and never jumps from a restricted second floor to another parent", () => {
  const cube = place(createInitialState(), "cube-house", 50, 50);
  const turn = rotateItem(cube.state, cube.item.id);
  assert.equal(turn.ok, true);
  if (turn.ok) assert.deepEqual([turn.item.x, turn.item.y, turn.item.z], [50, 50, 110]);
  const villa = place(success(addPlatform(createInitialState(), "right")), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  assert.ok(getPlacements(cottage.state, "roof-cottage", 90, cottage.item.id).some(placement => placement.parentId === "base2"));
  const before = JSON.stringify(cottage.state);
  const blocked = rotateItem(cottage.state, cottage.item.id);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, cottage.state);
  assert.equal(JSON.stringify(cottage.state), before);
});

test("Steel V9 exposes exactly five upper contacts and single-center accessories use only their reserved region", () => {
  const villaProduct = getProduct("villa");
  assert.deepEqual(villaProduct.surfaces!.flatMap(surface => surface.points), [[10, 192, 200], [10, 286, 200], [156, 192, 200], [156, 286, 200], [280.5, 264, 200]]);
  const upperAccessories = PRODUCTS.filter(product => product.minimumMagnetMatches === 1 && product.allowedParents?.includes("villa"));
  assert.deepEqual(upperAccessories.map(product => product.id), ["planter", "food-bowl"]);
  for (const rotation of [0, 90, 180, 270] as const) {
    const initial = createInitialState();
    const position = getPlacements(initial, "villa", rotation)[0];
    const villa = tryPlace(initial, "villa", position, rotation);
    assert.equal(villa.ok, true);
    if (!villa.ok) continue;
    const target = transformPoint([280.5, 264, 200], villaProduct, villa.item);
    for (const { id } of upperAccessories) {
      assert.deepEqual(getProduct(id).bottomMagnets, [[280.5, 264, 200]]);
      assert.equal(getProduct(id).minimumMagnetMatches, 1);
      assert.ok(getPlacements(initial, id, rotation).length > 0);
      const placements: Placement[] = getPlacements(villa.state, id, rotation).filter(position => position.parentId === villa.item.id);
      assert.equal(placements.length, 1, `${id} must not use hat holes or overhang the platform`);
      assert.deepEqual([placements[0].x, placements[0].y, placements[0].z], target);
      assert.equal(placements[0].magnetCount, 1);
      const added = tryPlace(villa.state, id, placements[0], rotation);
      assert.equal(added.ok, true);
      if (added.ok) assert.equal(getPlacements(added.state, id === "planter" ? "food-bowl" : "planter", rotation).filter(position => position.parentId === villa.item.id).length, 0);
    }
  }
  for (const product of PRODUCTS.filter(product => product.installation !== "insert" && product.minimumMagnetMatches !== 1)) {
    for (const rotation of [0, 90, 180, 270] as const) assert.ok(getPlacements(createInitialState(), product.id, rotation).every(position => position.magnetCount >= 2));
  }
});

test("historical bowl and stocking HM2 move with the V15 receiver and retain their colors", () => {
  const samples = [
    ["food-bowl", "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTFdLFsxMSwyODUuNSwyNjQsMjAwLDAsWzJdLDBdXV0.3F00EDB4"],
    ["planter", "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTFdLFsxMCwyODUuNSwyNjQsMjAwLDAsWzJdLDBdXV0.1AB6F417"],
  ];
  for (const [id, code] of samples) {
    const restored = decodeConfigWithMigration(code);
    const item = restored.state.items.find(item => item.productId === id)!;
    assert.deepEqual([item.x, item.y, item.z, item.rotation], [280.5, 264, 200, 0]);
    assert.equal(Object.values(item.colors)[0], "red");
    assert.match(restored.messages.join(" "), /Steel V9/);
    assert.deepEqual(decodeConfig(encodeConfig(restored.state)), restored.state);
    const local = { ...restored.state, catalogVersion: 4, items: restored.state.items.map(entry => entry.id === item.id ? { ...entry, x: 285.5, colors: { [id === "food-bowl" ? "O01" : "G06"]: "lilac" } } : entry) };
    const before = JSON.stringify(local);
    const migrated = migrateAssembly(local).state;
    assert.equal(Object.values(migrated.items.find(entry => entry.productId === id)!.colors)[0], "lilac");
    assert.equal(JSON.stringify(local), before);
  }
  assert.deepEqual(getProduct("food-bowl").origin, [280.5, 264, 200]);
  assert.deepEqual(getProduct("food-bowl").collisionBoxes, [[241, 236, 200, 296, 296, 221]]);
});

const OLD_BASE_HAT_WITH_VILLA = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzMsMTYzLDU3LDExMCwwLFsyXSwtMV0sWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTFdXV0.E88D11C8";
const OLD_BASE_HAT_ONLY = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzMsMTM3LDIzNywxMTAsMixbMl0sLTFdXV0.0CBB3073";
const OLD_RIGHT_UPPER_HAT = "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTFdLFszLDEwNCwyMzksMjAwLDAsWzJdLDBdXV0.636FFC83";

test("old first-floor hats move to an existing free second floor, with an explicit migration message", () => {
  const result = decodeConfigWithMigration(OLD_BASE_HAT_WITH_VILLA);
  assert.equal(result.state.items.length, 2);
  const villa = result.state.items.find(item => item.productId === "villa")!;
  const hat = result.state.items.find(item => item.productId === "roof-cottage")!;
  assert.deepEqual([hat.x, hat.y, hat.z, hat.rotation, hat.parentId], [78, 239, 200, 0, villa.id]);
  assert.deepEqual(hat.colors, { G03: "red", "G03-window": "cream", "G03-trim": "cream" });
  assert.match(result.messages.join(" "), /旧一层.*二层/);
  assert.deepEqual(migrateAssembly(result.state).messages, []);
});

test("old right-offset upper hats resnap on the same parent while preserving local custom colors", () => {
  const result = decodeConfigWithMigration(OLD_RIGHT_UPPER_HAT);
  const hat = result.state.items.find(item => item.productId === "roof-cottage")!;
  assert.deepEqual([hat.x, hat.y, hat.z], [78, 239, 200]);
  assert.match(result.messages.join(" "), /原礼物盒二层最近/);
  for (const rotation of [0, 90, 180, 270] as const) {
    const target = getPlacements(createInitialState(), "villa", rotation)[0];
    const parent = tryPlace(createInitialState(), "villa", target, rotation);
    assert.equal(parent.ok, true);
    if (!parent.ok) continue;
    const [x, y, z] = transformPoint([104, 239, 200], getProduct("villa"), parent.item);
    const oldLocal = { ...parent.state, catalogVersion: 4, items: [...parent.state.items, { ...hat, id: "oldhat", x, y, z, rotation, parentId: parent.item.id, colors: { G03: "rose" } }] };
    const before = JSON.stringify(oldLocal);
    const restored = migrateAssembly(oldLocal);
    const migratedHat = restored.state.items.find(item => item.id === "oldhat")!;
    assert.deepEqual([migratedHat.x, migratedHat.y, migratedHat.z], transformPoint([78, 239, 200], getProduct("villa"), parent.item));
    assert.equal(migratedHat.rotation, rotation);
    assert.deepEqual(migratedHat.colors, { G03: "rose", "G03-window": "cream", "G03-trim": "cream" });
    assert.equal(JSON.stringify(oldLocal), before);
  }
});

test("hat migration refuses missing or occupied hosts without deleting, adding, or mutating saved components", () => {
  assert.throws(() => decodeConfig(OLD_BASE_HAT_ONLY), /无法兼容 Steel V9.*没有可用的二层/);
  const migrated = decodeConfig(OLD_BASE_HAT_WITH_VILLA);
  const villa = migrated.items.find(item => item.productId === "villa")!;
  const old = { ...migrated, catalogVersion: 4, items: [...migrated.items, { id: "base-hat", productId: "roof-cottage", x: 163, y: 57, z: 110, rotation: 0, parentId: "base", colors: { G03: "rose" } }] };
  const before = JSON.stringify(old);
  assert.throws(() => migrateAssembly(old), /无法兼容 Steel V9/);
  assert.equal(JSON.stringify(old), before);
  const invalid = { ...old, items: [villa, { ...old.items[2], x: 164 }] };
  assert.throws(() => migrateAssembly(invalid), /磁吸位/);
  const current = { ...old, catalogVersion: CATALOG_VERSION, items: [villa, old.items[2]] };
  assert.throws(() => migrateAssembly(current), /磁吸位/);
});

test("hat migration reserves a restricted upper host before moving a first-floor hat regardless of input order", () => {
  const first = place(success(addPlatform(createInitialState())), "villa", 150, 190);
  const second = tryPlace(first.state, "villa", { x: 490, y: 150, z: 110 }, 90);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const groundHat = { id: "ground-hat", productId: "roof-cottage", x: 163, y: 57, z: 110, rotation: 0, parentId: "base", colors: { G03: "rose" } };
  const upperHat = { id: "upper-hat", productId: "roof-cottage", x: 104, y: 239, z: 200, rotation: 0, parentId: first.item.id, colors: { G03: "sky" } };
  const codes: string[] = [];
  for (const hats of [[groundHat, upperHat], [upperHat, groundHat]]) {
    const old: unknown = { ...second.state, catalogVersion: 4, items: [...second.state.items, ...hats] };
    const before: string = JSON.stringify(old);
    const { state, messages } = migrateAssembly(old);
    assert.equal(state.items.length, 4);
    const ground = state.items.find(item => item.id === groundHat.id)!;
    const upper = state.items.find(item => item.id === upperHat.id)!;
    assert.deepEqual([upper.x, upper.y, upper.z, upper.parentId], [78, 239, 200, first.item.id]);
    assert.deepEqual([ground.x, ground.y, ground.z, ground.parentId], [441, 78, 200, second.item.id]);
    assert.deepEqual(upper.colors, { ...getDefaultColors("roof-cottage"), ...upperHat.colors });
    assert.deepEqual(ground.colors, { ...getDefaultColors("roof-cottage"), ...groundHat.colors });
    assert.match(messages.join(" "), /旧一层.*二层/);
    assert.equal(JSON.stringify(old), before);
    codes.push(encodeConfig(state));
  }
  assert.equal(codes[0], codes[1]);
});

test("palette adds three woods and retires marble while keeping every serialized color index", () => {
  assert.deepEqual(COLORS.slice(0, 11).map(color => color.id), ["cream", "pine", "red", "butter", "sage", "rose", "sky", "lilac", "white", "marble", "jade"]);
  assert.deepEqual(AVAILABLE_COLORS.map(color => color.id), ["cream", "pine", "red", "butter", "rose", "sky", "white", "jade", "peachwood", "wood", "darkwood", "black", "gray"]);
  assert.equal(AVAILABLE_COLORS.find(color => color.id === "cream")?.name, "杏色");
  assert.equal(AVAILABLE_COLORS.find(color => color.id === "jade")?.name, "琉璃绿");
  assert.deepEqual(COLORS.slice(8, 11).map(color => color.hex), ["#FAFAF7", "#E2E2DE", "#299C82"]);
  const previous = decodeConfig(LEGACY_CATALOG_2_CODE);
  assert.equal(previous.baseColors.P01, "lilac");
  assert.equal(previous.items.find(item => item.productId === "villa")?.colors.A01, "sage");
});

test("P01 and H06 receiver provenance remains exact on every platform and H06 disappears with the pool", () => {
  assert.equal(P01_TOP_XY.length, 32);
  assert.equal(H06_TOP_XY.length, 4);
  assert.equal(new Set([...P01_TOP_XY, ...H06_TOP_XY].map(point => point.join(","))).size, 36);
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  for (const platform of getPlatforms(state)) {
    const markers = getMagnetPoints(state).filter(point => point.parentId === platform.id);
    assert.equal(markers.filter(point => point.sourcePart === "P01").length, 32);
    assert.equal(markers.filter(point => point.sourcePart === "H06").length, 4);
    assert.deepEqual(markers.filter(point => point.sourcePart === "H06").map(point => point.point), H06_TOP_XY.map(([x, y]) => [x + platform.x, y, 110]));
  }
  state = success(setPlatformPool(state, "base3", true));
  assert.equal(getMagnetPoints(state).filter(point => point.parentId === "base3").length, 32);
  assert.equal(getMagnetPoints(state).filter(point => point.parentId === "base3" && point.sourcePart === "H06").length, 0);
});

test("thirty-centimeter legs use complete Y parts and prices on all three platforms", () => {
  const initial = createInitialState();
  const tall = success(setLegHeight(initial, 300));
  assert.deepEqual(getBaseParts(300).filter(part => /^Y/.test(part.id)).map(part => part.id), ["Y01", "Y02", "Y03", "Y04"]);
  assert.equal(getTotalPrice(tall) - getTotalPrice(initial), 400);
  const triple = success(addPlatform(success(addPlatform(tall))));
  const lines = getOrderLines(triple);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line.sku, /-300$/);
    assert.equal(line.parts.filter(id => /^Y0/.test(id)).length, 4);
    assert.equal(line.colors.legs, "pine");
    assert.ok(!Object.keys(line.colors).some(id => /^Y0/.test(id)));
  }
  assert.equal(getTotalPrice(triple), 3 * getTotalPrice(tall));
});

test("deeper bedding raises only shorter existing legs and never shortens legs or adds missing legs", () => {
  for (const legHeight of [0, 100, 200, 300] as const) {
    const initial = success(setLegHeight(createInitialState(), legHeight));
    for (const depth of [100, 200, 300] as const) {
      const thick = success(setBedding(initial, { mode: "thick", depth }));
      const expectedHeight = legHeight === 0 ? 0 : Math.max(legHeight, depth);
      assert.equal(thick.legHeight, expectedHeight);
      assert.equal(getDisplayElevation(thick), (expectedHeight || depth) - 100);
      for (const nextHeight of [0, 100, 200, 300] as const) {
        const changedLegs = success(setLegHeight(thick, nextHeight));
        assert.deepEqual(changedLegs.bedding, { mode: "thick", depth });
        assert.equal(getDisplayElevation(changedLegs), (nextHeight || depth) - 100);
      }
      const thin = success(setBedding(thick, { mode: "thin", depth: 50 }));
      assert.equal(thin.legHeight, expectedHeight);
      assert.equal(getDisplayElevation(thin), (expectedHeight || 50) - 100);
    }
  }
});

test("thirty-centimeter legs with twenty-centimeter bedding preserve clearance and merchandise", () => {
  let state = success(setLegHeight(createInitialState(), 300));
  const parts = getOrderLines(state), price = getTotalPrice(state);
  state = success(setBedding(state, { mode: "thick", depth: 200 }));
  assert.equal(state.legHeight, 300);
  assert.deepEqual(state.bedding, { mode: "thick", depth: 200 });
  assert.equal(getDisplayElevation(state), 200);
  assert.deepEqual(getOrderLines(state), parts);
  assert.equal(getTotalPrice(state), price);
  state = success(setLegHeight(state, 100));
  assert.deepEqual(state.bedding, { mode: "thick", depth: 200 });
  assert.equal(getDisplayElevation(state), 0);
  assert.equal(validateAssembly(state).legHeight, 100);
});

test("legless platforms rest on the selected bedding and invalid bedding is still rejected", () => {
  let state = createInitialState();
  assert.deepEqual(state.bedding, { mode: "thin", depth: 50 });
  assert.equal(getDisplayElevation(state), 0);
  state = success(setLegHeight(state, 0));
  state = success(setBedding(state, { mode: "thick", depth: 300 }));
  assert.equal(state.legHeight, 0);
  assert.equal(getDisplayElevation(state), 200);
  state = success(setBedding(state, { mode: "thin", depth: 50 }));
  assert.equal(state.legHeight, 0);
  assert.equal(getDisplayElevation(state), -50);
  state = success(setLegHeight(state, 300));
  state = success(setBedding(state, { mode: "thin", depth: 50 }));
  assert.equal(state.legHeight, 300);
  assert.throws(() => validateAssembly({ ...state, bedding: { mode: "thick", depth: 50 } }), /垫料/);
  assert.throws(() => validateAssembly({ ...state, bedding: { mode: "thin", depth: 100 } }), /垫料/);
});

test("equal-height HM3 and local saves remain compatible after height controls become independent", () => {
  // Frozen from the previous coupled-height implementation, before the controls were separated.
  const oldCode = "HM3.WzMsNiwzMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFsxLDMwMF0sbnVsbF0.323C1BFF";
  const previous = decodeConfig(oldCode);
  assert.equal(previous.legHeight, 300);
  assert.deepEqual(previous.bedding, { mode: "thick", depth: 300 });
  assert.deepEqual(decodeConfig(encodeConfig(previous)), previous);
  assert.notEqual(encodeConfig(previous), oldCode, "catalog version advances while the saved design stays intact");
  const localSave = JSON.parse(JSON.stringify(previous));
  const restored = migrateAssembly(localSave);
  assert.deepEqual(restored.state, previous);
  assert.deepEqual(restored.messages, []);
  const changed = success(setBedding(restored.state, { mode: "thick", depth: 200 }));
  assert.equal(changed.legHeight, 300);
  assert.deepEqual(localSave.bedding, { mode: "thick", depth: 300 });
});

test("hamster variants are saved in the code and never add merchandise or change assembly geometry", () => {
  const state = createInitialState(), price = getTotalPrice(state), parts = getOrderLines(state);
  assert.equal(state.hamster, null);
  for (const variant of HAMSTER_VARIANTS) {
    const selected = success(setHamster(state, variant.id));
    assert.equal(decodeConfig(encodeConfig(selected)).hamster, variant.id);
    assert.equal(getTotalPrice(selected), price);
    assert.deepEqual(getOrderLines(selected), parts);
    assert.notEqual(encodeConfig(selected), encodeConfig(state));
  }
  assert.equal(setHamster(state, "not-a-hamster").ok, false);
  assert.throws(() => validateAssembly({ ...state, hamster: 5 }), /仓鼠/);
});

test("HM3 round-trips third-platform state, long legs, bedding, hamster and independent new colors", () => {
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  state = success(setLegHeight(state, 300));
  state = success(setBedding(state, { mode: "thick", depth: 200 }));
  state = success(setHamster(state, HAMSTER_VARIANTS[0].id));
  state = success(setPlatformColors(state, "base2", { ...state.extension!.baseColors, P01: "marble" }));
  state = success(setPlatformColors(state, "base3", { ...state.thirdPlatform!.baseColors, P01: "white", legs: "jade", B01: "rose" }));
  state = success(setCoverRemoved(state, "base3", "H05", true));
  state = success(setPlatformPool(state, "base3", true));
  const villa = place(state, "villa", 750, 190);
  state = place(villa.state, "roof-cottage", 678, 239, 200).state;
  const code = encodeConfig(state), restored = decodeConfig(code);
  assert.match(code, /^HM3\./);
  assert.equal(encodeConfig(restored), code);
  assert.equal(restored.legHeight, 300);
  assert.deepEqual(restored.bedding, { mode: "thick", depth: 200 });
  assert.equal(restored.hamster, HAMSTER_VARIANTS[0].id);
  assert.equal(restored.thirdPlatform?.baseColors.legs, "jade");
  assert.equal(restored.thirdPlatform?.baseInsert, "pool");
  assert.deepEqual(restored.thirdPlatform?.removedCovers, ["H05"]);
  assert.equal(restored.items.find(item => item.productId === "villa")?.parentId, "base3");
  const renamed = { ...state, items: state.items.map(item => ({ ...item, id: `z-${item.id}`, parentId: ["base", "base2", "base3"].includes(item.parentId) ? item.parentId : `z-${item.parentId}` })).reverse() };
  assert.equal(encodeConfig(renamed), code);
  assert.throws(() => validateAssembly({ ...state, extension: null }), /第三个/);
  assert.throws(() => validateAssembly({ ...state, thirdPlatform: { ...state.thirdPlatform, direction: "left" } }), /第三个/);
  assert.throws(() => validateAssembly({ ...state, items: [{ ...state.items[0], id: "base3" }] }), /编号/);
});

test("removing the first platform shifts later platforms, properties and descendants without losing colors", () => {
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  state = success(setPlatformColors(state, "base2", { ...state.extension!.baseColors, P01: "jade" }));
  state = success(setCoverRemoved(state, "base2", "H03", true));
  state = place(state, "cube-house", 350, 50).state;
  const removed = success(removePlatform(state, "base"));
  assert.equal(removed.baseColors.P01, "jade");
  assert.deepEqual(removed.removedCovers, ["H03"]);
  assert.equal(removed.items[0].parentId, "base");
  assert.deepEqual([removed.items[0].x, removed.items[0].y], [50, 50]);
  assert.equal(removed.thirdPlatform, null);
  assert.equal(removePlatform(createInitialState(), "base").ok, false);
});

const OLD_DIRECTION_CODES = [
  "HM2.WzIsNSwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sWzAsMCxbMCwxLDAsMCwwLDAsMCwwLDBdLFtdXSxbWzAsLTE1MCwxOTAsMTEwLDAsWzEsMCwyLDEsMSwxLDAsMCwzLDNdLC0yXSxbMywtMjIyLDIzOSwyMDAsMCxbMl0sMF1dXQ.5E142F07",
  "HM2.WzIsNSwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sWzIsMCxbMCwxLDAsMCwwLDAsMCwwLDBdLFtdXSxbWzAsMTUwLC0xMTAsMTEwLDAsWzEsMCwyLDEsMSwxLDAsMCwzLDNdLC0yXSxbMyw3OCwtNjEsMjAwLDAsWzJdLDBdXV0.15BDD589",
  "HM2.WzIsNSwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sWzMsMCxbMCwxLDAsMCwwLDAsMCwwLDBdLFtdXSxbWzAsMTUwLDQ5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTJdLFszLDc4LDUzOSwyMDAsMCxbMl0sMF1dXQ.FED47E31",
  "HM2.WzIsNSwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sWzEsMCxbMCwxLDAsMCwwLDAsMCwwLDBdLFtdXSxbWzAsNDUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDMsM10sLTJdLFszLDM3OCwyMzksMjAwLDAsWzJdLDBdXV0.46703915",
];

test("all frozen legacy platform directions migrate to one rightward layout with descendants and original codes intact", () => {
  const updated: string[] = [];
  for (const [index, code] of OLD_DIRECTION_CODES.entries()) {
    const { state, messages } = decodeConfigWithMigration(code);
    assert.equal(state.extension?.direction, "right");
    assert.equal(state.thirdPlatform, null);
    assert.deepEqual(state.bedding, { mode: "thin", depth: 50 });
    assert.equal(state.hamster, null);
    const villa = state.items.find(item => item.productId === "villa")!, hat = state.items.find(item => item.productId === "roof-cottage")!;
    assert.deepEqual([villa.x, villa.y, hat.x, hat.y], [450, 190, 378, 239]);
    if (index < 3) assert.match(messages.join(" "), /向右贴合.*随动/);
    updated.push(encodeConfig(state));
  }
  assert.equal(new Set(updated).size, 1);
});

test("legacy platform reflow collision refuses migration and preserves the original local data", () => {
  const first = place(createInitialState(), "villa", 150, 190);
  const raw = { ...first.state, catalogVersion: 5, extension: { direction: "back", baseInsert: "lid", baseColors: first.state.baseColors, removedCovers: [] }, items: [...first.state.items, { ...first.item, id: "second-villa", y: 490, parentId: "base2" }] };
  const before = JSON.stringify(raw);
  assert.throws(() => migrateAssembly(raw), /旧平台布局无法兼容.*原存档已保留/);
  assert.equal(JSON.stringify(raw), before);
});

test("single-magnet accessories can use every real platform point while permitting edge overhang", () => {
  for (const id of ["planter", "food-bowl"]) {
    const initial = createInitialState();
    const receivers = getMagnetPoints(initial).map(marker => marker.point.join(","));
    const available = new Set<string>();
    for (const rotation of [0, 90, 180, 270] as const) {
      const positions = getPlacements(initial, id, rotation);
      assert.equal(positions.length, 36);
      assert.ok(positions.every(position => position.magnetCount === 1));
      for (const position of positions) available.add([position.x, position.y, position.z].join(","));
      assert.equal(tryPlace(initial, id, positions[0], rotation).ok, true);
    }
    assert.deepEqual([...available].sort(), receivers.sort());
    const house = place(initial, "l-house", 100, 100);
    for (const rotation of [0, 90, 180, 270] as const) assert.equal(getPlacements(house.state, id, rotation).filter(position => position.parentId === house.item.id).length, 4);
    const withoutCover = success(setCoverRemoved(initial, "base", "H01", true));
    assert.equal(getPlacements(withoutCover, id).length, 36, "small covers contain no receiver, so removing one does not erase a supported magnetic anchor");
    const closed = getPlacements(initial, id).find(position => position.x === 90 && position.y === 210)!;
    const occupied = tryPlace(initial, id, closed);
    assert.equal(occupied.ok, true);
    if (occupied.ok) {
      assert.equal(setCoverRemoved(occupied.state, "base", "H01", true).ok, true);
      const sameAnchor = getPlacements(occupied.state, id).find(position => position.x === 90 && position.y === 210);
      assert.equal(sameAnchor, undefined);
      assert.throws(() => validateAssembly({ ...occupied.state, items: [{ ...occupied.item, x: 50, y: 250 }] }), /磁吸位/);
    }
    const pool = success(setPlatformPool(initial, "base", true));
    assert.ok(getPlacements(pool, id).every(position => !(position.x === 90 && position.y === 90)));
  }
});

test("all three empty platforms expose the same villa placements and four family rotations", () => {
  const empty = success(addPlatform(success(addPlatform(createInitialState()))));
  const villaProduct = getProduct("villa");
  for (const platform of getPlatforms(empty)) {
    for (const rotation of [0, 90, 180, 270] as const) {
      const local = getPlacements(empty, "villa", rotation).filter(position => position.parentId === platform.id)
        .map(position => [position.x - platform.x, position.y, position.z, position.magnetCount]);
      const first = getPlacements(empty, "villa", rotation).filter(position => position.parentId === "base")
        .map(position => [position.x, position.y, position.z, position.magnetCount]);
      assert.deepEqual(local, first, `${platform.id} must only translate the same source receivers`);
      assert.equal(local.length, 2);
    }
    const villa = place(empty, "villa", platform.x + 150, 190);
    const hat = place(villa.state, "roof-cottage", platform.x + 78, 239, 200);
    const bowl = place(hat.state, "food-bowl", platform.x + 280.5, 264, 200);
    let state = bowl.state;
    const initialColors = Object.fromEntries(state.items.map(item => [item.id, item.colors]));
    for (const rotation of [90, 180, 270, 0] as const) {
      const turned = rotateItem(state, villa.item.id);
      assert.equal(turned.ok, true, `${platform.id} → ${rotation}°: ${turned.ok ? "" : turned.reason}`);
      if (!turned.ok) continue;
      state = turned.state;
      assert.equal(turned.item.rotation, rotation);
      assert.equal(turned.item.parentId, platform.id);
      for (const [id, sourcePoint] of [[hat.item.id, [78, 239, 200]], [bowl.item.id, [280.5, 264, 200]]] as const) {
        const child = state.items.find(item => item.id === id)!;
        assert.deepEqual([child.x, child.y, child.z], transformPoint([...sourcePoint], villaProduct, turned.item));
        assert.equal(child.rotation, rotation);
        assert.equal(child.parentId, villa.item.id);
      }
      for (const item of state.items) assert.deepEqual(item.colors, initialColors[item.id]);
      assert.deepEqual(validateAssembly(state), state);
    }
  }
});

test("V15 neighboring villas retain stair clearance and permit the formerly overlapping deck direction", () => {
  const two = success(addPlatform(createInitialState()));
  const first = place(two, "villa", 150, 190);
  const second = tryPlace(first.state, "villa", { x: 490, y: 150, z: 110 }, 90);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const rotated = rotateItem(second.state, second.item.id);
  assert.equal(rotated.ok, true, rotated.ok ? "" : rotated.reason);
  if (!rotated.ok) return;
  assert.deepEqual([rotated.item.x, rotated.item.y, rotated.item.rotation], [450, 110, 180]);
  assert.deepEqual(rotated.state.items.find(item => item.id === first.item.id), first.item);
  assert.deepEqual(getPlacements(second.state, "villa", 180, second.item.id).filter(position => position.parentId === "base2")
    .map(position => [position.x, position.y]), [[450, 110], [450, 190]]);
  const sameFacing = rotateItem(rotated.state, rotated.item.id, 180);
  assert.equal(sameFacing.ok, true, sameFacing.ok ? "" : sameFacing.reason);
  if (sameFacing.ok) assert.deepEqual(sameFacing.state.items.map(item => item.rotation), [0, 0]);
  // Physical collision within one platform is still rejected.
  const collided = tryPlace(first.state, "villa", { x: 150, y: 110, z: 110 }, 0);
  assert.equal(collided.ok, false);
  assert.equal(collided.state, first.state);
});

test("three populated platforms support every family turning through all four physically free directions", () => {
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  for (const platform of getPlatforms(state)) {
    const position = getPlacements(state, "villa", 270).find(candidate => candidate.parentId === platform.id)!;
    const villa = tryPlace(state, "villa", position, 270);
    assert.equal(villa.ok, true);
    if (!villa.ok) return;
    const hatPosition = getPlacements(villa.state, "roof-cottage", 270).find(candidate => candidate.parentId === villa.item.id)!;
    const hat = tryPlace(villa.state, "roof-cottage", hatPosition, 270);
    assert.equal(hat.ok, true);
    if (!hat.ok) return;
    state = hat.state;
  }
  assert.equal(state.items.length, 6);
  for (const villa of state.items.filter(item => item.productId === "villa")) {
    let turnedState = state;
    const unchangedNeighbors = state.items.filter(item => item.id !== villa.id && item.parentId !== villa.id);
    for (const rotation of [0, 90, 180, 270] as const) {
      const result = rotateItem(turnedState, villa.id);
      assert.equal(result.ok, true, `${villa.parentId} → ${rotation}°: ${result.ok ? "" : result.reason}`);
      if (!result.ok) return;
      turnedState = result.state;
      assert.equal(result.item.rotation, rotation);
      assert.equal(result.item.parentId, villa.parentId);
      const hat = turnedState.items.find(item => item.parentId === villa.id)!;
      assert.equal(hat.rotation, rotation);
      assert.deepEqual([hat.x, hat.y, hat.z], transformPoint([78, 239, 200], getProduct("villa"), result.item));
      assert.deepEqual(turnedState.items.filter(item => item.id !== villa.id && item.parentId !== villa.id), unchangedNeighbors);
      assert.deepEqual(validateAssembly(turnedState), turnedState);
      assert.equal(encodeConfig(decodeConfig(encodeConfig(turnedState))), encodeConfig(turnedState));
    }
  }
});

test("the three-platform screenshot layout now auto-places all villas in the same direction and rotates every family", () => {
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  for (const platform of getPlatforms(state)) {
    const villa = autoPlace(state, "villa", platform.id);
    assert.equal(villa.ok, true);
    if (!villa.ok || !villa.item) return;
    const hatPosition = getPlacements(villa.state, "roof-cottage", villa.item.rotation).find(candidate => candidate.parentId === villa.item!.id)!;
    const hat = tryPlace(villa.state, "roof-cottage", hatPosition, villa.item.rotation);
    assert.equal(hat.ok, true);
    if (!hat.ok) return;
    state = hat.state;
  }
  const villas = state.items.filter(item => item.productId === "villa");
  assert.deepEqual(villas.map(item => [item.parentId, item.x, item.y, item.rotation]), [
    ["base", 150, 190, 0], ["base2", 450, 190, 0], ["base3", 750, 190, 0],
  ]);
  for (const villa of villas) {
    const neighbors = state.items.filter(item => item.id !== villa.id && item.parentId !== villa.id);
    for (const rotation of [90, 180, 270, 0] as const) {
      const result = rotateItem(state, villa.id);
      assert.equal(result.ok, true, `${villa.parentId} → ${rotation}°: ${result.ok ? "" : result.reason}`);
      if (!result.ok) return;
      state = result.state;
      assert.equal(result.item.rotation, rotation);
      const hat = state.items.find(item => item.parentId === villa.id)!;
      assert.equal(hat.rotation, rotation);
      assert.deepEqual([hat.x, hat.y, hat.z], transformPoint([78, 239, 200], getProduct("villa"), result.item));
      assert.deepEqual(state.items.filter(item => item.id !== villa.id && item.parentId !== villa.id), neighbors);
      assert.deepEqual(validateAssembly(state), state);
    }
  }
});

test("raising bedding upgrades each platform's legs in the order while preserving imported shorter-leg saves", () => {
  let state = success(addPlatform(success(addPlatform(createInitialState()))));
  const raised = success(setBedding(state, { mode: "thick", depth: 300 }));
  assert.equal(raised.legHeight, 300);
  assert.equal(getOrderLines(raised).filter(line => line.parts.includes("Y01")).length, 3);
  assert.equal(decodeConfig(encodeConfig(raised)).legHeight, 300);
  state = success(setLegHeight(raised, 100));
  const restored = decodeConfig(encodeConfig(state));
  assert.equal(restored.legHeight, 100, "legacy or explicitly selected shorter legs are not rewritten on import");
  assert.deepEqual(restored.bedding, { mode: "thick", depth: 300 });
  assert.equal(success(setBedding(restored, { mode: "thick", depth: 200 })).legHeight, 200);
});
