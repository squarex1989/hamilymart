/** HM5/6 binary wire formats. Only the final design; no history or preset layout.
 * Stable catalog indices are inherited from HM3/4. Never reorder CAGE_IDS.
 * Bit stream: catalog, platform count, legs, bedding, hamster, cage, platforms,
 * item count, items. Color vectors may reference identical vectors in this payload.
 * Numbers use exact integers/tenths/thousandths or IEEE-754; never round geometry.
 * Four CRC32 bytes follow the payload; unused final bits must be zero.
 * HM6 replaces the platform count with a stable-slot presence mask, adds optional
 * extension leg heights, ground parent -5 and a reversible-door bit per item.
 * Base color/cover settings are retained even when the base itself is removed.
 * HM6 also includes its version byte in CRC input to reject changed prefixes.
 */
const CAGE_IDS = ['carno-tv-73', 'carno-cheese-80', 'carno-cheese-100', 'buca-cube-80', 'buca-cube-100', 'buca-cube-120', 'buca-bag-50', 'buca-bag-65', 'buca-bag-70', 'buca-star-70', 'niteangel-stack-80', 'tafit-crystal-62', 'tafit-crystal-66', 'tafit-crystal-75', 'tafit-crystal-88', 'tafit-bubble-62'];
const BEDDING = [[2, 0], [0, 50], [1, 100], [1, 200], [1, 300]];
const invalid = () => new Error('搭配编号内容损坏或格式不正确，请重新复制完整编号');
class Writer {
  data: number[] = []; position = 0;
  bits(value: number, count: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** count) throw invalid();
    for (let bit = count - 1; bit >= 0; bit--) {
      const index = this.position >>> 3, shift = 7 - (this.position++ & 7);
      this.data[index] = (this.data[index] ?? 0) | ((Math.floor(value / 2 ** bit) & 1) << shift);
    }
  }
  uint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw invalid();
    do { const rest = Math.floor(value / 128); this.bits((value % 128) | (rest ? 128 : 0), 8); value = rest; } while (value);
  }
  number(value: number) {
    for (const [mode, scale] of [1, 10, 1000].entries()) {
      const scaled = value * scale;
      if (Number.isSafeInteger(scaled) && Math.abs(scaled) <= 0x7fffffff && scaled / scale === value) {
        this.bits(mode, 2); this.uint(scaled < 0 ? -scaled * 2 - 1 : scaled * 2); return;
      }
    }
    if (!Number.isFinite(value)) throw invalid();
    this.bits(3, 2); const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
    for (let i = 0; i < 8; i++) this.bits(view.getUint8(i), 8);
  }
  text(value: string | null) {
    this.uint(value === null ? 0 : value.length + 1);
    if (value !== null) for (let i = 0; i < value.length; i++) this.uint(value.charCodeAt(i));
  }
}
class Reader {
  position = 0;
  constructor(readonly data: Uint8Array) {}
  bits(count: number): number {
    if (this.position + count > this.data.length * 8) throw invalid();
    let value = 0;
    for (let i = 0; i < count; i++) value = value * 2 + ((this.data[this.position >>> 3] >>> (7 - (this.position++ & 7))) & 1);
    return value;
  }
  uint(max = 0xffffffff): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.bits(8); value += (byte & 127) * 2 ** (7 * i);
      if (value > max) throw invalid();
      if (byte < 128) { if (i && byte === 0) throw invalid(); return value; }
    }
    throw invalid();
  }
  number(): number {
    const mode = this.bits(2);
    if (mode < 3) { const value = this.uint(); return (value % 2 ? -(value + 1) / 2 : value / 2) / [1, 10, 1000][mode]; }
    const view = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, this.bits(8));
    const value = view.getFloat64(0); if (!Number.isFinite(value)) throw invalid(); return value;
  }
  text(): string | null {
    const length = this.uint(129); if (!length) return null;
    let value = ''; for (let i = 1; i < length; i++) value += String.fromCharCode(this.uint(65535)); return value;
  }
  finish() {
    const remaining = this.data.length * 8 - this.position;
    if (remaining > 7 || this.bits(remaining) !== 0) throw invalid();
  }
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function base64(bytes: Uint8Array) {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// The existing schema validator owns semantic validation and catalog migration.
// This private transport uses tuples so both legacy and compact codes share it.
export function encodeCompactPayload(payload: unknown[]): string {
  const p = payload as any[], w = new Writer(), vectors: number[][] = [];
  const extended = p[0] === 6;
  const count = p[10] ? 4 : p[6] ? 3 : p[4] ? 2 : 1;
  w.uint(p[1]);
  if (extended) {
    if (p[11] !== 0 && p[11] !== 1) throw invalid();
    w.bits((p[11] ? 0 : 1) | (p[4] ? 2 : 0) | (p[6] ? 4 : 0) | (p[10] ? 8 : 0), 4);
  } else w.bits(count - 1, 2);
  w.bits(p[2] / 100, 2);
  const bedding = BEDDING.findIndex(([mode, depth]) => mode === p[7][0] && depth === p[7][1]);
  w.bits(bedding, 3); w.text(p[8]);
  const cage = p[9];
  if (cage === null) w.bits(0, 2);
  else {
    const id = CAGE_IDS.indexOf(cage.presetId);
    w.bits(id >= 0 ? 1 : 2, 2); if (id >= 0) w.uint(id);
    else w.text(cage.presetId); // Preserve future preset IDs without silently losing them.
    for (const key of ['width', 'depth', 'height']) w.number(cage[key]);
  }
  const colors = (values: number[]) => {
    const found = vectors.findIndex(vector => vector.length === values.length && vector.every((value, i) => value === values[i]));
    w.uint(found + 1); if (found >= 0) return;
    vectors.push(values); w.uint(values.length);
    const same = values.length > 0 && values.every(value => value === values[0]);
    w.bits(same ? 1 : 0, 1); for (const value of same ? [values[0]] : values) w.bits(value, 5);
  };
  const platform = (value: any[], base: boolean) => {
    if (!base) w.bits(value[0], 2);
    const offset = base ? 0 : 1; w.bits(value[offset], 1); colors(value[offset + 1]);
    w.bits(value[offset + 2].reduce((mask: number, cover: number) => mask | (1 << (cover - 1)), 0), 5);
    if (extended && !base) {
      const height = value[4]; w.bits(height === null ? 0 : 1, 1);
      if (height !== null) w.bits(height / 100, 2);
    }
  };
  platform(p[3], true);
  for (const value of extended ? [p[4], p[6], p[10]].filter(Boolean) : [p[4], p[6], p[10]].slice(0, count - 1)) platform(value, false);
  w.uint(p[5].length);
  for (const [product, x, y, z, turn, values, parent, door] of p[5]) {
    w.uint(product); w.uint(parent + (extended ? 5 : 4)); w.bits(turn, 2);
    for (const value of [x, y, z]) w.number(value); colors(values);
    if (extended) w.bits(door, 1);
  }
  const bytes = Uint8Array.from(w.data), crc = crc32(extended ? Uint8Array.from([6, ...bytes]) : bytes);
  return (extended ? 'HM6.' : 'HM5.') + base64(Uint8Array.from([...bytes, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]));
}
export function decodeCompactPayload(code: string): unknown[] {
  if (code.length > 54000 || !/^HM[56]\.[A-Za-z0-9_-]+$/.test(code)) throw invalid();
  const extended = code.startsWith('HM6.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(code.slice(4).replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); }
  catch { throw invalid(); }
  if (bytes.length < 5 || base64(bytes) !== code.slice(4)) throw new Error('搭配编号校验失败，请重新复制完整编号');
  const data = bytes.subarray(0, -4), expected = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
  if (crc32(extended ? Uint8Array.from([6, ...data]) : data) !== expected) throw new Error('搭配编号校验失败，请重新复制完整编号');
  const r = new Reader(data), vectors: number[][] = [];
  const catalog = r.uint(65535), slots = r.bits(extended ? 4 : 2);
  const count = extended ? 4 : slots + 1, legs = r.bits(2) * 100, bedding = BEDDING[r.bits(3)];
  if (!bedding) throw invalid();
  const hamster = r.text(), cageMode = r.bits(2);
  let cage = null;
  if (cageMode) {
    if (cageMode === 3) throw invalid();
    const presetId = cageMode === 1 ? CAGE_IDS[r.uint(CAGE_IDS.length - 1)] : r.text();
    cage = { presetId, width: r.number(), depth: r.number(), height: r.number() };
  }
  const colors = () => {
    const index = r.uint(vectors.length);
    if (index) return [...vectors[index - 1]];
    const length = r.uint(64), same = r.bits(1);
    if (same && !length) throw invalid();
    const values = same ? Array(length).fill(r.bits(5)) : Array.from({ length }, () => r.bits(5));
    vectors.push(values); return values;
  };
  const platform = (base: boolean) => {
    const direction = base ? [] : [r.bits(2)], insert = r.bits(1), values = colors(), mask = r.bits(5);
    return [...direction, insert, values, [1, 2, 3, 4, 5].filter(n => mask & (1 << (n - 1))), ...(extended && !base ? [r.bits(1) ? r.bits(2) * 100 : null] : [])];
  };
  const platforms = Array.from({ length: count }, (_, i) => i === 0 || !extended || slots & (1 << i) ? platform(i === 0) : null);
  const length = r.uint(extended ? 196 : count * 48), items = [];
  for (let i = 0; i < length; i++) {
    const product = r.uint(65535), parent = r.uint(i + (extended ? 4 : 3)) - (extended ? 5 : 4), turn = r.bits(2);
    const x = r.number(), y = r.number(), z = r.number(), values = colors();
    items.push([product, x, y, z, turn, values, parent, ...(extended ? [r.bits(1)] : [])]);
  }
  r.finish();
  return [extended ? 6 : count === 4 ? 4 : 3, catalog, legs, platforms[0], platforms[1] ?? null, items, platforms[2] ?? null, [...bedding], hamster, cage, ...(count === 4 ? [platforms[3]] : []), ...(extended ? [slots & 1 ? 0 : 1] : [])];
}
