import test from "node:test";
import assert from "node:assert/strict";
import * as webAssembly from "../src/lib/assembly";
import * as miniAssembly from "../minitool/src/lib/assembly";
import * as web from "../src/lib/config-code";
import * as mini from "../minitool/src/lib/config-code";
import { encodeCompactPayload, decodeCompactPayload } from "../src/lib/compact-config";
import { decodeCompactPayload as decodeMiniCompactPayload } from "../minitool/src/lib/compact-config";
import { decodePastedDesign } from "../src/lib/import-design";
import { createNewUserState } from "../src/lib/starter-assembly";
import { CATALOG_VERSION } from "../src/data/catalog";

const ok = (result: webAssembly.ActionResult) => {
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.state;
};
function roundTrip(state: webAssembly.AssemblyState) {
  const payload = web.buildConfigPayload(state), code = web.encodeConfig(state);
  assert.match(code, /^HM6\./);
  assert.deepEqual(decodeCompactPayload(code), payload);
  assert.deepEqual(web.buildConfigPayload(web.decodeConfig(code)), payload);
  assert.deepEqual(mini.buildConfigPayload(mini.decodeConfig(code)), payload);
  assert.equal(mini.encodeConfig(state), code);
  assert.equal(web.encodeConfig(decodePastedDesign(`搭配编号：\n${code}`).state), code);
  assert.equal(web.encodeConfig(webAssembly.migrateAssembly(JSON.parse(JSON.stringify(state))).state), code);
  assert.equal(mini.encodeConfig(miniAssembly.migrateAssembly(JSON.parse(JSON.stringify(state))).state), code);
  return { code, restored: web.decodeConfig(code) };
}

test("HM6 keeps independent leg heights and gaps without renumbering platforms", () => {
  let state = webAssembly.createInitialState();
  for (let i = 0; i < 3; i++) state = ok(webAssembly.addPlatform(state));
  state = {
    ...state,
    legHeight: 0,
    extension: { ...state.extension!, legHeight: 100 },
    thirdPlatform: { ...state.thirdPlatform!, legHeight: 200 },
    fourthPlatform: { ...state.fourthPlatform!, legHeight: 300 },
  };
  assert.deepEqual(roundTrip(state).restored.fourthPlatform, state.fourthPlatform);
  for (const removed of ["base2", "base3", "base"] as const) state = ok(webAssembly.removePlatform(state, removed));
  const { restored } = roundTrip(state);
  assert.equal(restored.baseRemoved, true);
  assert.equal(restored.extension, null);
  assert.equal(restored.thirdPlatform, null);
  assert.deepEqual(webAssembly.getPlatforms(restored).map(p => [p.id, p.x, p.y]), [["base4", 900, 0]]);
  assert.equal(restored.fourthPlatform?.legHeight, 300);
});

test("HM6 retains ground families after removing the last platform, including colors and relative positions", () => {
  const start = createNewUserState();
  const state = ok(webAssembly.removePlatform(start, "base"));
  const { restored } = roundTrip(state);
  assert.equal(webAssembly.getPlatforms(restored).length, 0);
  assert.ok(restored.items.some(item => item.parentId === "ground"));
  assert.ok(restored.items.some(item => restored.items.some(parent => parent.id === item.parentId)));
  assert.equal(restored.items.length, state.items.length);
  const describe = (value: webAssembly.AssemblyState) => value.items.map(item => ({
    productId: item.productId, x: item.x, y: item.y, z: item.z,
    rotation: item.rotation, colors: item.colors,
    parent: value.items.find(parent => parent.id === item.parentId)?.productId ?? item.parentId,
  })).sort((a, b) => a.productId.localeCompare(b.productId));
  assert.deepEqual(describe(restored), describe(state));
  // IDs and array order are not part of the final design.
  const renamed = { ...state, items: state.items.map(item => ({
    ...item, id: `other-${item.id}`,
    parentId: item.parentId === "ground" ? "ground" : `other-${item.parentId}`,
  })).reverse() };
  assert.equal(web.encodeConfig(renamed), web.encodeConfig(state));
});

test("legacy Aite left panels migrate to fixed left-door variants in compact codes", () => {
  const start = webAssembly.createInitialState();
  const placement = webAssembly.getPlacements(start, "milk-house-aite").find(point => point.parentId === "base");
  assert.ok(placement);
  const right = ok(webAssembly.tryPlace(start, "milk-house-aite", placement));
  const left = { ...right, items: right.items.map(item => ({ ...item, doorSide: "left" as const })) };
  const code = web.encodeConfig(left);
  assert.match(code, /^HM5\./);
  for (const api of [web, mini]) {
    const restored = api.decodeConfig(code);
    assert.equal(restored.items[0].productId, "milk-house-aite-left");
    assert.equal(restored.items[0].doorSide, undefined);
    assert.equal(restored.items[0].rotation, left.items[0].rotation);
    assert.equal(api.encodeConfig(restored), code);
  }
});

test("HM6 handles every platform presence mask, including an empty design", () => {
  let four = webAssembly.createInitialState();
  for (let i = 0; i < 3; i++) four = ok(webAssembly.addPlatform(four));
  for (let mask = 0; mask < 16; mask++) {
    const state = {
      ...four, baseRemoved: !(mask & 1),
      extension: mask & 2 ? { ...four.extension!, legHeight: 0 as const } : null,
      thirdPlatform: mask & 4 ? { ...four.thirdPlatform!, legHeight: 200 as const } : null,
      fourthPlatform: mask & 8 ? { ...four.fourthPlatform!, legHeight: 300 as const } : null,
    };
    // Mask 1 is an ordinary old-format design; all other masks use new fields.
    if (mask === 1) {
      assert.match(web.encodeConfig(state), /^HM5\./);
      continue;
    }
    const { restored } = roundTrip(state);
    assert.deepEqual(webAssembly.getPlatforms(restored).map(p => p.id),
      ["base", "base2", "base3", "base4"].filter((_, i) => mask & (1 << i)));
  }
});

test("HM6 rejects corrupt codes and semantically invalid new-field values", () => {
  const state = ok(webAssembly.removePlatform(createNewUserState(), "base"));
  const { code } = roundTrip(state);
  assert.throws(() => web.decodeConfig(code.replace("HM6.", "HM5.")), /校验/);
  assert.throws(() => mini.decodeConfig(web.encodeConfig(webAssembly.createInitialState()).replace("HM5.", "HM6.")), /校验/);
  for (let n = 4; n < code.length; n++) {
    assert.throws(() => web.decodeConfig(code.slice(0, n)));
    const changed = code.slice(0, n) + (code[n] === "A" ? "B" : "A") + code.slice(n + 1);
    assert.throws(() => mini.decodeConfig(changed));
  }
  const original = web.buildConfigPayload(state);
  for (const mutate of [
    (p: any[]) => { p[5][0][6] = -1; }, // Parent base has been removed.
    (p: any[]) => { p[5][0][6] = -2; }, // Missing second platform.
    (p: any[]) => { p[5][0][6] = 0; }, // Self-dependency.
    (p: any[]) => { p[5][0][7] = 1; }, // Only Aite has a reversible panel.
    (p: any[]) => { p[5] = Array(197).fill(p[5][0]); },
  ]) {
    const payload = structuredClone(original); mutate(payload);
    assert.throws(() => web.decodeConfig(encodeCompactPayload(payload)));
    assert.throws(() => mini.decodeConfig(encodeCompactPayload(payload)));
  }
});

test("HM6 transports 192 components plus four detached pools while preserving legacy count bounds", () => {
  const payload = web.buildConfigPayload(ok(webAssembly.removePlatform(createNewUserState(), "base"))) as any[];
  // Test the wire capacity independently of placement validation. Detaching four
  // embedded pools must not overflow the former 192-item transport limit.
  const tuple = payload[5][0];
  payload[5] = Array.from({ length: 196 }, (_, i) => [...tuple.slice(0, 1), i, ...tuple.slice(2, 6), -5, 0]);
  const code = encodeCompactPayload(payload);
  assert.deepEqual(decodeCompactPayload(code), payload);
  assert.deepEqual(decodeMiniCompactPayload(code), payload);
  payload[5].push([...tuple]);
  assert.throws(() => decodeCompactPayload(encodeCompactPayload(payload)));
  assert.throws(() => decodeMiniCompactPayload(encodeCompactPayload(payload)));
  const legacy = web.buildConfigPayload(createNewUserState()) as any[];
  legacy[5] = Array(49).fill(legacy[5][0]);
  assert.throws(() => decodeCompactPayload(encodeCompactPayload(legacy)), "HM5 keeps its original 48-per-platform limit");
});

test("historical HM1 through HM5 remain readable and canonical across website and minitool", () => {
  let four = webAssembly.createInitialState();
  for (let i = 0; i < 3; i++) four = ok(webAssembly.addPlatform(four));
  const payload = web.buildConfigPayload(four);
  assert.equal(payload[0], 4);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  let crc = 0xffffffff;
  for (const value of Buffer.from(body)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const hm4 = `HM4.${body}.${((crc ^ 0xffffffff) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  for (const code of [
    "HM1.WzEsMiwyMDAsMCxbNywxLDAsMCwwLDAsMCwwLDBdLFtbMCwxNTAsMTkwLDExMCwwLFs0LDYsNSwzXSwtMV0sWzMsNzgsMjM5LDIwMCwyLFsyXSwwXV1d.4AF01816",
    "HM2.WzIsNCwxMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbWzAsMTUwLDE5MCwxMTAsMCxbMSwwLDIsMSwxLDEsMCwwLDUsNl0sLTFdXV0.A72A079F",
    "HM3.WzMsNiwzMDAsWzAsWzAsMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFsxLDMwMF0sbnVsbF0.323C1BFF",
    hm4,
    "HM5.CBAAgp4AI8PEEwAJACAAAAAAAGAAYVgEfgEbgCABYIBBCEABjAFAg9RWSAISAGAAMQGCBOAJvAZIAYABhAAAeOEeWQ",
  ]) {
    const restored = web.decodeConfig(code), canonical = web.encodeConfig(restored);
    assert.equal(restored.catalogVersion, CATALOG_VERSION);
    assert.deepEqual(mini.decodeConfig(code), restored, code.slice(0, 4));
    assert.equal(mini.encodeConfig(restored), canonical);
    assert.equal(web.encodeConfig(web.decodeConfig(canonical)), canonical);
  }
});
