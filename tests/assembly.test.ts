import test from "node:test";
import modelIndex from "../src/data/model-index.json";
import assert from "node:assert/strict";
import {
  CATALOG_VERSION,
  COLORS,
  PRODUCTS,
  PRIMARY_COLOR_KEYS,
  SOURCE_TRIM_COLORS,
  getBaseParts,
  getProduct,
} from "../src/data/catalog";
import {
  changeBaseInsert,
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
} from "../src/lib/assembly";
import type { AssemblyItem, AssemblyState } from "../src/lib/assembly";
import { decodeConfig, decodeConfigWithMigration, encodeConfig } from "../src/lib/config-code";

/** Frozen before V4 changes using the actual catalog-2 encoder (custom colors + reversed loft). */
const LEGACY_CATALOG_2_CODE = "HM1.WzEsMiwyMDAsMCxbNywxLDAsMCwwLDAsMCwwLDBdLFtbMCwxNTAsMTkwLDExMCwwLFs0LDYsNSwzXSwtMV0sWzMsNzgsMjM5LDIwMCwyLFsyXSwwXV1d.4AF01816";
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

test("catalog covers all 42 V4 source groups and 48 color bodies across bundles and base alternatives", () => {
  const ids = new Set([
    ...PRODUCTS.flatMap((p) => p.parts.map((part) => part.id)),
    ...getBaseParts(100).map((p) => p.id),
    ...getBaseParts(200, true).map((p) => p.id),
  ]);
  assert.equal(ids.size, 42);
  assert.equal(Object.keys(modelIndex).length, 42);
  assert.equal(Object.values(modelIndex).reduce((total, model) => total + model.components.length, 0), 48);
  assert.equal(CATALOG_VERSION, 3);
  assert.equal(COLORS.length, 8);
  for (const p of PRODUCTS) assert.ok(p.bottomMagnets.length > 0);
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
  assert.equal(getTotalPrice(tall) - getTotalPrice(state), 2400);
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
test("loft and planter require matching villa interfaces; planter cannot rotate into fence", () => {
  assert.equal(getPlacements(createInitialState(), "roof-cottage").length, 0);
  assert.equal(getPlacements(createInitialState(), "planter").length, 0);
  const villa = place(createInitialState(), "villa", 150, 190);
  const loft = place(villa.state, "roof-cottage", 78, 239, 200);
  const planter = place(loft.state, "planter", 285.5, 264, 200);
  assert.equal(planter.item.parentId, villa.item.id);
  assert.equal(getPlacements(loft.state, "planter", 180).length, 0);
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
  assert.match(code, /^HM1\.[A-Za-z0-9_-]+\.[A-F0-9]{8}$/);
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
  assert.throws(() => decodeConfig(code.replace("HM1.", "HM2.")), /版本/);
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
  const pool = getOrderLines({ ...initial, baseInsert: "pool" })[0];
  assert.ok("B01" in pool.colors);
  assert.ok(!("H06" in pool.colors));
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
    { G03: "pine" },
  );
  const rotated = rotateItem(changed, villa.item.id, 180);
  assert.equal(rotated.ok, true, rotated.ok ? "" : rotated.reason);
  if (rotated.ok) {
    const child = rotated.state.items.find((i) => i.id === cottage.item.id)!;
    assert.deepEqual(
      [child.x, child.y, child.z, child.rotation],
      [222, 141, 200, 180],
    );
    assert.deepEqual(child.colors, { G03: "pine" });
  }
});

test("all original model colors exist and every component defaults to its exact source color", () => {
  assert.equal(COLORS.length, 8);
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
          : SOURCE_TRIM_COLORS[component.colorKey];
      assert.equal(
        COLORS.find((c) => c.id === colorId)?.hex.toUpperCase(),
        component.color.toUpperCase(),
        part.id + ":" + component.colorKey,
      );
    }
  }
  assert.equal(createInitialState().baseColors.legs, "pine");
  assert.equal(createInitialState().baseColors.B01, "cream");
});


test("V4 original palette is unchanged and the eight-piece villa keeps exact defaults", () => {
  assert.deepEqual(COLORS.slice(0, 4).map(color => color.hex), ["#F1EADB", "#174A3A", "#B8273C", "#C99B46"]);
  assert.deepEqual(getProduct("villa").parts.map(part => [part.id, part.defaultColor]), [
    ["A01", "pine"], ["A02", "cream"], ["G05", "red"], ["G15", "pine"],
    ["G16", "pine"], ["G17", "pine"], ["W01", "cream"], ["W02", "cream"],
  ]);
  assert.deepEqual(getProduct("villa").collisionBoxes[0], [-5, 178.2, 110, 305, 300, 238]);
});
test("cottage follows the villa safe direction at all four parent orientations", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    const initial = createInitialState();
    const target = getPlacements(initial, "villa", rotation)[0];
    assert.ok(target, `villa ${rotation}`);
    const parent = tryPlace(initial, "villa", target, rotation);
    assert.equal(parent.ok, true);
    if (!parent.ok) continue;
    const safe = getPlacements(parent.state, "roof-cottage", rotation);
    assert.equal(safe.length, 1);
    assert.deepEqual([safe[0].x, safe[0].y, safe[0].z], transformPoint(getProduct("roof-cottage").origin, getProduct("villa"), parent.item));
    const cottage = tryPlace(parent.state, "roof-cottage", safe[0], rotation);
    assert.equal(cottage.ok, true);
    assert.equal(getPlacements(parent.state, "roof-cottage", ((rotation + 180) % 360) as AssemblyItem["rotation"]).length, 0);
    if (cottage.ok) assert.equal(cottage.item.parentId, parent.item.id);
  }
});
function assertLegacyUpgrade(state: AssemblyState) {
  assert.equal(state.catalogVersion, 3);
  assert.equal(state.legHeight, 200);
  assert.equal(state.baseColors.P01, "lilac");
  assert.equal(state.items.length, 2);
  const villa = state.items.find(item => item.productId === "villa")!;
  const cottage = state.items.find(item => item.productId === "roof-cottage")!;
  assert.deepEqual(villa.colors, { A01: "sage", A02: "sky", G05: "rose", G15: "butter", G16: "butter", G17: "butter", W01: "sky", W02: "sky" });
  assert.deepEqual([cottage.x, cottage.y, cottage.z, cottage.rotation], [78, 239, 200, 0]);
  assert.deepEqual(cottage.colors, { G03: "red" });
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
  assert.throws(() => migrateAssembly({ ...valid, catalogVersion: 4 }), /版本/);
});
test("legacy migration only repairs the documented 180-degree loft, never malformed positions or 90-degree lofts", () => {
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, items: LEGACY_LOCAL_STATE.items.map(item => item.productId === "roof-cottage" ? { ...item, rotation: 90 } : item) }), /磁吸位/);
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, items: LEGACY_LOCAL_STATE.items.map(item => item.productId === "roof-cottage" ? { ...item, x: item.x + 5 } : item) }), /磁吸位/);
  assert.throws(() => migrateAssembly({ ...LEGACY_LOCAL_STATE, catalogVersion: 3 }), /颜色不完整/);
  const { catalogVersion: _catalogVersion, ...oldEmpty } = createInitialState();
  assert.deepEqual(migrateAssembly(oldEmpty).messages, []);
  assert.equal(migrateAssembly(oldEmpty).state.catalogVersion, 3);
});

test("catalog-3 code with a valid checksum still rejects an unsafe reversed loft", () => {
  // Independent Python zlib CRC32 over a deliberately invalid current-schema payload.
  const invalidCurrentCode = "HM1.WzEsMywyMDAsMCxbNywxLDAsMCwwLDAsMCwwLDBdLFtbMCwxNTAsMTkwLDExMCwwLFs0LDYsNSwzLDMsMyw2LDZdLC0xXSxbMyw3OCwyMzksMjAwLDIsWzJdLDBdXV0.90935166";
  assert.throws(() => decodeConfigWithMigration(invalidCurrentCode), /磁吸位/);
  assert.throws(() => decodeConfig(invalidCurrentCode), /磁吸位/);
});
