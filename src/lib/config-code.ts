import { CATALOG_VERSION, COLORS, PRODUCTS, getProductColorParts } from "../data/catalog";
import type { ColorMap } from "../data/catalog";
import { createInitialState, migrateAssembly, validateAssembly } from "./assembly";
import type { AssemblyItem, AssemblyState, AssemblyMigrationResult, PlatformDirection } from "./assembly";

/** Self-contained, versioned state. CRC only catches copying errors; it is not a signature. */
const MAX_CODE_LENGTH = 36000;
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
  const descriptor = (item: AssemblyItem) => JSON.stringify([item.productId, item.x, item.y, item.z, item.rotation, Object.entries(item.colors).sort()]);
  const children = (parent: string) => state.items.filter(item => item.parentId === parent).sort((a, b) => {
    const left = descriptor(a), right = descriptor(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const result: AssemblyItem[] = [];
  const walk = (parent: string) => { for (const item of children(parent)) { result.push(item); walk(item.id); } };
  walk("base");
  walk("base2");
  return result;
}
export function encodeConfig(value: AssemblyState): string {
  const state = validateAssembly(value), items = sortedItems(state);
  const baseKeys = Object.keys(createInitialState().baseColors);
  const encodeCovers = (covers: string[]) => covers.map(id => Number(id.slice(1)));
  const payload = [
    2, CATALOG_VERSION, state.legHeight,
    [state.baseInsert === "pool" ? 1 : 0, colorsToArray(state.baseColors, baseKeys), encodeCovers(state.removedCovers)],
    state.extension ? [DIRECTIONS.indexOf(state.extension.direction), state.extension.baseInsert === "pool" ? 1 : 0, colorsToArray(state.extension.baseColors, baseKeys), encodeCovers(state.extension.removedCovers)] : null,
    items.map(item => {
      const productIndex = PRODUCTS.findIndex(product => product.id === item.productId);
      return [productIndex, item.x, item.y, item.z, item.rotation / 90, colorsToArray(item.colors, getProductColorParts(item.productId).map(part => part.id)), item.parentId === "base" ? -1 : item.parentId === "base2" ? -2 : items.findIndex(parent => parent.id === item.parentId)];
    }),
  ];
  const body = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `HM2.${body}.${checksum(body)}`;
}
export function decodeConfigWithMigration(input: string): AssemblyMigrationResult {
  if (typeof input !== "string" || input.length > MAX_CODE_LENGTH) throw new Error("搭配编号过长或格式不正确");
  const code = input.trim();
  const match = /^HM([12])\.([A-Za-z0-9_-]+)\.([A-Fa-f0-9]{8})$/.exec(code);
  if (!match) throw new Error(code.startsWith("HM") && !/^HM[12]\./.test(code) ? "暂不支持这个搭配编号版本" : "请输入完整的 HM1 或 HM2 搭配编号");
  const [, format, body, crc] = match;
  if (checksum(body) !== crc.toUpperCase()) throw new Error("搭配编号校验失败，请重新复制完整编号");
  let payload: unknown;
  try { payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/"))); }
  catch { throw new Error("搭配编号内容损坏"); }
  const legacy = format === "1";
  if (!Array.isArray(payload) || payload.length !== 6 || payload[0] !== (legacy ? 1 : 2) || (legacy ? ![2, 3].includes(payload[1]) : payload[1] !== CATALOG_VERSION)) throw new Error("搭配目录版本不兼容");
  const sourceCatalogVersion = payload[1] as 2 | 3 | 4;
  const initial = createInitialState(), baseKeys = Object.keys(initial.baseColors);
  const state: Omit<AssemblyState, "catalogVersion"> & { catalogVersion: number } = { ...initial, catalogVersion: sourceCatalogVersion, legHeight: payload[2], items: [] };
  const decodeInsert = (value: unknown) => { if (value !== 0 && value !== 1) throw new Error("平台款式无效"); return value ? "pool" as const : "lid" as const; };
  const decodeCovers = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some(n => !Number.isInteger(n) || n < 1 || n > 5) || new Set(value).size !== value.length) throw new Error("小圆盖配置无效");
    return value.map(n => `H0${n}`);
  };
  if (legacy) {
    state.baseInsert = decodeInsert(payload[3]);
    state.baseColors = arrayToColors(payload[4], baseKeys);
  } else {
    const base = payload[3], extension = payload[4];
    if (!Array.isArray(base) || base.length !== 3) throw new Error("平台数据不完整");
    state.baseInsert = decodeInsert(base[0]);
    state.baseColors = arrayToColors(base[1], baseKeys);
    state.removedCovers = decodeCovers(base[2]);
    if (extension !== null) {
      if (!Array.isArray(extension) || extension.length !== 4 || !Number.isInteger(extension[0]) || !DIRECTIONS[extension[0]]) throw new Error("第二个平台数据无效");
      state.extension = { direction: DIRECTIONS[extension[0]], baseInsert: decodeInsert(extension[1]), baseColors: arrayToColors(extension[2], baseKeys), removedCovers: decodeCovers(extension[3]) };
    }
  }
  const tuples = payload[5];
  if (!Array.isArray(tuples) || tuples.length > (state.extension ? 96 : 48)) throw new Error("搭配编号内容无效");
  for (let i = 0; i < tuples.length; i++) {
    const tuple: unknown = tuples[i];
    if (!Array.isArray(tuple) || tuple.length !== 7) throw new Error("组件数据不完整");
    const [productIndex, x, y, z, turn, colors, parent] = tuple;
    const product = legacy ? PRODUCTS.find(product => product.id === LEGACY_PRODUCT_IDS[productIndex]) : PRODUCTS[productIndex];
    if (!Number.isInteger(productIndex) || !product || !Number.isInteger(turn) || turn < 0 || turn > 3 || !Number.isInteger(parent) || parent < (legacy ? -1 : -2) || parent >= i || (parent === -2 && !state.extension)) throw new Error("组件编号、方向或依赖无效");
    const colorKeys = sourceCatalogVersion === 2 && product.id === "villa" ? ["A01", "A02", "G05", "G15"] : legacy || (Array.isArray(colors) && colors.length === product.parts.length) ? product.parts.map(part => part.id) : getProductColorParts(product.id).map(part => part.id);
    state.items.push({ id: `c${i + 1}`, productId: product.id, x, y, z, rotation: (turn * 90) as AssemblyItem["rotation"], colors: arrayToColors(colors, colorKeys), parentId: parent === -1 ? "base" : parent === -2 ? "base2" : `c${parent + 1}` });
  }
  return migrateAssembly(state, sourceCatalogVersion);
}
/** Use the migration result when the UI needs to explain an upgraded configuration. */
export function decodeConfig(input: string): AssemblyState { return decodeConfigWithMigration(input).state; }
