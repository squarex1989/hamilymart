import { hasReversiblePanel } from '../data/reversible-panels';
import { INSPIRATION_LAYOUTS, type InspirationLayout } from "../data/inspiration-layouts";
import { getPlatforms, validateAssembly, type AssemblyState, type PlatformExtension, type PlatformView } from "./assembly";
import { COLOR_STYLES, getProductStyleColors } from "./color-styles";

export type InspirationResult =
  | { ok: true; state: AssemblyState; layout: InspirationLayout }
  | { ok: false; state: AssemblyState; reason: string };

type ShapeItem = { doorSide?: "left" | "right"; id: string; productId: string; parentId: string; x: number; y: number; z: number; rotation: 0 | 90 | 180 | 270 };
const platformIds = ["base", "base2", "base3", "base4"] as const;

/** Low platforms omit downward inserts only while generating an official design.
 * Manual designs and height changes keep their existing components untouched. */
function itemsForLayout(layout: InspirationLayout, platforms: PlatformView[]): ShapeItem[] {
  const included = layout.items.filter(item => item.productId !== "pipe-down" || 100 + platforms[item.platform].elevation >= 50);
  const ids = new Map(included.map((item, index) => [item.key, `i${index + 1}`]));
  return included.map(item => {
    const platform = platforms[item.platform];
    return {
      id: ids.get(item.key)!, productId: item.productId === "milk-house-left" && hasReversiblePanel("milk-house-right") ? "milk-house-right" : item.productId,
      ...(item.productId === "milk-house-left" && hasReversiblePanel("milk-house-right") ? { doorSide: "left" as const } : {}),
      parentId: item.parentKey ? ids.get(item.parentKey)! : platform.id,
      x: item.position[0] + platform.x - item.platform * 300,
      y: item.position[1] + platform.y, z: item.position[2], rotation: item.rotation,
    };
  });
}

/** Shape matching ignores colors, generated IDs and rendering elevation. */
function shapeSignature(items: readonly ShapeItem[], pools: readonly boolean[], covers: readonly (readonly string[])[]): string {
  const descriptor = (item: ShapeItem) => [item.productId, item.x, item.y, item.z, item.rotation, item.doorSide ?? "right"];
  const byId = new Map(items.map(item => [item.id, item]));
  return JSON.stringify([pools, covers.map(ids => [...ids].sort()), items.map(item => JSON.stringify([
    ...descriptor(item), byId.has(item.parentId) ? descriptor(byId.get(item.parentId)!) : item.parentId,
  ])).sort()]);
}

/** Recognition also works after a refresh or HM3 import, which rewrites item IDs. */
export function findInspirationLayout(state: AssemblyState): InspirationLayout | undefined {
  const platforms = getPlatforms(state);
  const shape = shapeSignature(state.items, platforms.map(platform => platform.baseInsert === "pool"), platforms.map(platform => platform.id === "base" ? state.removedCovers : platform.id === "base2" ? state.extension!.removedCovers : platform.id === "base3" ? state.thirdPlatform!.removedCovers : state.fourthPlatform!.removedCovers));
  return INSPIRATION_LAYOUTS.find(layout => layout.platformCount === platforms.length
    && shapeSignature(itemsForLayout(layout, platforms), platformIds.slice(0, layout.platformCount).map((_, index) => layout.poolPlatforms.some(platform => platform === index)), platformIds.slice(0, layout.platformCount).map((_, index) => (layout.openCovers ?? []).filter(cover => cover.platform === index).map(cover => cover.coverId))) === shape);
}

/** Authored geometry is independent of palette and support height; replace atomically. */
export function applyInspirationLayout(state: AssemblyState, styleIndex: number, layoutId: string): InspirationResult {
  const layout = INSPIRATION_LAYOUTS.find(candidate => candidate.id === layoutId);
  if (!layout || layout.platformCount !== getPlatforms(state).length)
    return { ok: false, state, reason: "这套搭配与当前平台数量不匹配" };
  if (!Number.isInteger(styleIndex) || !COLOR_STYLES[styleIndex])
    return { ok: false, state, reason: "当前配色方案无效" };
  try {
    const platforms = getPlatforms(state);
    const inserts = platforms.map((platform, index) => {
      const pool = layout.poolPlatforms.some(target => target === index);
      return {
        baseInsert: pool ? "pool" as const : "lid" as const,
        baseColors: {
          ...platform.baseColors,
          ...(pool && platform.baseInsert !== "pool" ? getProductStyleColors("pool", styleIndex) : {}),
        },
        removedCovers: (layout.openCovers ?? []).filter(cover => cover.platform === index).map(cover => cover.coverId),
      };
    });
    const settings = new Map(platforms.map((platform, index) => [platform.id, inserts[index]]));
    const extension = (id: "base2" | "base3" | "base4", previous: PlatformExtension | null): PlatformExtension | null => previous
      ? { ...previous, ...settings.get(id) } : null;
    const oldItems = new Map(state.items.map(item => [item.id, item]));
    const rootOf = (id: string): string => {
      const seen = new Set<string>();
      while (oldItems.has(id) && !seen.has(id)) { seen.add(id); id = oldItems.get(id)!.parentId; }
      return id;
    };
    const used = new Set<string>();
    const shape = itemsForLayout(layout, platforms);
    const newItems = new Map(shape.map(item => [item.id, item]));
    const items = shape.map(item => {
      let root = item.parentId;
      while (newItems.has(root)) root = newItems.get(root)!.parentId;
      const candidates = state.items.filter(previous => previous.productId === item.productId && !used.has(previous.id));
      const previous = candidates.find(candidate => rootOf(candidate.parentId) === root) ?? candidates[0];
      if (previous) used.add(previous.id);
      return {
        ...item,
        // Retained product types keep manual colors; new types follow the active palette.
        colors: { ...getProductStyleColors(item.productId, styleIndex), ...previous?.colors },
        // Door placement belongs to the preset geometry; colors are retained above.
      };
    });
    const next = validateAssembly({
      ...state, ...settings.get("base"), extension: extension("base2", state.extension), thirdPlatform: extension("base3", state.thirdPlatform), fourthPlatform: extension("base4", state.fourthPlatform),
      bedding: { ...state.bedding }, items,
    });
    return { ok: true, state: next, layout };
  } catch {
    return { ok: false, state, reason: "这套搭配暂时无法应用，当前设计已保留" };
  }
}

/** Pick among the matching five without repeating the current or previous layout. */
export function createInspiredDesign(
  state: AssemblyState, styleIndex: number, previousId?: string, random: () => number = Math.random,
): InspirationResult {
  const currentId = findInspirationLayout(state)?.id;
  const candidates = INSPIRATION_LAYOUTS.filter(layout => layout.platformCount === getPlatforms(state).length
    && layout.id !== previousId && layout.id !== currentId);
  if (!candidates.length) return { ok: false, state, reason: "当前平台数量没有可用搭配" };
  const sample = random();
  const index = Math.floor(Math.max(0, Math.min(.999999999, Number.isFinite(sample) ? sample : 0)) * candidates.length);
  // Mixed heights can invalidate a cross-platform bridge in a particular layout.
  // Try the other authored layouts atomically instead of changing support heights.
  for (let offset = 0; offset < candidates.length; offset++) {
    const result = applyInspirationLayout(state, styleIndex, candidates[(index + offset) % candidates.length].id);
    if (result.ok) return result;
  }
  return { ok: false, state, reason: "当前平台高度或间距暂时没有合适的灵感搭配，请手动搭建" };
}
