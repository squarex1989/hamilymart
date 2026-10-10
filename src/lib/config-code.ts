import { CATALOG_VERSION, COLORS, PRODUCTS } from "../data/catalog";
import type { ColorMap } from "../data/catalog";
import { createInitialState, validateAssembly } from "./assembly";
import type { AssemblyItem, AssemblyState } from "./assembly";

/** Full versioned configuration payload. CRC detects typos; it is NOT a database identifier or signature. */
const PREFIX = "HM1";
const MAX_CODE_LENGTH = 18000;
const colorId = (index: unknown) => {
  if (!Number.isInteger(index) || typeof index !== "number" || !COLORS[index])
    throw new Error("搭配编号包含未知颜色");
  return COLORS[index].id;
};
function checksum(text: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
function colorsToArray(colors: ColorMap, keys: string[]): number[] {
  return keys.map((key) => COLORS.findIndex((c) => c.id === colors[key]));
}
function arrayToColors(value: unknown, keys: string[]): ColorMap {
  if (!Array.isArray(value) || value.length !== keys.length)
    throw new Error("搭配编号的颜色数据不完整");
  return Object.fromEntries(keys.map((key, i) => [key, colorId(value[i])]));
}
function sortedItems(state: AssemblyState): AssemblyItem[] {
  const children = (parent: string): AssemblyItem[] =>
    state.items
      .filter((i) => i.parentId === parent)
      .sort((a, b) => {
        const descriptor = (i: AssemblyItem) =>
          JSON.stringify([
            i.productId,
            i.x,
            i.y,
            i.z,
            i.rotation,
            Object.entries(i.colors).sort(),
          ]);
        const left = descriptor(a),
          right = descriptor(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
  const result: AssemblyItem[] = [];
  const walk = (parent: string) => {
    for (const item of children(parent)) {
      result.push(item);
      walk(item.id);
    }
  };
  walk("base");
  return result;
}
export function encodeConfig(value: AssemblyState): string {
  const state = validateAssembly(value);
  const items = sortedItems(state);
  const baseKeys = Object.keys(createInitialState().baseColors);
  const payload = [
    1,
    CATALOG_VERSION,
    state.legHeight,
    state.baseInsert === "pool" ? 1 : 0,
    colorsToArray(state.baseColors, baseKeys),
    items.map((item) => {
      const productIndex = PRODUCTS.findIndex((p) => p.id === item.productId);
      return [
        productIndex,
        item.x,
        item.y,
        item.z,
        item.rotation / 90,
        colorsToArray(
          item.colors,
          PRODUCTS[productIndex].parts.map((p) => p.id),
        ),
        item.parentId === "base"
          ? -1
          : items.findIndex((p) => p.id === item.parentId),
      ];
    }),
  ];
  // Payload contains only ASCII numeric data; browser btoa and Node btoa behave identically.
  const body = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${PREFIX}.${body}.${checksum(body)}`;
}
export function decodeConfig(input: string): AssemblyState {
  if (typeof input !== "string" || input.length > MAX_CODE_LENGTH)
    throw new Error("搭配编号过长或格式不正确");
  const code = input.trim();
  const match = /^HM1\.([A-Za-z0-9_-]+)\.([A-Fa-f0-9]{8})$/.exec(code);
  if (!match)
    throw new Error(
      code.startsWith("HM") && !code.startsWith("HM1.")
        ? "暂不支持这个搭配编号版本"
        : "请输入完整的 HM1 搭配编号",
    );
  const [, body, crc] = match;
  if (checksum(body) !== crc.toUpperCase())
    throw new Error("搭配编号校验失败，请重新复制完整编号");
  let payload: unknown;
  try {
    payload = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    throw new Error("搭配编号内容损坏");
  }
  if (
    !Array.isArray(payload) ||
    payload.length !== 6 ||
    payload[0] !== 1 ||
    payload[1] !== CATALOG_VERSION
  )
    throw new Error("搭配目录版本不兼容");
  const [, , legHeight, insert, baseColors, tuples] = payload;
  if (
    (insert !== 0 && insert !== 1) ||
    !Array.isArray(tuples) ||
    tuples.length > 48
  )
    throw new Error("搭配编号内容无效");
  const initial = createInitialState();
  const state: AssemblyState = {
    ...initial,
    legHeight,
    baseInsert: insert ? "pool" : "lid",
    baseColors: arrayToColors(baseColors, Object.keys(initial.baseColors)),
    items: [],
  };
  for (let i = 0; i < tuples.length; i++) {
    const tuple: unknown = tuples[i];
    if (!Array.isArray(tuple) || tuple.length !== 7)
      throw new Error("组件数据不完整");
    const [productIndex, x, y, z, turn, colors, parent] = tuple;
    if (
      !Number.isInteger(productIndex) ||
      !PRODUCTS[productIndex] ||
      !Number.isInteger(turn) ||
      turn < 0 ||
      turn > 3 ||
      !Number.isInteger(parent) ||
      parent < -1 ||
      parent >= i
    )
      throw new Error("组件编号、方向或依赖无效");
    const product = PRODUCTS[productIndex];
    state.items.push({
      id: `c${i + 1}`,
      productId: product.id,
      x,
      y,
      z,
      rotation: (turn * 90) as AssemblyItem["rotation"],
      colors: arrayToColors(
        colors,
        product.parts.map((p) => p.id),
      ),
      parentId: parent === -1 ? "base" : `c${parent + 1}`,
    });
  }
  return validateAssembly(state);
}
