import { getDefaultColors, type ColorId, type ColorMap } from "../data/catalog";
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
  { id: "original", name: "原色圣诞", description: "杏色、森林绿与圣诞红", colors: { cream: "cream", pine: "pine", red: "red", butter: "butter" } },
  { id: "woodland", name: "暖木小筑", description: "桃木、浅木与深棕", colors: { cream: "wood", pine: "darkwood", red: "peachwood", butter: "peachwood" },
    parts: { "A01-ribbon": "wood", "A01-bow": "peachwood", G15: "peachwood", G16: "peachwood", G17: "peachwood", "G03-window": "wood", "G03-trim": "darkwood", B01: "peachwood" } },
  { id: "strawberry", name: "草莓奶油", description: "奶油杏、柔粉与草莓红", colors: { cream: "cream", pine: "rose", red: "red", butter: "butter" },
    parts: { "A01-ribbon": "cream", "A01-bow": "red", G15: "pine", G16: "pine", G17: "pine", "G03-window": "butter", "G03-trim": "cream", B01: "rose" } },
  { id: "sky", name: "晴空棉云", description: "云朵白、浅蓝与奶油黄", colors: { cream: "white", pine: "sky", red: "butter", butter: "butter" },
    parts: { "A01-ribbon": "white", "A01-bow": "butter", G15: "pine", G16: "pine", G17: "pine", G03: "sky", "G03-window": "pine", "G03-trim": "white", B01: "sky" } },
  { id: "jade-garden", name: "琉璃花园", description: "琉璃绿、白色与柔粉", colors: { cream: "white", pine: "jade", red: "rose", butter: "butter" },
    parts: { "A01-ribbon": "white", "A01-bow": "butter", G15: "pine", G16: "pine", G17: "pine", G03: "jade", "G03-window": "butter", "G03-trim": "white", B01: "jade" } },
];

/** Recolor every persisted surface, including hidden covers, without changing the assembly. */
export function applyColorStyle(state: AssemblyState, index: number): AssemblyState {
  const style = COLOR_STYLES[index];
  if (!style || !Number.isInteger(index)) throw new Error("未知配色风格");
  const recolor = (defaults: ColorMap): ColorMap => Object.fromEntries(
    Object.entries(defaults).map(([part, source]) => [part, style.parts?.[part] ?? style.colors[source as SourceTone] ?? source]),
  );
  const baseColors = () => {
    const colors = recolor(createInitialState().baseColors);
    for (const cover of ["H01", "H02", "H03", "H04", "H05", "H06"]) colors[cover] = colors.P01;
    return colors;
  };
  const productColors = (productId: string) => {
    const colors = recolor(getDefaultColors(productId));
    if (productId === "villa") colors["G05-base"] = colors.A02;
    if (index > 0 && productId.startsWith("pipe-")) {
      for (const part of Object.keys(colors)) if (part.endsWith("B")) colors[part] = style.colors.pine;
    }
    return colors;
  };
  return {
    ...state,
    baseColors: baseColors(),
    extension: state.extension ? { ...state.extension, baseColors: baseColors() } : null,
    thirdPlatform: state.thirdPlatform ? { ...state.thirdPlatform, baseColors: baseColors() } : null,
    items: state.items.map(item => ({ ...item, colors: productColors(item.productId) })),
  };
}
