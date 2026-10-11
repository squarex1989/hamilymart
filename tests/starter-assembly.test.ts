import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialState,
  getDisplayElevation,
  getOrderLines,
  getPlacements,
  getPlatforms,
  getTotalPrice,
  migrateAssembly,
  setBedding,
  setLegHeight,
  validateAssembly,
  type ActionResult,
  type AssemblyState,
} from "../src/lib/assembly";
import { getBaseStyleColors, getProductStyleColors } from "../src/lib/color-styles";
import { decodeConfig, decodeConfigWithMigration, encodeConfig } from "../src/lib/config-code";
import { createNewUserState } from "../src/lib/starter-assembly";

function success(result: ActionResult): AssemblyState {
  if (!result.ok) assert.fail(result.reason);
  return result.state;
}

function readPayload(code: string): unknown[] {
  return JSON.parse(Buffer.from(code.split(".")[1], "base64url").toString());
}

/** Recompute CRC so malformed bedding reaches schema validation, not the copy-error check. */
function replaceBedding(code: string, bedding: unknown): string {
  const payload = readPayload(code);
  payload[7] = bedding;
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i++) {
    crc ^= body.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return `HM3.${body}.${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

test("zero bedding preserves the selected legs, rests a legless base on the ground, and round-trips", () => {
  for (const legHeight of [0, 100, 200, 300] as const) {
    const previous = success(setLegHeight(createInitialState(), legHeight));
    const state = success(setBedding(previous, { mode: "none", depth: 0 }));
    assert.equal(state.legHeight, legHeight);
    assert.equal(getDisplayElevation(state), legHeight - 100);
    assert.equal(getTotalPrice(state), getTotalPrice(previous));
    assert.deepEqual(decodeConfig(encodeConfig(state)), state);
    assert.deepEqual(migrateAssembly(JSON.parse(JSON.stringify(state))), { state, messages: [] });
    assert.deepEqual(previous.bedding, { mode: "thin", depth: 50 });
  }
});

test("HM3 appends bedding mode 2 while preserving the historical mode 0 and 1 encodings", () => {
  for (const bedding of [
    { mode: "none", depth: 0 },
    { mode: "thin", depth: 50 },
    { mode: "thick", depth: 100 },
    { mode: "thick", depth: 200 },
    { mode: "thick", depth: 300 },
  ] as const) {
    const state = success(setBedding(createInitialState(), bedding));
    const code = encodeConfig(state);
    assert.deepEqual(readPayload(code)[7], [bedding.mode === "none" ? 2 : bedding.mode === "thin" ? 0 : 1, bedding.depth]);
    assert.deepEqual(decodeConfig(code), state);
  }
  const code = encodeConfig(createInitialState());
  for (const malformed of [[0, 0], [0, 100], [1, 0], [1, 50], [2, 50], [2, -1], [3, 0], ["2", 0], [2, "0"], [2], [2, 0, 0], null, {}]) {
    assert.throws(() => decodeConfig(replaceBedding(code, malformed)), /垫料/);
  }
  for (const malformed of [{ mode: "none", depth: 50 }, { mode: "thin", depth: 0 }, { mode: "thick", depth: 0 }, { mode: "none", depth: "0" }]) {
    assert.throws(() => validateAssembly({ ...createInitialState(), bedding: malformed }), /垫料/);
  }
});

test("the new-user Christmas design uses one 10 cm platform with the pool and both accessories on the villa", () => {
  const state = createNewUserState();
  assert.equal(getPlatforms(state).length, 1);
  assert.equal(state.legHeight, 100);
  assert.deepEqual(state.bedding, { mode: "none", depth: 0 });
  assert.equal(state.baseInsert, "pool");
  assert.deepEqual(state.items.map(item => item.productId), ["villa", "roof-cottage", "planter"]);
  const [villa, hat, planter] = state.items;
  assert.equal(villa.parentId, "base");
  assert.equal(hat.parentId, villa.id);
  assert.equal(planter.parentId, villa.id);
  assert.deepEqual([villa.x, villa.y, villa.z], [150, 190, 110]);
  assert.deepEqual([hat.x, hat.y, hat.z], [78, 239, 200]);
  assert.deepEqual([planter.x, planter.y, planter.z], [280.5, 264, 200]);
  assert.deepEqual(state.baseColors, getBaseStyleColors(0));
  for (const item of state.items) assert.deepEqual(item.colors, getProductStyleColors(item.productId, 0));

  let partial: AssemblyState = { ...state, items: [] };
  for (const [index, item] of state.items.entries()) {
    const placement = getPlacements(partial, item.productId, item.rotation).find(candidate => candidate.parentId === item.parentId && candidate.x === item.x && candidate.y === item.y && candidate.z === item.z);
    assert.equal(placement?.magnetCount, [7, 4, 1][index]);
    partial = { ...partial, items: [...partial.items, item] };
  }
  assert.deepEqual(validateAssembly(state), state, "the furnished design passes collision and magnetic validation");
  assert.throws(() => validateAssembly({ ...state, items: [...state.items, { ...hat, id: "overlapping-hat" }] }), /磁吸位|重叠/);
  const code = encodeConfig(state);
  assert.equal(encodeConfig(decodeConfig(code)), code);
  assert.equal(getTotalPrice(decodeConfig(code)), 18000);
  assert.deepEqual(getOrderLines(state).map(line => [line.sku, line.quantity, line.total]), [
    ["HM-PL-001-100", 1, 3000], ["HM-GD-003", 1, 2500], ["HM-HS-001", 1, 8000], ["HM-HS-004", 1, 4000], ["HM-GD-001", 1, 500],
  ]);
  assert(!getOrderLines(state)[0].parts.includes("H06"));
});

test("the new-user factory leaves bare-platform resets and historical saved bedding unchanged", () => {
  createNewUserState();
  const bare = createInitialState();
  assert.deepEqual(bare.items, []);
  assert.equal(bare.baseInsert, "lid");
  assert.deepEqual(bare.bedding, { mode: "thin", depth: 50 });
  const previous = { ...bare, bedding: undefined };
  assert.deepEqual(migrateAssembly(previous).state, bare);
  assert.equal(previous.bedding, undefined);

  const frozen = "HM3.WzMsNiwzMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFsxLDMwMF0sbnVsbF0.323C1BFF";
  const restored = decodeConfigWithMigration(frozen).state;
  assert.equal(restored.legHeight, 300);
  assert.deepEqual(restored.bedding, { mode: "thick", depth: 300 });
  assert.deepEqual(restored.items, []);
  assert.equal(restored.baseInsert, "lid");
});
