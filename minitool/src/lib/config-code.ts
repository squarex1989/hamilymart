import { supportsLegacyDoor } from '../data/fixed-door-variants';
import { encodeCompactPayload, decodeCompactPayload } from "./compact-config";
import { CATALOG_VERSION, COLORS, PRODUCTS, getPoolRimColor, getProductColorParts } from "../data/catalog";
import type { ColorMap } from "../data/catalog";
import { createInitialState, migrateAssembly, validateAssembly } from "./assembly";
import type { AssemblyItem, AssemblyState, AssemblyMigrationResult, PlatformDirection, PlatformExtension } from "./assembly";

/** Self-contained, versioned state. CRC catches copying errors; it is not a signature. */
const MAX_CODE_LENGTH = 54000;
const DIRECTIONS: PlatformDirection[] = ["left", "right", "front", "back"];
const LEGACY_PRODUCT_IDS = ["villa", "l-house", "cube-house", "roof-cottage", "pipe-st1", "pipe-st2", "pipe-st3", "pipe-lt1", "pipe-lt2", "pipe-lt3", "planter"];
function colorId(index: unknown) {
  if (typeof index !== "number" || !Number.isInteger(index) || !COLORS[index]) throw new Error("搭配编号包含未知颜色");
  return COLORS[index].id;
}
function checksum(text: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
function colorsToArray(colors: ColorMap, keys: string[]): number[] {
  return keys.map(key => COLORS.findIndex(color => color.id === colors[key]));
}
function arrayToColors(value: unknown, keys: string[]): ColorMap {
  if (!Array.isArray(value) || value.length !== keys.length) throw new Error("搭配编号的颜色数据不完整");
  return Object.fromEntries(keys.map((key, index) => [key, colorId(value[index])]));
}
function sortedItems(state: AssemblyState): AssemblyItem[] {
  const descriptor = (item: AssemblyItem) => JSON.stringify([item.productId, item.x, item.y, item.z, item.rotation, Object.entries(item.colors).sort(), item.doorSide ?? "right"]);
  const children = (parent: string) => state.items.filter(item => item.parentId === parent).sort((a, b) => {
    const left = descriptor(a), right = descriptor(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const result: AssemblyItem[] = [];
  const walk = (parent: string) => { for (const item of children(parent)) { result.push(item); walk(item.id); } };
  for (const id of ["base", "base2", "base3", "base4", "ground"]) walk(id);
  return result;
}
export function encodeConfig(value: AssemblyState): string {
  return encodeCompactPayload(buildConfigPayload(value));
}
/** Final-state tuples shared by the compact transport and legacy schema validator. */
export function buildConfigPayload(value: AssemblyState): unknown[] {
  const state = validateAssembly(value), items = sortedItems(state);
  const platformColors = [state.baseColors, state.extension?.baseColors, state.thirdPlatform?.baseColors, state.fourthPlatform?.baseColors].filter((colors): colors is ColorMap => !!colors);
  const customRim = platformColors.some(colors => colors["B01-rim"] !== getPoolRimColor(colors.B01));
  const baseKeys = Object.keys(createInitialState().baseColors).filter(key => key !== "B01-rim" || customRim);
  const encodeCovers = (covers: string[]) => covers.map(id => Number(id.slice(1)));
  // Keep old final states in the unchanged HM5 transport. HM6 adds independently
  // elevated/sparse platform slots, ground families and reversible Aite doors.
  const extended = Boolean(state.baseRemoved
    || (state.thirdPlatform && !state.extension)
    || (state.fourthPlatform && (!state.extension || !state.thirdPlatform))
    || items.length > (state.fourthPlatform ? 192 : state.thirdPlatform ? 144 : state.extension ? 96 : 48)
    || [state.extension, state.thirdPlatform, state.fourthPlatform].some(platform => platform?.legHeight !== undefined)
    || items.some(item => item.parentId === "ground" || item.doorSide === "left"));
  const encodeExtension = (platform: PlatformExtension | null) => platform ? [
    DIRECTIONS.indexOf(platform.direction), platform.baseInsert === "pool" ? 1 : 0,
    colorsToArray(platform.baseColors, baseKeys), encodeCovers(platform.removedCovers),
    ...(extended ? [platform.legHeight ?? null] : []),
  ] : null;
  const format = extended ? 6 : state.fourthPlatform ? 4 : 3;
  const payload = [
    format, CATALOG_VERSION, state.legHeight,
    [state.baseInsert === "pool" ? 1 : 0, colorsToArray(state.baseColors, baseKeys), encodeCovers(state.removedCovers)],
    encodeExtension(state.extension),
    items.map(item => {
      const productIndex = PRODUCTS.findIndex(product => product.id === item.productId);
      const parent = item.parentId === "base" ? -1 : item.parentId === "base2" ? -2 : item.parentId === "base3" ? -3 : item.parentId === "base4" ? -4 : item.parentId === "ground" ? -5 : items.findIndex(parent => parent.id === item.parentId);
      return [productIndex, item.x, item.y, item.z, item.rotation / 90, colorsToArray(item.colors, getProductColorParts(item.productId).map(part => part.id)), parent, ...(extended ? [item.doorSide === "left" ? 1 : 0] : [])];
    }),
    encodeExtension(state.thirdPlatform),
    [state.bedding.mode === "none" ? 2 : state.bedding.mode === "thin" ? 0 : 1, state.bedding.depth],
    state.hamster,
    state.cage ?? null,
    ...(format === 4 || extended ? [encodeExtension(state.fourthPlatform)] : []),
    ...(extended ? [state.baseRemoved ? 1 : 0] : []),
  ];
  return payload;
}
export function decodeConfigWithMigration(input: string): AssemblyMigrationResult {
  if (typeof input !== "string" || input.length > MAX_CODE_LENGTH) throw new Error("搭配编号过长或格式不正确");
  const code = input.trim();
  if (/^HM[56]\./.test(code)) {
    const payload = decodeCompactPayload(code);
    return decodePayload(payload, payload[0] as number);
  }
  const match = /^HM([1234])\.([A-Za-z0-9_-]+)\.([A-Fa-f0-9]{8})$/.exec(code);
  if (!match) throw new Error(code.startsWith("HM") && !/^HM[1234]\./.test(code) ? "暂不支持这个搭配编号版本" : "请输入完整的 HM1 至 HM6 搭配编号");
  const [, formatText, body, crc] = match;
  if (checksum(body) !== crc.toUpperCase()) throw new Error("搭配编号校验失败，请重新复制完整编号");
  let payload: unknown;
  try { payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/"))); }
  catch { throw new Error("搭配编号内容损坏"); }
  return decodePayload(payload, Number(formatText));
}
function decodePayload(payload: unknown, format: number): AssemblyMigrationResult {
  const legacy = format === 1, extended = format === 6;
  if (!Array.isArray(payload) || !(extended ? [12] : format === 4 ? [11] : format === 3 ? [9, 10] : [6]).includes(payload.length) || payload[0] !== format || !(extended ? [CATALOG_VERSION] : format === 1 ? [2, 3] : format === 2 ? [4, 5] : format === 3 ? [6, 7, 8, 9, CATALOG_VERSION] : [8, 9, CATALOG_VERSION]).includes(payload[1])) throw new Error("搭配目录版本不兼容");
  const sourceCatalogVersion = payload[1] as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  const initial = createInitialState(), baseKeys = Object.keys(initial.baseColors);
  const state: Omit<AssemblyState, "catalogVersion"> & { catalogVersion: number } = { ...initial, catalogVersion: sourceCatalogVersion, legHeight: payload[2], items: [] };
  const decodeBaseColors = (value: unknown): ColorMap => {
    const keys = Array.isArray(value) && value.length === baseKeys.length - 1 ? baseKeys.filter(key => key !== "B01-rim") : baseKeys;
    return arrayToColors(value, keys);
  };
  const decodeInsert = (value: unknown) => { if (value !== 0 && value !== 1) throw new Error("平台款式无效"); return value ? "pool" as const : "lid" as const; };
  const decodeCovers = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some(n => !Number.isInteger(n) || n < 1 || n > 5) || new Set(value).size !== value.length) throw new Error("连通孔配置无效");
    return value.map(n => `H0${n}`);
  };
  const decodeExtension = (extension: unknown): PlatformExtension | null => {
    if (extension === null) return null;
    if (!Array.isArray(extension) || extension.length !== (extended ? 5 : 4) || !Number.isInteger(extension[0]) || !DIRECTIONS[extension[0]]) throw new Error("扩展平台数据无效");
    if (extended && extension[4] !== null && ![0, 100, 200, 300].includes(extension[4])) throw new Error("平台腿高无效");
    return { direction: DIRECTIONS[extension[0]], baseInsert: decodeInsert(extension[1]), baseColors: decodeBaseColors(extension[2]), removedCovers: decodeCovers(extension[3]), ...(extended && extension[4] !== null ? { legHeight: extension[4] } : {}) };
  };
  if (legacy) {
    state.baseInsert = decodeInsert(payload[3]);
    state.baseColors = decodeBaseColors(payload[4]);
  } else {
    const base = payload[3];
    if (!Array.isArray(base) || base.length !== 3) throw new Error("平台数据不完整");
    state.baseInsert = decodeInsert(base[0]);
    state.baseColors = decodeBaseColors(base[1]);
    state.removedCovers = decodeCovers(base[2]);
    state.extension = decodeExtension(payload[4]);
    if (format >= 3) {
      state.thirdPlatform = decodeExtension(payload[6]);
      const bedding = payload[7];
      if (!Array.isArray(bedding) || bedding.length !== 2 || (bedding[0] !== 0 && bedding[0] !== 1 && bedding[0] !== 2)) throw new Error("垫料数据无效");
      state.bedding = { mode: bedding[0] === 2 ? "none" : bedding[0] === 0 ? "thin" : "thick", depth: bedding[1] } as AssemblyState["bedding"];
      if (payload[8] !== null && typeof payload[8] !== "string") throw new Error("仓鼠品种无效");
      state.hamster = payload[8];
      state.cage = payload.length >= 10 ? payload[9] : initial.cage;
      if (format === 4 || extended) {
        state.fourthPlatform = decodeExtension(payload[10]);
        if (!extended && !state.fourthPlatform) throw new Error("第四个平台数据无效");
      }
      if (extended) {
        if (payload[11] !== 0 && payload[11] !== 1) throw new Error("基础平台配置无效");
        if (payload[11]) state.baseRemoved = true;
      }
    }
  }
  const tuples = payload[5];
  if (!Array.isArray(tuples) || tuples.length > (extended ? 196 : state.fourthPlatform ? 192 : state.thirdPlatform ? 144 : state.extension ? 96 : 48)) throw new Error("搭配编号内容无效");
  for (let i = 0; i < tuples.length; i++) {
    const tuple: unknown = tuples[i];
    if (!Array.isArray(tuple) || tuple.length !== (extended ? 8 : 7)) throw new Error("组件数据不完整");
    const [productIndex, x, y, z, turn, colors, parent, door] = tuple;
    const product = legacy ? PRODUCTS.find(product => product.id === LEGACY_PRODUCT_IDS[productIndex]) : PRODUCTS[productIndex];
    if (!Number.isInteger(productIndex) || !product || !Number.isInteger(turn) || turn < 0 || turn > 3 || !Number.isInteger(parent) || parent < (extended ? -5 : -format) || parent >= i || (parent === -1 && state.baseRemoved) || (parent === -2 && !state.extension) || (parent === -3 && !state.thirdPlatform) || (parent === -4 && !state.fourthPlatform)) throw new Error("组件编号、方向或依赖无效");
    if (extended && (door !== 0 && door !== 1 || door === 1 && !supportsLegacyDoor(product.id))) throw new Error("门板方向无效");
    const allColorKeys = getProductColorParts(product.id).map(part => part.id);
    const colorKeys = sourceCatalogVersion === 2 && product.id === "villa" ? ["A01", "A02", "G05", "G15"]
      : legacy || (Array.isArray(colors) && colors.length === product.parts.length) ? product.parts.map(part => part.id)
      // The original decorative slots occupied 8 and 9 before the stair base was added.
      : product.id === "villa" && Array.isArray(colors) && colors.length === 10 ? allColorKeys.slice(0, 10)
      : product.id === "roof-cottage" && Array.isArray(colors) && colors.length === 2 ? allColorKeys.slice(0, 2)
      : allColorKeys;
    state.items.push({ id: `c${i + 1}`, productId: product.id, x, y, z, rotation: (turn * 90) as AssemblyItem["rotation"], colors: arrayToColors(colors, colorKeys), parentId: parent === -1 ? "base" : parent === -2 ? "base2" : parent === -3 ? "base3" : parent === -4 ? "base4" : parent === -5 ? "ground" : `c${parent + 1}`, ...(door === 1 ? { doorSide: "left" as const } : {}) });
  }
  return migrateAssembly(state, sourceCatalogVersion);
}
/** Use the migration result when the UI needs to explain an upgraded configuration. */
export function decodeConfig(input: string): AssemblyState { return decodeConfigWithMigration(input).state; }
