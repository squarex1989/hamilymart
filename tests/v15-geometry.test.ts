import test from "node:test";
import assert from "node:assert/strict";
import fixtures from "./fixtures/catalog-6-v15-migration.json";
import modelIndex from "../src/data/model-index.json";
import { CATALOG_VERSION, getProduct } from "../src/data/catalog";
import { decodeConfig, decodeConfigWithMigration, encodeConfig } from "../src/lib/config-code";
import { createInitialState, getMagnetPoints, getPlacements, migrateAssembly, rotateVector, transformPoint, tryPlace, validateAssembly } from "../src/lib/assembly";
import type { AssemblyItem, AssemblyState } from "../src/lib/assembly";

// Captured with the real catalog-6 encoder before touching any V15 coordinate.
// Every sample contains three platforms, hats, both upper accessories, both
// base accessories, custom part colors, a removed cover and 30/20 cm heights.
test("frozen HM3 and local catalog-6 designs migrate every orientation without losing IDs, colors or base positions", () => {
  for (const fixture of fixtures) {
    const before = JSON.stringify(fixture.state);
    const local = migrateAssembly(fixture.state);
    const shared = decodeConfigWithMigration(fixture.code);
    assert.equal(local.state.catalogVersion, CATALOG_VERSION);
    assert.equal(local.state.items.length, fixture.state.items.length);
    assert.equal(local.state.legHeight, 300);
    assert.deepEqual(local.state.bedding, { mode: "thick", depth: 200 });
    assert.deepEqual(local.state.baseColors, fixture.state.baseColors);
    assert.deepEqual(local.state.extension, fixture.state.extension);
    assert.deepEqual(local.state.thirdPlatform, fixture.state.thirdPlatform);
    assert.match(local.messages.join(" "), /30 厘米.*5 毫米/);
    for (const old of fixture.state.items) {
      const updated = local.state.items.find(item => item.id === old.id)!;
      const oldParent = fixture.state.items.find(parent => parent.id === old.parentId);
      const moves = ["planter", "food-bowl"].includes(old.productId) && oldParent?.productId === "villa";
      const [dx, dy] = moves ? rotateVector([-5, 0, 0], oldParent.rotation as AssemblyItem["rotation"]) : [0, 0];
      assert.deepEqual(updated, { ...old, x: old.x + dx, y: old.y + dy });
      const contacts = getProduct(updated.productId).bottomMagnets.map(point => transformPoint(point, getProduct(updated.productId), updated));
      const receivers = getMagnetPoints(local.state).filter(point => point.parentId === updated.parentId).map(point => point.point);
      assert.ok(contacts.filter(contact => receivers.some(point => point.every((value, index) => Math.abs(value - contact[index]) < 0.015))).length >= (getProduct(updated.productId).minimumMagnetMatches ?? 2));
    }
    assert.equal(encodeConfig(shared.state), encodeConfig(local.state));
    const code = encodeConfig(local.state);
    assert.notEqual(code, fixture.code);
    assert.equal(encodeConfig(decodeConfig(code)), code);
    assert.deepEqual(decodeConfigWithMigration(code).messages, []);
    assert.deepEqual(migrateAssembly(local.state).messages, []);
    assert.equal(JSON.stringify(fixture.state), before, "never rewrite the original stored design");
  }
});

test("V15 source bounds stay within the 300 mm deck and source contacts match the inward moved accessories", () => {
  assert.deepEqual(modelIndex.A02.bounds, [0, 180, 182, 300, 300, 200]);
  for (const part of ["A02", "G15", "G16", "G17", "G03", "G06", "O01"] as const) {
    assert.ok(modelIndex[part].bounds[0] >= 0, `${part} crosses the deck's left edge`);
    assert.ok(modelIndex[part].bounds[3] <= 300, `${part} crosses the deck's right edge`);
  }
  assert.deepEqual(getProduct("roof-cottage").origin, [78, 239, 200], "the hat's stable virtual pivot preserves saved transforms");
  const surfaces = getProduct("villa").surfaces!;
  assert.deepEqual(surfaces.find(surface => surface.id === "cottage")!.points, getProduct("roof-cottage").bottomMagnets);
  for (const id of ["planter", "food-bowl"]) {
    assert.deepEqual(getProduct(id).origin, [280.5, 264, 200]);
    assert.deepEqual(getProduct(id).bottomMagnets, surfaces.find(surface => surface.id === "planter")!.points);
  }
});

test("catalog-6 imports are validated against the old physical deck before upgrade", () => {
  const old = fixtures[0].state;
  const family3 = old.items.filter(item => item.parentId === "base3" || old.items.some(parent => parent.parentId === "base3" && parent.id === item.parentId));
  const invalid = {
    ...old,
    items: old.items.filter(item => item.parentId === "base" || old.items.some(parent => parent.parentId === "base" && parent.id === item.parentId))
      .concat(family3.map(item => ({ ...item, x: item.x - 300, parentId: item.parentId === "base3" ? "base2" : item.parentId }))),
  };
  const before = JSON.stringify(invalid);
  assert.throws(() => migrateAssembly(invalid), /磁吸位.*重叠/);
  assert.equal(JSON.stringify(invalid), before);
});

test("old single-contact accessories on L-house roofs keep their physical position in all rotations", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    for (const id of ["planter", "food-bowl"]) {
      const initial = createInitialState();
      const house = tryPlace(initial, "l-house", getPlacements(initial, "l-house", rotation)[0], rotation);
      assert.ok(house.ok);
      if (!house.ok) continue;
      const position = getPlacements(house.state, id, rotation).find(candidate => candidate.parentId === house.item.id)!;
      assert.ok(position);
      const accessory = tryPlace(house.state, id, position, rotation);
      assert.ok(accessory.ok);
      if (!accessory.ok) continue;
      const previous = { ...accessory.state, catalogVersion: 6 };
      const migrated = migrateAssembly(previous).state;
      assert.deepEqual(migrated.items, accessory.state.items);
      assert.deepEqual(migrated.items.find(item => item.id === accessory.item.id), accessory.item);
    }
  }
});

test("current imports never repair corrupted current positions or repeat the old five-millimeter shift", () => {
  const current = migrateAssembly(fixtures[0].state).state;
  const hat = current.items.find(item => item.productId === "roof-cottage")!;
  const bowl = current.items.find(item => item.productId === "food-bowl" && item.parentId !== "base2")!;
  for (const target of [hat, bowl]) {
    const damaged = { ...current, items: current.items.map(item => item.id === target.id ? { ...item, x: item.x + 5 } : item) };
    assert.throws(() => migrateAssembly(damaged), /磁吸位/);
    assert.throws(() => validateAssembly(damaged), /磁吸位/);
  }
  const migratedAgain = migrateAssembly(current).state;
  assert.deepEqual(migratedAgain, current);
  const foreign = { ...current, catalogVersion: 9 } as unknown as AssemblyState;
  assert.throws(() => migrateAssembly(foreign), /版本/);
});
