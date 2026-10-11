import { getDefaultColors, type ColorId, type ColorMap } from "../data/catalog";
import { createInitialState, type AssemblyState } from "./assembly";

type SourceTone = "cream" | "pine" | "red" | "butter";
export interface ColorStyle {
  id: string;
  name: string;
  description: string;
  colors: Record<SourceTone, ColorId>;
}
/** Map original material roles, never the user's current color, so cycling is predictable. */
export const COLOR_STYLES: readonly ColorStyle[] = [
  { id: "original", name: "原色圣诞", description: "杏色、森林绿与圣诞红", colors: { cream: "cream", pine: "pine", red: "red", butter: "butter" } },
  { id: "woodland", name: "暖木小筑", description: "桃木、浅木与深棕", colors: { cream: "wood", pine: "darkwood", red: "peachwood", butter: "peachwood" } },
  { id: "strawberry", name: "草莓奶油", description: "奶油杏、柔粉与暖黄", colors: { cream: "cream", pine: "rose", red: "white", butter: "butter" } },
  { id: "sky", name: "晴空棉云", description: "云朵白、浅蓝与奶油黄", colors: { cream: "white", pine: "sky", red: "cream", butter: "butter" } },
  { id: "jade-garden", name: "琉璃花园", description: "琉璃绿、白色与柔粉", colors: { cream: "white", pine: "jade", red: "rose", butter: "butter" } },
];

/** Recolor every persisted surface, including hidden covers, without changing the assembly. */
export function applyColorStyle(state: AssemblyState, index: number): AssemblyState {
  const style = COLOR_STYLES[index];
  if (!style || !Number.isInteger(index)) throw new Error("未知配色风格");
  const recolor = (defaults: ColorMap): ColorMap => Object.fromEntries(
    Object.entries(defaults).map(([part, source]) => [part, style.colors[source as SourceTone] ?? source]),
  );
  const baseColors = () => recolor(createInitialState().baseColors);
  return {
    ...state,
    baseColors: baseColors(),
    extension: state.extension ? { ...state.extension, baseColors: baseColors() } : null,
    thirdPlatform: state.thirdPlatform ? { ...state.thirdPlatform, baseColors: baseColors() } : null,
    items: state.items.map(item => ({ ...item, colors: recolor(getDefaultColors(item.productId)) })),
  };
}
