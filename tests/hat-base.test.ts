import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct, type Rotation } from '../src/data/catalog';
import { addPlatform, autoPlace, createInitialState, getItemBounds, getMagnetPoints, getPlacements, getPlatforms, migrateAssembly, rotateItem, setPlatformPool, transformPoint, tryPlace, validateAssembly, type ActionResult } from '../src/lib/assembly';
import { decodeConfig, encodeConfig } from '../src/lib/config-code';

const success = (result: ActionResult) => { assert.ok(result.ok, result.ok ? '' : result.reason); return result.state; };

test('hat left pair seats on two real steel discs with 3 mm offset, without moving any source contact', () => {
  const empty = createInitialState(), product = getProduct('roof-cottage');
  const candidate = getPlacements(empty, product.id).find(p => p.x === 78 && p.y === 240)!;
  assert.ok(candidate);
  assert.equal(candidate.magnetCount, 2);
  assert.deepEqual(product.bottomMagnets.slice(0, 2).map(p => transformPoint(p, product, candidate)), [[10, 193, 110], [10, 287, 110]]);
  const receivers = getMagnetPoints(empty).map(m => m.point);
  for (const receiver of [[10, 190, 110], [10, 290, 110]]) assert.ok(receivers.some(p => p.every((v, i) => v === receiver[i])));
  const placed = success(autoPlace(empty, product.id));
  const bounds = getItemBounds(placed.items[0])[0];
  assert.deepEqual(bounds.slice(0, 3), [2, 180.6, 110]);
  assert.equal(bounds[4], 299);
  const code = encodeConfig(placed), restored = decodeConfig(code);
  assert.equal(encodeConfig(restored), code);
  assert.deepEqual(restored, { ...placed, items: [{ ...placed.items[0], id: restored.items[0].id }] });
});

test('all three empty platforms offer four hat orientations, with distinct receivers and bounded offset', () => {
  const state = success(addPlatform(success(addPlatform(createInitialState()))));
  const product = getProduct('roof-cottage');
  for (const platform of getPlatforms(state)) for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const candidates = getPlacements(state, product.id, rotation).filter(p => p.parentId === platform.id);
    assert.equal(candidates.length, 24);
    const steel = getMagnetPoints(state).filter(p => p.parentId === platform.id).map(p => p.point);
    for (const p of candidates) {
      const contacts = product.bottomMagnets.map(m => transformPoint(m, product, p));
      const matches = contacts.flatMap(m => steel.flatMap((s, index) => {
        const distance = Math.hypot(m[0] - s[0], m[1] - s[1]);
        return m[2] === s[2] && distance <= 3 ? [{ index, distance }] : [];
      }));
      assert.equal(matches.length, 2);
      assert.equal(new Set(matches.map(m => m.index)).size, 2);
      assert.ok(matches.every(m => m.distance === 3));
      const bounds = getItemBounds({ ...p, id: 'candidate', productId: product.id, colors: {} })[0];
      assert.ok(bounds[0] >= platform.x && bounds[3] <= platform.x + 300 && bounds[1] >= 0 && bounds[4] <= 300);
    }
  }
});

test('first-floor hat rotates all four ways on the same platform and preserves its configuration', () => {
  let state = success(autoPlace(success(addPlatform(createInitialState())), 'roof-cottage', 'base2'));
  const original = state.items[0];
  for (const rotation of [90, 180, 270, 0]) {
    state = success(rotateItem(state, original.id));
    assert.equal(state.items[0].rotation, rotation);
    assert.equal(state.items[0].parentId, 'base2');
    assert.equal(state.items[0].z, 110);
    assert.deepEqual(state.items[0].colors, original.colors);
  }
  assert.deepEqual(state.items[0], original);
});

test('hat offset does not permit free-floating contacts, reused steel, pool interference or legacy bypass', () => {
  const state = success(autoPlace(createInitialState(), 'roof-cottage'));
  for (const delta of [{ x: .1 }, { y: .1 }, { z: .1 }]) {
    const item = { ...state.items[0] };
    for (const [key, value] of Object.entries(delta)) item[key as 'x' | 'y' | 'z'] += value;
    assert.throws(() => validateAssembly({ ...state, items: [item] }), /磁吸位/);
  }
  // A catalog-6 save must still be checked against its stricter historical geometry.
  assert.throws(() => migrateAssembly({ ...state, catalogVersion: 6 }, 6), /磁吸位/);
  const used = tryPlace(createInitialState(), 'food-bowl', { x: 10, y: 190, z: 110 });
  assert.ok(used.ok);
  assert.ok(!getPlacements(used.state, 'roof-cottage').some(p => p.x === 78 && p.y === 240));
  assert.ok(!getPlacements(state, 'food-bowl').some(p => p.x === 10 && p.y === 190));
  const pool = success(setPlatformPool(createInitialState(), 'base', true));
  assert.ok(!getPlacements(pool, 'roof-cottage').some(p => p.x === 78 && p.y === 60));
  assert.equal(getProduct('villa').baseMagnetOffsetMm, undefined);
  assert.equal(getProduct('cube-house').baseMagnetOffsetMm, undefined);
});
