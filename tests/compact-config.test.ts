import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, addPlatform, validateAssembly } from '../src/lib/assembly';
import { createNewUserState } from '../src/lib/starter-assembly';
import { buildConfigPayload, encodeConfig, decodeConfig } from '../src/lib/config-code';
import * as mini from '../minitool/src/lib/config-code';
import { encodeCompactPayload, decodeCompactPayload } from '../src/lib/compact-config';
import { decodePastedDesign } from '../src/lib/import-design';
import { applyInspirationLayout } from '../src/lib/inspiration';
import { INSPIRATION_LAYOUTS } from '../src/data/inspiration-layouts';
import { COLORS } from '../src/data/catalog';

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function legacy(payload: unknown[]) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `HM${payload[0]}.${body}.${crc32(Buffer.from(body)).toString(16).toUpperCase().padStart(8,'0')}`;
}
function reframe(bytes: Uint8Array) {
  const crc = crc32(bytes), suffix = Buffer.alloc(4); suffix.writeUInt32BE(crc);
  return 'HM5.' + Buffer.concat([bytes, suffix]).toString('base64url');
}

test('HM5/HM6 is a self-contained final-state code, identically decoded by website and offline minitool', () => {
  for (const layout of INSPIRATION_LAYOUTS) for (let style = 0; style < 5; style++) {
    let state = createInitialState();
    for (let n = 1; n < layout.platformCount; n++) { const result = addPlatform(state); assert.ok(result.ok); state = result.state; }
    const result = applyInspirationLayout(state, style, layout.id); assert.ok(result.ok);
    const payload = buildConfigPayload(result.state), code = encodeConfig(result.state);
    assert.deepEqual(decodeCompactPayload(code), payload, `${layout.id}/${style}: all final fields survive`);
    assert.equal(code, mini.encodeConfig(result.state));
    assert.deepEqual(decodeConfig(code), mini.decodeConfig(code));
    assert.deepEqual(buildConfigPayload(decodeConfig(code)), payload);
    // HM6 was introduced as binary only; historic JSON envelopes are HM3/4.
    if (payload[0] !== 6) assert.equal(encodeConfig(mini.decodeConfig(legacy(payload))), code, 'HM3/4 codes remain importable');
    assert.ok(code.length < legacy(payload).length * .6, `${layout.id}/${style}: substantial reduction`);
    assert.equal(encodeConfig(decodePastedDesign(`搭配编号：${code}`).state), code);
  }
});

test('custom colors, independently sized cages, empty cages and all exact numeric representations survive', () => {
  const start = createNewUserState();
  let index = 0;
  const colors = (map: typeof start.baseColors) => Object.fromEntries(Object.keys(map).map(key => [key, COLORS[index++ % COLORS.length].id]));
  const state = validateAssembly({ ...start, baseColors: colors(start.baseColors), items: start.items.map(item => ({ ...item, colors: colors(item.colors) })), cage: {presetId: null, width: 73.123456789, depth: 45.125, height: 52.50000000001} });
  for (const cage of [state.cage, null]) {
    const value = { ...state, cage }, code = encodeConfig(value);
    assert.deepEqual(buildConfigPayload(decodeConfig(code)), buildConfigPayload(value));
  }
  const payload = buildConfigPayload(start) as any[];
  for (const x of [-2000, -0.001, 0, 0.1, 12.345, 45.125, 83.40000000000001, 1e-12]) {
    payload[5][0][1] = x;
    assert.deepEqual(decodeCompactPayload(encodeCompactPayload(payload)), payload, `exact ${x}`);
  }
});

test('HM5 rejects truncation, copying corruption, unknown version and trailing binary data', () => {
  const code = encodeConfig(createNewUserState());
  for (let n = 4; n < code.length; n++) assert.throws(() => decodeConfig(code.slice(0,n)));
  for (let n = 4; n < code.length; n++) {
    const changed = code.slice(0,n) + (code[n] === 'A' ? 'B' : 'A') + code.slice(n+1);
    assert.throws(() => decodeConfig(changed), `byte ${n}`);
  }
  assert.throws(() => decodeConfig(code.replace('HM5.', 'HM7.')), /版本/);
  assert.throws(() => decodeConfig('HM5.' + 'A'.repeat(54001)), /过长/);
  const bytes = Buffer.from(code.slice(4), 'base64url').subarray(0,-4);
  assert.throws(() => decodeConfig(reframe(Buffer.concat([bytes,Buffer.from([0])]))), /损坏|格式/);
  for (let n=0;n<bytes.length;n++) assert.throws(()=>decodeConfig(reframe(bytes.subarray(0,n))), /损坏|格式|校验/);
});

test('valid CRC does not bypass bounds, product, color or dependency validation', () => {
  const start = buildConfigPayload(createNewUserState()) as any[];
  for (const mutate of [
    (p:any[])=>{p[5][0][0]=65000;},
    (p:any[])=>{p[5][0][5][0]=31;},
    (p:any[])=>{p[5][0][6]=0;}, // self-parent
    (p:any[])=>{p[5][0][1]=1e100;},
    (p:any[])=>{p[9].width=-1;},
    (p:any[])=>{p[8]='不存在的仓鼠';},
    (p:any[])=>{p[5]=Array(193).fill(p[5][0]);},
  ]) {
    const payload = JSON.parse(JSON.stringify(start)); mutate(payload);
    assert.throws(()=>decodeConfig(encodeCompactPayload(payload)));
  }
});

test('the HM5 format remains stable for a frozen starter design', () => {
  const code = 'HM5.CBAAgp4AI8PEEwAJACAAAAAAAGAAYVgEfgEbgCABYIBBCEABjAFAg9RWSAISAGAAMQGCBOAJvAZIAYABhAAAeOEeWQ';
  const migrated = encodeConfig(decodeConfig(code));
  assert.equal(encodeConfig(decodeConfig(migrated)), migrated);
  assert.deepEqual(decodeConfig(code), mini.decodeConfig(code));
  assert.equal(decodeConfig(code).items.length,3);
  assert.ok(code.length < 100);
});
