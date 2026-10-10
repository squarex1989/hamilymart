import test from "node:test";
import modelIndex from "../src/data/model-index.json";
import assert from "node:assert/strict";
import {
  COLORS,
  PRODUCTS,
  PRIMARY_COLOR_KEYS,
  SOURCE_TRIM_COLORS,
  getBaseParts,
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
} from "../src/lib/assembly";
import type { AssemblyItem, AssemblyState } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";

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

test("catalog covers all 38 source groups across bundles and base alternatives", () => {
  const ids = new Set([
    ...PRODUCTS.flatMap((p) => p.parts.map((part) => part.id)),
    ...getBaseParts(100).map((p) => p.id),
    ...getBaseParts(200, true).map((p) => p.id),
  ]);
  assert.equal(ids.size, 38);
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
    "G15",
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

test("180 degree loft rotation is available even though its 90 degree orientation cannot attach", () => {
  const villa = place(createInitialState(), "villa", 150, 190);
  const cottage = place(villa.state, "roof-cottage", 78, 239, 200);
  assert.equal(rotateItem(cottage.state, cottage.item.id, 90).ok, false);
  const turned = rotateItem(cottage.state, cottage.item.id, 180);
  assert.equal(turned.ok, true);
  if (turned.ok) assert.equal(turned.item.rotation, 180);
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
