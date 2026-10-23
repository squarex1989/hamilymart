import { MODEL_ASSET_VERSION, canonicalColorId, resolveLinkedProductColors, type ColorMap } from "../data/catalog";
import { getPlatforms, type AssemblyState } from "./assembly";
import { decodeConfig, encodeConfig } from "./config-code";
import { COLOR_STYLES, applyColorStyle, getBaseStyleColors, getProductStyleColors } from "./color-styles";

/** UI context only: never changes AssemblyState or the share-code payload. */
export interface CatalogStyleHint { styleId: string; configurationCode: string }
export interface StyledAssemblySnapshot { state: AssemblyState; styleIndex: number }

function colorsSignature(state: AssemblyState): string {
  const entries = (colors: ColorMap) => Object.entries(colors).map(([part, color]) => [part, canonicalColorId(color)]).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    getPlatforms(state).map(platform => entries(platform.baseColors)),
    state.items.map(item => entries(resolveLinkedProductColors(item.colors))),
  ]);
}

/** Recognize official colors after a refresh/import, including effective linked colors. */
export function detectColorStyle(state: AssemblyState): number {
  const signature = colorsSignature(state);
  return COLOR_STYLES.findIndex((_, index) => colorsSignature(applyColorStyle(state, index)) === signature);
}

export function createCatalogStyleHint(styleIndex: number, configurationCode: string): CatalogStyleHint {
  return { styleId: COLOR_STYLES[styleIndex]?.id ?? COLOR_STYLES[0].id, configurationCode };
}

/** A stale hint from another design must never override an imported/restored palette. */
export function restoreCatalogStyle(state: AssemblyState, configurationCode: string, storedHint: string | null = null): number {
  try {
    const hint: unknown = storedHint ? JSON.parse(storedHint) : null;
    if (hint && typeof hint === "object" && "configurationCode" in hint && typeof hint.configurationCode === "string" && (hint.configurationCode === configurationCode || encodeConfig(decodeConfig(hint.configurationCode)) === configurationCode) && "styleId" in hint) {
      const index = COLOR_STYLES.findIndex(style => style.id === hint.styleId);
      if (index >= 0) return index;
    }
  } catch { /* The optional UI preference must not prevent loading a valid design. */ }
  return Math.max(0, detectColorStyle(state));
}

export function productThumbnailUrl(productId: string, styleIndex: number): string {
  const style = COLOR_STYLES[styleIndex] ?? COLOR_STYLES[0];
  return `./thumbnails/${style.id}/${productId}.webp`;
}

export function originalProductThumbnailUrl(productId: string): string {
  return `./thumbnails/original/${productId}.webp`;
}

/** Apply the selected catalog palette only to additions, preserving every existing manual color. */
export function colorNewAdditions(previous: AssemblyState, next: AssemblyState, styleIndex: number): AssemblyState {
  const oldItems = new Set(previous.items.map(item => item.id));
  const oldPlatforms = new Map(getPlatforms(previous).map(platform => [platform.id, platform]));
  const platformColors = (id: "base" | "base2" | "base3" | "base4", colors: ColorMap, baseInsert: "lid" | "pool") => {
    const old = oldPlatforms.get(id);
    if (!old) return getBaseStyleColors(styleIndex);
    if (old.baseInsert !== "pool" && baseInsert === "pool") return { ...colors, ...getProductStyleColors("pool", styleIndex) };
    return colors;
  };
  return {
    ...next,
    baseColors: platformColors("base", next.baseColors, next.baseInsert),
    extension: next.extension ? { ...next.extension, baseColors: platformColors("base2", next.extension.baseColors, next.extension.baseInsert) } : null,
    thirdPlatform: next.thirdPlatform ? { ...next.thirdPlatform, baseColors: platformColors("base3", next.thirdPlatform.baseColors, next.thirdPlatform.baseInsert) } : null,
    fourthPlatform: next.fourthPlatform ? { ...next.fourthPlatform, baseColors: platformColors("base4", next.fourthPlatform.baseColors, next.fourthPlatform.baseInsert) } : null,
    items: next.items.map(item => oldItems.has(item.id) ? item : { ...item, colors: getProductStyleColors(item.productId, styleIndex) }),
  };
}
