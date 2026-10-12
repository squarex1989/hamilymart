import { INSPIRATION_LAYOUTS, type InspirationLayout } from "../data/inspiration-layouts";
import { getPlatforms, validateAssembly, type AssemblyState, type PlatformExtension } from "./assembly";
import { COLOR_STYLES, getProductStyleColors } from "./color-styles";

export type InspirationResult =
  | { ok: true; state: AssemblyState; layout: InspirationLayout }
  | { ok: false; state: AssemblyState; reason: string };

type ShapeItem = { id: string; productId: string; parentId: string; x: number; y: number; z: number; rotation: number };
const platformIds = ["base", "base2", "base3"] as const;

function itemsForLayout(layout: InspirationLayout): ShapeItem[] {
  const ids = new Map(layout.items.map((item, index) => [item.key, `i${index + 1}`]));
  return layout.items.map(item => ({
    id: ids.get(item.key)!, productId: item.productId,
    parentId: item.parentKey ? ids.get(item.parentKey)! : platformIds[item.platform],
    x: item.position[0], y: item.position[1], z: item.position[2], rotation: item.rotation,
  }));
}

/** Shape matching ignores colors, generated IDs and rendering elevation. */
function shapeSignature(items: readonly ShapeItem[], pools: readonly boolean[], covers: readonly (readonly string[])[]): string {
  const descriptor = (item: ShapeItem) => [item.productId, item.x, item.y, item.z, item.rotation];
  const byId = new Map(items.map(item => [item.id, item]));
  return JSON.stringify([pools, covers.map(ids => [...ids].sort()), items.map(item => JSON.stringify([
    ...descriptor(item), byId.has(item.parentId) ? descriptor(byId.get(item.parentId)!) : item.parentId,
  ])).sort()]);
}

/** Recognition also works after a refresh or HM3 import, which rewrites item IDs. */
export function findInspirationLayout(state: AssemblyState): InspirationLayout | undefined {
  const platforms = getPlatforms(state);
  const shape = shapeSignature(state.items, platforms.map(platform => platform.baseInsert === "pool"), platforms.map(platform => platform.removedCovers));
  return INSPIRATION_LAYOUTS.find(layout => layout.platformCount === platforms.length
    && shapeSignature(itemsForLayout(layout), platformIds.slice(0, layout.platformCount).map((_, index) => layout.poolPlatforms.some(platform => platform === index)), platformIds.slice(0, layout.platformCount).map((_, index) => (layout.openCovers ?? []).filter(cover => cover.platform === index).map(cover => cover.coverId))) === shape);
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
          ...(pool && platform.baseInsert !== "pool" ? { B01: getProductStyleColors("pool", styleIndex).B01 } : {}),
        },
        removedCovers: (layout.openCovers ?? []).filter(cover => cover.platform === index).map(cover => cover.coverId),
      };
    });
    const extension = (index: number): PlatformExtension | null => inserts[index]
      ? { direction: "right", ...inserts[index] } : null;
    const oldItems = new Map(state.items.map(item => [item.id, item]));
    const rootOf = (id: string): string => {
      const seen = new Set<string>();
      while (oldItems.has(id) && !seen.has(id)) { seen.add(id); id = oldItems.get(id)!.parentId; }
      return id;
    };
    const used = new Set<string>();
    const items = itemsForLayout(layout).map((item, index) => {
      const root = platformIds[layout.items[index].platform];
      const candidates = state.items.filter(previous => previous.productId === item.productId && !used.has(previous.id));
      const previous = candidates.find(candidate => rootOf(candidate.parentId) === root) ?? candidates[0];
      if (previous) used.add(previous.id);
      return {
        ...item, rotation: layout.items[index].rotation,
        // Retained product types keep manual colors; new types follow the active palette.
        colors: { ...getProductStyleColors(item.productId, styleIndex), ...previous?.colors },
      };
    });
    const next = validateAssembly({
      ...state, ...inserts[0], extension: extension(1), thirdPlatform: extension(2),
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
  return applyInspirationLayout(state, styleIndex, candidates[index].id);
}
