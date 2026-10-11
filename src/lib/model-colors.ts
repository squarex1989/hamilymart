import {
  getLinkedColorPartId, getSourceColorSlot, PRIMARY_COLOR_KEYS,
  resolveLinkedProductColors, SOURCE_PART_TRIM_COLORS, SOURCE_TRIM_COLORS,
  type ColorId, type ColorMap, type ProductPart,
} from "../data/catalog";
import modelIndex from "../data/model-index.json";

/** The basin keeps its persisted main color; the lip follows it with a contrasting accent.
 * Deriving this from B01 also covers old saved designs and newly inserted pools without
 * adding a serialized color slot or making the catalog depend on transient UI state.
 */
const POOL_RIM_COLORS: Partial<Record<ColorId, ColorId>> = {
  cream: "red",
  peachwood: "darkwood",
  rose: "white",
  sky: "yellow",
  jade: "rose",
  white: "sky",
  wood: "darkwood",
  darkwood: "wood",
  gray: "white",
  black: "gray",
};

/** Shared by the live scene and offline thumbnails, including multi-color trim. */
export function getModelMaterialColor(part: ProductPart, sourcePart: string | undefined, colorKey: string | undefined, colors: ColorMap): ColorId {
  const resolved = resolveLinkedProductColors(colors);
  const tint = resolved[getLinkedColorPartId(part.id)]
    ?? (/^[LXY]0[1-4]$/.test(part.id) ? resolved.legs : undefined) ?? part.defaultColor;
  const group = modelIndex[part.id as keyof typeof modelIndex];
  const primaryKey = PRIMARY_COLOR_KEYS[part.id] ?? group?.components[0]?.colorKey;
  const slot = getSourceColorSlot(part.id, sourcePart, colorKey);
  return slot && resolved[slot] ? resolved[slot]
    : part.id === "B01" && colorKey === "ChristmasRed" ? POOL_RIM_COLORS[tint] ?? "cream"
    : !colorKey || colorKey === primaryKey ? tint
    : SOURCE_PART_TRIM_COLORS[part.id]?.[colorKey] ?? SOURCE_TRIM_COLORS[colorKey] ?? tint;
}
