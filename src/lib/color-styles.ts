import { getDefaultColors, resolveLinkedProductColors, type ColorId, type ColorMap } from "../data/catalog";
import { createInitialState, type AssemblyState } from "./assembly";

type SourceTone = "cream" | "pine" | "red" | "butter";
export interface ColorStyle {
  id: string;
  name: string;
  description: string;
  colors: Record<SourceTone, ColorId>;
  /** Adjacent surfaces can need different colors despite sharing a source material. */
  parts?: ColorMap;
}
/** Map original material roles, never the user's current color, so cycling is predictable. */
export const COLOR_STYLES: readonly ColorStyle[] = [
  { id: "original", name: "圣诞礼物", description: "杏色、森林绿与圣诞红", colors: { cream: "cream", pine: "pine", red: "red", butter: "butter" } },
  { id: "woodland", name: "暖木小筑", description: "桃木、浅木与深棕", colors: { cream: "wood", pine: "darkwood", red: "peachwood", butter: "peachwood" },
    parts: { "A01-ribbon": "wood", "A01-bow": "peachwood", G15: "peachwood", G16: "peachwood", G17: "peachwood", "G03-window": "wood", "G03-trim": "darkwood", B01: "peachwood" } },
  { id: "strawberry", name: "草莓奶油", description: "奶油杏、柔粉与暖黄点缀", colors: { cream: "cream", pine: "rose", red: "red", butter: "yellow" },
    parts: { "A01-ribbon": "white", "A01-bow": "yellow", G15: "rose", "G03-window": "yellow", "G03-trim": "cream", B01: "rose", LHR: "cream" } },
  { id: "sky", name: "晴空棉云", description: "云朵白、浅蓝与明亮暖黄", colors: { cream: "white", pine: "sky", red: "yellow", butter: "yellow" },
    parts: { "A01-ribbon": "cream", "A01-bow": "yellow", G15: "gray", G03: "sky", "G03-window": "yellow", "G03-trim": "white", B01: "sky", LHR: "white" } },
  { id: "jade-garden", name: "琉璃花园", description: "琉璃绿、柔粉与暖黄花色", colors: { cream: "white", pine: "jade", red: "rose", butter: "yellow" },
    parts: { "A01-ribbon": "white", "A01-bow": "yellow", G15: "jade", G03: "jade", "G03-window": "yellow", "G03-trim": "white", B01: "jade", LHR: "rose" } },
];

function getStyle(index: number): ColorStyle {
  const style = COLOR_STYLES[index];
  if (!style || !Number.isInteger(index)) throw new Error("未知配色风格");
  return style;
}
function recolor(defaults: ColorMap, style: ColorStyle): ColorMap {
  return Object.fromEntries(
    Object.entries(defaults).map(([part, source]) => [part, style.parts?.[part] ?? style.colors[source as SourceTone] ?? source]),
  );
}
/** Shared by the live assembly, newly added platforms and catalog previews. */
export function getBaseStyleColors(index: number): ColorMap {
  const colors = recolor(createInitialState().baseColors, getStyle(index));
  for (const cover of ["H01", "H02", "H03", "H04", "H05", "H06"]) colors[cover] = colors.P01;
  return colors;
}
/** Pure product palette for previews and placement; always starts from source defaults. */
export function getProductStyleColors(productId: string, index: number): ColorMap {
  const style = getStyle(index);
  const colors = recolor(getDefaultColors(productId), style);
  if (productId === "villa") colors["G05-base"] = colors.A02;
  if (index > 0 && productId.startsWith("pipe-")) {
    for (const part of Object.keys(colors)) if (part.endsWith("B")) colors[part] = style.colors.pine;
  }
  return resolveLinkedProductColors(colors);
}
/** Recolor every persisted surface, including hidden covers, without changing the assembly. */
export function applyColorStyle(state: AssemblyState, index: number): AssemblyState {
  return {
    ...state,
    baseColors: getBaseStyleColors(index),
    extension: state.extension ? { ...state.extension, baseColors: getBaseStyleColors(index) } : null,
    thirdPlatform: state.thirdPlatform ? { ...state.thirdPlatform, baseColors: getBaseStyleColors(index) } : null,
    items: state.items.map(item => ({ ...item, colors: getProductStyleColors(item.productId, index) })),
  };
}
