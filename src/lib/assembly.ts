import { HAMSTER_VARIANTS } from "../data/hamsters";
import modelIndex from "../data/model-index.json";
import legacyCatalog6 from "../data/legacy-catalog-6.json";
import {
  BASE_PRODUCT,
  CATALOG_VERSION,
  COLOR_IDS,
  P01_TOP_XY, H06_TOP_XY,
  SNAP_DISTANCE_MM,
  getBaseParts,
  getDefaultColors,
  getProduct,
  getProductColorParts,
  resolveLinkedProductColors,
} from "../data/catalog";
import type {
  Bounds,
  ColorId,
  ColorMap,
  Product,
  Rotation,
  Vec3,
} from "../data/catalog";

export interface AssemblyItem {
  id: string;
  productId: string;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
  colors: ColorMap;
  parentId: string;
}
export interface AssemblyState {
  version: 1;
  catalogVersion: typeof CATALOG_VERSION;
  legHeight: 0 | 100 | 200 | 300;
  removedCovers: string[];
  extension: PlatformExtension | null;
  thirdPlatform: PlatformExtension | null;
  bedding: Bedding;
  hamster: string | null;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  items: AssemblyItem[];
}
export type Bedding = { mode: "none"; depth: 0 } | { mode: "thin"; depth: 50 } | { mode: "thick"; depth: 100 | 200 | 300 };
export type PlatformDirection = "left" | "right" | "front" | "back";
export type PlatformId = "base" | "base2" | "base3";
export interface PlatformExtension {
  direction: PlatformDirection;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  removedCovers: string[];
}
export interface PlatformView {
  id: PlatformId;
  x: number;
  y: number;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  removedCovers: string[];
}
export type ActionResult =
  | { ok: true; state: AssemblyState; item?: AssemblyItem }
  | { ok: false; state: AssemblyState; reason: string };
export const PLATFORM_OFFSETS: Record<PlatformDirection, [number, number]> = {
  left: [-300, 0], right: [300, 0], front: [0, -300], back: [0, 300],
};
export const REMOVABLE_COVERS = ["H01", "H02", "H03", "H04", "H05"] as const;
export interface Placement {
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
  parentId: string;
  key: string;
  magnetCount: number;
}
export type PlaceResult =
  | { ok: true; state: AssemblyState; item: AssemblyItem }
  | { ok: false; state: AssemblyState; reason: string };
export interface OrderLine {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  parts: string[];
  colors: ColorMap;
}
const EPS = 0.015;
const close = (a: number, b: number) => Math.abs(a - b) < EPS;
const round = (v: number) => Math.round(v * 1000) / 1000;
const samePoint = (a: Vec3, b: Vec3) => a.every((v, i) => close(v, b[i]));
export function createInitialState(): AssemblyState {
  return {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    legHeight: 100,
    removedCovers: [],
    extension: null,
    thirdPlatform: null,
    bedding: { mode: "thin", depth: 50 },
    hamster: null,
    baseInsert: "lid",
    baseColors: {
      P01: "cream",
      legs: "pine",
      H01: "cream",
      H02: "cream",
      H03: "cream",
      H04: "cream",
      H05: "cream",
      H06: "cream",
      B01: "cream",
    },
    items: [],
  };
}
export function getPlatforms(state: AssemblyState): PlatformView[] {
  const result: PlatformView[] = [{ id: "base", x: 0, y: 0, baseInsert: state.baseInsert, baseColors: state.baseColors, removedCovers: state.removedCovers }];
  if (state.extension) {
    const [x, y] = PLATFORM_OFFSETS[state.extension.direction];
    result.push({ id: "base2", x, y, baseInsert: state.extension.baseInsert, baseColors: state.extension.baseColors, removedCovers: state.extension.removedCovers });
  }
  if (state.thirdPlatform) result.push({ id: "base3", x: 600, y: 0, baseInsert: state.thirdPlatform.baseInsert, baseColors: state.thirdPlatform.baseColors, removedCovers: state.thirdPlatform.removedCovers });
  return result;
}
export function getDisplayElevation(state: AssemblyState): number {
  return state.legHeight === 0 ? state.bedding.depth - 100 : state.legHeight - 100;
}
export function rotateVector([x, y, z]: Vec3, rotation: Rotation): Vec3 {
  switch (rotation) {
    case 90:
      return [-y, x, z];
    case 180:
      return [-x, -y, z];
    case 270:
      return [y, -x, z];
    default:
      return [x, y, z];
  }
}
export function transformPoint(
  point: Vec3,
  product: Product,
  item: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">,
): Vec3 {
  const p = rotateVector(
    point.map((v, i) => v - product.origin[i]) as Vec3,
    item.rotation,
  );
  return [round(p[0] + item.x), round(p[1] + item.y), round(p[2] + item.z)];
}
function transformBox(
  box: Bounds,
  product: Product,
  item: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">,
): Bounds {
  const a = transformPoint(box.slice(0, 3) as Vec3, product, item);
  const b = transformPoint(box.slice(3, 6) as Vec3, product, item);
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
}
export function getItemBounds(item: AssemblyItem, product = getProduct(item.productId)): Bounds[] {
  return product.collisionBoxes.map((box) => transformBox(box, product, item));
}
// V15 source G05 triangles clipped at each Y interval, rounded outwards to
// 0.001 mm. These enclose the full staircase without treating the empty space
// above its lower steps as solid. Keep the broad catalog boxes for footprints.
const VILLA_STAIR_COLLISION_SLICES: Bounds[] = [
  [219, 82, 110, 300, 90, 120.244],
  [219, 90, 110, 300, 100, 129.468],
  [219, 100, 120.32, 300, 110, 140.178],
  [219, 110, 131.185, 300, 120, 150.419],
  [219, 120, 142.049, 300, 130, 160.917],
  [219, 130, 152.913, 300, 140, 172.034],
  [219, 140, 163.777, 300, 150, 183.523],
  [219, 150, 174.641, 300, 160, 194.695],
  [219, 160, 185.506, 300, 170, 201.302],
  [219, 170, 192.804, 300, 180, 201.424],
  [219, 180, 194, 300, 190, 200],
  [219, 190, 192, 300, 194, 200],
];
// Frozen V13 geometry validates catalog 2–6 saves before the V15 upgrade.
// In particular, do not validate historical collision with today's narrower deck.
const LEGACY_VILLA_COLLISION_BOXES: Bounds[] = [
  ...(legacyCatalog6.villaSolidBounds as Bounds[]),
  ...VILLA_STAIR_COLLISION_SLICES.slice(0, -1),
  [219, 190, 194.6, 300, 194, 200],
];
type CollisionProduct = Product & { preciseCollisionBoxes?: Bounds[] };
const VILLA_COLLISION_BOXES: Bounds[] = [
  ...(["A01", "A02", "G15", "G16", "G17", "W01", "W02"] as const)
    .map(id => modelIndex[id].bounds as Bounds),
  ...VILLA_STAIR_COLLISION_SLICES,
];
function solidCollisionBounds(product: Product, item: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">): Bounds[] {
  const local = (product as CollisionProduct).preciseCollisionBoxes ?? (product.id === "villa" ? VILLA_COLLISION_BOXES : product.collisionBoxes);
  return local.map(box => transformBox(box, product, item));
}
function overlap(a: Bounds, b: Bounds): boolean {
  return [0, 1, 2].every(
    (i) => Math.min(a[i + 3], b[i + 3]) - Math.max(a[i], b[i]) > EPS,
  );
}
function descendants(state: AssemblyState, id?: string): Set<string> {
  const result = new Set<string>(id ? [id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of state.items)
      if (result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
  }
  return result;
}
interface Surface {
  parentId: string;
  parentProduct: string;
  points: Vec3[];
  bounds: Bounds;
  id: string;
  sourceParts?: ("P01" | "H06")[];
}
function receiverMatches(magnet: Vec3, receiver: Vec3, product: Product, surface: Surface): boolean {
  const offset = surface.parentProduct === "base" ? product.baseMagnetOffsetMm ?? 0 : 0;
  return offset > 0
    ? close(magnet[2], receiver[2]) && Math.hypot(magnet[0] - receiver[0], magnet[1] - receiver[1]) <= offset + EPS
    : samePoint(magnet, receiver);
}
/** Return distinct occupied steel receivers, with no receiver counted twice. */
function matchedReceivers(magnets: Vec3[], product: Product, surface: Surface): Set<number> {
  const matches = new Set<number>();
  for (const magnet of magnets) {
    const index = surface.points.findIndex((receiver, i) => !matches.has(i) && receiverMatches(magnet, receiver, product, surface));
    if (index >= 0) matches.add(index);
  }
  return matches;
}
type ProductLookup = (id: string) => CollisionProduct;
function getSurfaces(state: AssemblyState, excluded: Set<string>, lookup: ProductLookup = getProduct): Surface[] {
  const surfaces: Surface[] = getPlatforms(state).map(platform => {
    const receivers = [...P01_TOP_XY.map(point => ({ point, sourcePart: "P01" as const })), ...(platform.baseInsert === "lid" ? H06_TOP_XY.map(point => ({ point, sourcePart: "H06" as const })) : [])];
    return { id: `platform-${platform.id}`, parentId: platform.id, parentProduct: "base", points: receivers.map(({ point: [x, y] }) => [x + platform.x, y + platform.y, 110] as Vec3), sourceParts: receivers.map(receiver => receiver.sourcePart),
      bounds: [platform.x, platform.y, 110, platform.x + 300, platform.y + 300, 110] as Bounds };
  });
  for (const item of state.items) {
    if (excluded.has(item.id)) continue;
    const product = lookup(item.productId);
    for (const surface of product.surfaces ?? [])
      surfaces.push({
        id: surface.id,
        parentId: item.id,
        parentProduct: item.productId,
        points: surface.points.map((p) => transformPoint(p, product, item)),
        bounds: transformBox(surface.bounds, product, item),
      });
  }
  return surfaces;
}
/** Visible magnet markers include only source-backed upward interfaces. */
export function getMagnetPoints(
  state: AssemblyState,
): { point: Vec3; parentId: string; sourcePart?: "P01" | "H06" }[] {
  return getSurfaces(state, new Set()).flatMap((s) =>
    s.points.map((point, index) => ({ point, parentId: s.parentId, ...(s.sourceParts ? { sourcePart: s.sourceParts[index] } : {}) })),
  );
}
function facesFor(
  product: Product,
  item: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">,
) {
  return (product.pipeFaces ?? []).map((face) => ({
    center: transformPoint(face.center, product, item),
    normal: rotateVector(face.normal, item.rotation),
  }));
}
function compatiblePlacement(
  state: AssemblyState,
  product: Product,
  placement: Placement,
  surface: Surface,
  excluded: Set<string>,
  lookup: ProductLookup = getProduct,
): boolean {
  const boxes = product.collisionBoxes.map((b) =>
    transformBox(b, product, placement),
  );
  const overhang = surface.parentProduct === "base" ? 6 : 2;
  const allowSingleContactOverhang = product.minimumMagnetMatches === 1 && (surface.parentProduct === "base" || surface.parentProduct === "l-house");
  // Bounds describe reserved assembly space, not mesh boolean collision. Conservative on purpose.
  if (
    !allowSingleContactOverhang && boxes.some(
      (b) =>
        b[0] < surface.bounds[0] - overhang ||
        b[1] < surface.bounds[1] - overhang ||
        b[3] > surface.bounds[3] + overhang ||
        b[4] > surface.bounds[4] + overhang,
    )
  )
    return false;
  const hostPlatform = getPlatforms(state).find(p => p.id === placement.parentId);
  if (hostPlatform?.baseInsert === "pool") {
    const centerX = hostPlatform.x + 100, centerY = hostPlatform.y + 100;
    // Reserve the real opening/upper rim, not the whole square around the circular basin.
    if (
      boxes.some(
        (b) =>
          b[2] < 113.65 &&
          b[5] > 110 &&
          Math.hypot(
            Math.max(b[0], Math.min(centerX, b[3])) - centerX,
            Math.max(b[1], Math.min(centerY, b[4])) - centerY,
          ) <
            78 - EPS,
      )
    )
      return false;
  }
  const magnets = product.bottomMagnets.map((m) =>
    transformPoint(m, product, placement),
  );
  const receivers = matchedReceivers(magnets, product, surface);
  const faces = facesFor(product, placement);
  for (const other of state.items) {
    if (excluded.has(other.id) || other.id === placement.parentId) continue;
    const otherProduct = lookup(other.productId);
    if (other.parentId === placement.parentId) {
      const otherMagnets = otherProduct.bottomMagnets.map((m) =>
        transformPoint(m, otherProduct, other),
      );
      const otherReceivers = matchedReceivers(otherMagnets, otherProduct, surface);
      if ([...receivers].some(index => otherReceivers.has(index)) || magnets.some((m) => otherMagnets.some((n) => samePoint(m, n))))
        return false;
    }
    if (boxes.some((a) => getItemBounds(other, otherProduct).some((b) => overlap(a, b)))) {
      const preciseBoxes = solidCollisionBounds(product, placement);
      const otherBoxes = solidCollisionBounds(otherProduct, other);
      if (preciseBoxes.some(a => otherBoxes.some(b => overlap(a, b)))) return false;
    }
    for (const a of faces)
      for (const b of facesFor(otherProduct, other)) {
        if (samePoint(a.center, b.center)) {
          const opposing = a.normal.every((n, i) => close(n, -b.normal[i]));
          // Revised supports have no side magnets; adjacent end faces only need to oppose.
          if (!opposing) return false;
        }
      }
  }
  return true;
}
/** Enumerates transforms meeting each product’s source-backed contact minimum. */
export function getPlacements(
  state: AssemblyState,
  productId: string,
  rotation: Rotation = 0,
  ignoreId?: string,
  lookup: ProductLookup = getProduct,
): Placement[] {
  if (![0, 90, 180, 270].includes(rotation)) return [];
  const product = lookup(productId);
  const excluded = descendants(state, ignoreId);
  const local = product.bottomMagnets.map((p) =>
    rotateVector(p.map((v, i) => v - product.origin[i]) as Vec3, rotation),
  );
  if (!local.length) return [];
  const candidates: Placement[] = [];
  for (const surface of getSurfaces(state, excluded, lookup)) {
    if (
      product.allowedParents &&
      !product.allowedParents.includes(surface.parentProduct)
    )
      continue;
    const parentRotation =
      state.items.find((i) => i.id === surface.parentId)?.rotation ?? 0;
    if (
      (surface.parentProduct !== "base" && !(product.minimumMagnetMatches === 1 && surface.parentProduct === "l-house")) &&
      product.allowedRelativeRotations &&
      !product.allowedRelativeRotations.includes(
        ((rotation - parentRotation + 360) % 360) as Rotation,
      )
    )
      continue;
    // Keep exact placements, including all existing saves and four-point upper-floor fits.
    const shifts: Vec3[] = surface.points.flatMap(anchor => local.map(foot =>
      anchor.map((v, i) => round(v - foot[i])) as Vec3));
    const offset = surface.parentProduct === "base" ? product.baseMagnetOffsetMm ?? 0 : 0;
    if (offset > 0) {
      // Balance a proven finite mismatch across two different magnets/steel discs.
      // Only pair midpoints are offered, not arbitrary placements near a magnet.
      for (let i = 0; i < local.length; i++) for (let j = i + 1; j < local.length; j++) {
        const [a, b] = [local[i], local[j]];
        for (const [p, first] of surface.points.entries()) for (const [q, second] of surface.points.entries()) {
          if (p === q || !close(second[2] - first[2], b[2] - a[2])) continue;
          const dx = second[0] - first[0] - (b[0] - a[0]);
          const dy = second[1] - first[1] - (b[1] - a[1]);
          if (Math.hypot(dx, dy) > 2 * offset + EPS) continue;
          shifts.push(first.map((v, axis) => round((v + second[axis] - a[axis] - b[axis]) / 2)) as Vec3);
        }
      }
    }
    // Every foot may be a matching anchor; a two-magnet fit need not involve the first foot.
    const seen = new Set<string>();
    for (const shift of shifts) {
      const key = `${surface.parentId}:${shift.join(",")}:${rotation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const magnetCount = matchedReceivers(local.map(m => m.map((v, i) => v + shift[i]) as Vec3), product, surface).size;
      if (magnetCount < (product.minimumMagnetMatches ?? 2)) continue;
      const placement: Placement = {
        x: shift[0],
        y: shift[1],
        z: shift[2],
        rotation,
        parentId: surface.parentId,
        key,
        magnetCount,
      };
      if (
        compatiblePlacement(state, product, placement, surface, excluded, lookup) &&
        !candidates.some((p) => p.key === placement.key)
      )
        candidates.push(placement);
    }
  }
  return candidates.sort(
    (a, b) =>
      a.z - b.z ||
      a.y - b.y ||
      a.x - b.x ||
      a.parentId.localeCompare(b.parentId),
  );
}
function normalizeColors(
  value: unknown,
  keys: string[],
  defaults: ColorMap,
): ColorMap {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("颜色配置格式不正确");
  const input = value as Record<string, unknown>;
  for (const [key, color] of Object.entries(input))
    if (
      !keys.includes(key) ||
      typeof color !== "string" ||
      !COLOR_IDS.has(color)
    )
      throw new Error("包含未知颜色或零件");
  return Object.fromEntries(
    keys.map((key) => [key, (input[key] ?? defaults[key]) as ColorId]),
  );
}
function nextId(state: AssemblyState): string {
  let n = 1;
  while (state.items.some((i) => i.id === `i${n}`)) n++;
  return `i${n}`;
}
function moveFamily(
  state: AssemblyState,
  previous: AssemblyItem,
  next: AssemblyItem,
): AssemblyState {
  const family = descendants(state, previous.id);
  const delta = ((next.rotation - previous.rotation + 360) % 360) as Rotation;
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.id === previous.id) return next;
      if (!family.has(item.id)) return item;
      const local = rotateVector(
        [item.x - previous.x, item.y - previous.y, item.z - previous.z],
        delta,
      );
      return {
        ...item,
        x: round(next.x + local[0]),
        y: round(next.y + local[1]),
        z: round(next.z + local[2]),
        rotation: ((item.rotation + delta) % 360) as Rotation,
      };
    }),
  };
}
export function tryPlace(
  state: AssemblyState,
  productId: string,
  point: { x: number; y: number; z?: number },
  rotation: Rotation = 0,
  colors: ColorMap = {},
  ignoreId?: string,
): PlaceResult {
  try {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      (point.z !== undefined && !Number.isFinite(point.z))
    )
      throw new Error("放置坐标无效");
    if (!ignoreId && state.items.length >= (getPlatforms(state).length * 48))
      throw new Error("组件数量已达到上限");
    const candidates = getPlacements(state, productId, rotation, ignoreId);
    const distance = (p: Placement) =>
      Math.hypot(
        p.x - point.x,
        p.y - point.y,
        point.z === undefined ? 0 : p.z - point.z,
      );
    const nearest = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (!nearest || distance(nearest) > SNAP_DISTANCE_MM)
      throw new Error("不匹配：请靠近可用磁吸位，避开已有组件");
    const product = getProduct(productId);
    const previous = ignoreId
      ? state.items.find((i) => i.id === ignoreId)
      : undefined;
    if (ignoreId && (!previous || previous.productId !== productId))
      throw new Error("找不到要移动的组件");
    const { key: _key, magnetCount: _count, ...position } = nearest;
    const item: AssemblyItem = {
      id: ignoreId ?? nextId(state),
      productId,
      ...position,
      colors: normalizeColors(
        colors,
        getProductColorParts(productId).map((p) => p.id),
        getDefaultColors(productId),
      ),
    };
    const next = previous
      ? moveFamily(state, previous, item)
      : { ...state, items: [...state.items, item] };
    const validated = validateAssembly(next);
    return {
      ok: true,
      state: validated,
      item: validated.items.find((i) => i.id === item.id)!,
    };
  } catch (error) {
    return {
      ok: false,
      state,
      reason: error instanceof Error ? error.message : "装配不匹配",
    };
  }
}
export function removeItem(state: AssemblyState, id: string): AssemblyState {
  const family = descendants(state, id);
  return { ...state, items: state.items.filter((i) => !family.has(i.id)) };
}
export function rotateItem(
  state: AssemblyState,
  id: string,
  step: Rotation = 90,
): PlaceResult {
  const previous = state.items.find((i) => i.id === id);
  if (!previous) return { ok: false, state, reason: "未找到组件" };
  const rotation = ((previous.rotation + step) % 360) as Rotation;
  // A source pivot may not be the magnetic pattern's center. Keep the current
  // position when possible, otherwise resnap on the same supporting surface.
  const candidates = getPlacements(state, previous.productId, rotation, id)
    .filter(candidate => candidate.parentId === previous.parentId && close(candidate.z, previous.z))
    .sort((a, b) => Math.hypot(a.x - previous.x, a.y - previous.y) - Math.hypot(b.x - previous.x, b.y - previous.y) || a.key.localeCompare(b.key));
  for (const candidate of candidates) {
    const result = tryPlace(state, previous.productId, candidate, rotation, previous.colors, id);
    if (result.ok && result.item.parentId === previous.parentId && close(result.item.z, previous.z)) return result;
    // Parent-only placement can pass while a carried descendant hits another
    // component. Try the next nearest candidate before refusing the whole turn.
  }
  if (previous.productId === "villa") {
    const product = getProduct("villa"), deck = modelIndex.A02.bounds as Bounds;
    const freeCandidates = getPlacements({ ...state, items: [] }, "villa", rotation)
      .filter(candidate => candidate.parentId === previous.parentId && close(candidate.z, previous.z));
    const neighboringDecks = state.items.filter(item => item.id !== id && item.productId === "villa")
      .map(item => transformBox(deck, product, item));
    if (freeCandidates.length && freeCandidates.every(candidate => neighboringDecks.some(neighbor => overlap(transformBox(deck, product, candidate), neighbor)))) {
      const deckWidth = round((deck[3] - deck[0]) / 10);
      const platformWidth = round((modelIndex.P01.bounds[3] - modelIndex.P01.bounds[0]) / 10);
      return { ok: false, state, reason: `这个方向会让相邻的二层平台重叠：二层板宽${deckWidth}厘米，底层平台宽${platformWidth}厘米。请先调整旁边小屋的方向` };
    }
  }
  return { ok: false, state, reason: "这个方向没有可用的磁吸位置，或旋转后会与其他组件重叠" };
}
function action(state: AssemblyState, next: AssemblyState, reason?: string): ActionResult {
  try { return { ok: true, state: validateAssembly(next) }; }
  catch (error) { return { ok: false, state, reason: reason ?? (error instanceof Error ? error.message : "装配不匹配") }; }
}
export function addPlatform(state: AssemblyState, direction: PlatformDirection = "right"): ActionResult {
  if (direction !== "right") return { ok: false, state, reason: "新增平台只能向右贴合" };
  if (state.thirdPlatform) return { ok: false, state, reason: "最多可以添加三个平台" };
  const extension: PlatformExtension = { direction: "right", baseInsert: "lid", baseColors: createInitialState().baseColors, removedCovers: [] };
  return action(state, state.extension ? { ...state, thirdPlatform: extension } : { ...state, extension });
}
export function movePlatform(state: AssemblyState, direction: PlatformDirection): ActionResult {
  if (!state.extension) return { ok: false, state, reason: "请先添加第二个平台" };
  if (direction !== "right") return { ok: false, state, reason: "平台固定向右连续贴合" };
  return action(state, state);
}
export function removePlatform(state: AssemblyState, id: PlatformId = "base2"): ActionResult {
  const platforms = getPlatforms(state), index = platforms.findIndex(platform => platform.id === id);
  if (index < 0) return { ok: false, state, reason: "未找到平台" };
  if (platforms.length === 1) return { ok: false, state, reason: "至少保留一个平台" };
  const remaining = platforms.filter(platform => platform.id !== id);
  const removedFamily = descendants(state, id);
  const newIds: PlatformId[] = ["base", "base2", "base3"];
  const shifts = new Map<string, { id: PlatformId; x: number }>();
  remaining.forEach((platform, i) => shifts.set(platform.id, { id: newIds[i], x: i * 300 - platform.x }));
  const rootOf = (parentId: string): string => { const parent = state.items.find(item => item.id === parentId); return parent ? rootOf(parent.parentId) : parentId; };
  const items = state.items.filter(item => !removedFamily.has(item.id)).map(item => {
    const shift = shifts.get(rootOf(item.parentId))!;
    return { ...item, x: round(item.x + shift.x), parentId: shifts.get(item.parentId)?.id ?? item.parentId };
  });
  const [base, second, third] = remaining;
  const asExtension = (platform?: PlatformView): PlatformExtension | null => platform ? { direction: "right", baseInsert: platform.baseInsert, baseColors: platform.baseColors, removedCovers: platform.removedCovers } : null;
  return action(state, { ...state, baseInsert: base.baseInsert, baseColors: base.baseColors, removedCovers: base.removedCovers, extension: asExtension(second), thirdPlatform: asExtension(third), items });
}
function normalizeBedding(value: unknown): Bedding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("垫料设置无效");
  const bedding = value as Bedding;
  if (bedding.mode === "none" && bedding.depth === 0) return { mode: "none", depth: 0 };
  if (bedding.mode === "thin" && bedding.depth === 50) return { mode: "thin", depth: 50 };
  if (bedding.mode === "thick" && [100, 200, 300].includes(bedding.depth)) return { mode: "thick", depth: bedding.depth };
  throw new Error("不铺垫料为0厘米，薄垫料为5厘米，厚垫料可选10、20或30厘米");
}
export function setBedding(state: AssemblyState, value: Bedding): ActionResult {
  try {
    const bedding = normalizeBedding(value);
    const legHeight = bedding.mode === "thick" && state.legHeight !== 0 && state.legHeight < bedding.depth
      ? bedding.depth : state.legHeight;
    return action(state, { ...state, bedding, legHeight });
  } catch (error) { return { ok: false, state, reason: error instanceof Error ? error.message : "垫料设置无效" }; }
}
export function setLegHeight(state: AssemblyState, legHeight: 0 | 100 | 200 | 300): ActionResult {
  return action(state, { ...state, legHeight });
}
export function setHamster(state: AssemblyState, hamster: string | null): ActionResult {
  return action(state, { ...state, hamster });
}
function updatePlatform(state: AssemblyState, id: PlatformId, changes: Partial<Pick<PlatformExtension, "baseInsert" | "baseColors" | "removedCovers">>): AssemblyState {
  return id === "base" ? { ...state, ...changes } : id === "base2" ? { ...state, extension: { ...state.extension!, ...changes } } : { ...state, thirdPlatform: { ...state.thirdPlatform!, ...changes } };
}
export function setCoverRemoved(state: AssemblyState, platformId: PlatformId, coverId: string, removed: boolean): ActionResult {
  if (!REMOVABLE_COVERS.includes(coverId as typeof REMOVABLE_COVERS[number])) return { ok: false, state, reason: "只能移除小圆盖，大圆盖会随泳池自动替换" };
  const platform = getPlatforms(state).find(p => p.id === platformId);
  if (!platform) return { ok: false, state, reason: "未找到平台" };
  const removedCovers = removed ? [...new Set([...platform.removedCovers, coverId])].sort() : platform.removedCovers.filter(id => id !== coverId);
  return action(state, updatePlatform(state, platformId, { removedCovers }));
}
export function setPlatformColors(state: AssemblyState, platformId: PlatformId, colors: ColorMap): ActionResult {
  if (!getPlatforms(state).some(platform => platform.id === platformId)) return { ok: false, state, reason: "未找到平台" };
  return action(state, updatePlatform(state, platformId, { baseColors: colors }));
}
export function setPlatformPool(state: AssemblyState, platformId: PlatformId, enabled: boolean): ActionResult {
  if (!getPlatforms(state).some(platform => platform.id === platformId)) return { ok: false, state, reason: "未找到平台" };
  const baseInsert = enabled ? "pool" as const : "lid" as const;
  return action(state, updatePlatform(state, platformId, { baseInsert }), "泳池位置已被占用，请先移开组件");
}
export function changeBaseInsert(state: AssemblyState, baseInsert: "lid" | "pool"): ActionResult {
  return setPlatformPool(state, "base", baseInsert === "pool");
}
/** Choose the strongest available magnetic fit, then a compact position; never leave a pending placement. */
export function autoPlace(state: AssemblyState, productId: string, preferredPlatformId?: PlatformId): ActionResult {
  if (productId === "pool") {
    for (const platform of getPlatforms(state).sort((a, b) => Number(b.id === preferredPlatformId) - Number(a.id === preferredPlatformId))) {
      if (platform.baseInsert === "pool") continue;
      const result = setPlatformPool(state, platform.id, true);
      if (result.ok) return result;
    }
    return { ok: false, state, reason: "放不下去了" };
  }
  try {
    const candidates = ([0, 90, 180, 270] as Rotation[]).flatMap(rotation => getPlacements(state, productId, rotation));
    const rootOf = (parentId: string): string => { const parent = state.items.find(item => item.id === parentId); return parent ? rootOf(parent.parentId) : parentId; };
    const compactScore = (placement: Placement) => {
      const siblings = state.items.filter(item => item.parentId === placement.parentId);
      if (siblings.length) return Math.min(...siblings.map(item => Math.hypot(item.x - placement.x, item.y - placement.y)));
      const platform = getPlatforms(state).find(p => p.id === rootOf(placement.parentId));
      const product = getProduct(productId);
      return Math.hypot(placement.x - product.origin[0] - (platform?.x ?? 0), placement.y - product.origin[1] - (platform?.y ?? 0));
    };
    candidates.sort((a, b) => b.magnetCount - a.magnetCount || Number(rootOf(b.parentId) === preferredPlatformId) - Number(rootOf(a.parentId) === preferredPlatformId) || compactScore(a) - compactScore(b) || a.z - b.z || a.rotation - b.rotation || a.key.localeCompare(b.key));
    for (const candidate of candidates) {
      const result = tryPlace(state, productId, candidate, candidate.rotation);
      if (result.ok) return result;
    }
  } catch { /* Unknown products or unavailable placements must not change the assembly. */ }
  return { ok: false, state, reason: "放不下去了" };
}
function normalizeRemovedCovers(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => !REMOVABLE_COVERS.includes(id)) || new Set(value).size !== value.length) throw new Error("小圆盖配置无效");
  return [...value].sort();
}
/** Strict schema, coordinates, bundle contents, collision, and attachment validation on every import. */
export function validateAssembly(value: unknown): AssemblyState {
  return validateAssemblyWithCatalog(value, getProduct);
}
function validateAssemblyWithCatalog(value: unknown, lookup: ProductLookup, legacyLayout = false): AssemblyState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("搭配数据格式不正确");
  const input = value as AssemblyState;
  if (input.version !== 1) throw new Error("暂不支持这个搭配版本");
  if (input.catalogVersion !== undefined && input.catalogVersion !== CATALOG_VERSION)
    throw new Error("搭配目录版本不兼容，请先迁移旧搭配");
  if (![0, 100, 200, 300].includes(input.legHeight))
    throw new Error("支撑脚长度无效");
  if (input.baseInsert !== "lid" && input.baseInsert !== "pool")
    throw new Error("平台嵌件无效");
  if (!Array.isArray(input.items) || input.items.length > (input.thirdPlatform ? 144 : input.extension ? 96 : 48))
    throw new Error("组件数量无效");
  const defaults = createInitialState();
  const state: AssemblyState = {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    legHeight: input.legHeight,
    removedCovers: normalizeRemovedCovers(input.removedCovers),
    extension: null,
    thirdPlatform: null,
    bedding: normalizeBedding(input.bedding ?? defaults.bedding),
    hamster: input.hamster ?? null,
    baseInsert: input.baseInsert,
    baseColors: normalizeColors(
      input.baseColors,
      Object.keys(defaults.baseColors),
      defaults.baseColors,
    ),
    items: [],
  };
  for (const [key, label] of [["extension", "第二个"], ["thirdPlatform", "第三个"]] as const) {
    const extension = input[key];
    if (extension === null || extension === undefined) continue;
    if (!extension || typeof extension !== "object" || Array.isArray(extension) || !Object.hasOwn(PLATFORM_OFFSETS, extension.direction) || (!legacyLayout && extension.direction !== "right") || !["lid", "pool"].includes(extension.baseInsert)) throw new Error(`${label}平台数据无效`);
    state[key] = { direction: extension.direction, baseInsert: extension.baseInsert, baseColors: normalizeColors(extension.baseColors, Object.keys(defaults.baseColors), defaults.baseColors), removedCovers: normalizeRemovedCovers(extension.removedCovers) };
  }
  if (state.thirdPlatform && !state.extension) throw new Error("第三个平台依赖第二个平台");
  if (state.hamster !== null && (typeof state.hamster !== "string" || !HAMSTER_VARIANTS.some(variant => variant.id === state.hamster))) throw new Error("仓鼠品种无效");
  const ids = new Set<string>();
  const pending = input.items.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ||
      (["base", "base2", "base3"].includes(raw.id)) ||
      ids.has(raw.id)
    )
      throw new Error("组件编号无效或重复");
    ids.add(raw.id);
    const product = lookup(raw.productId);
    if (product.id === "pool") throw new Error("泳池必须安装在平台预留孔中");
    if (product.id === "villa" && (!raw.colors || product.parts.some(part => !Object.hasOwn(raw.colors, part.id))))
      throw new Error("V4 花园复式套餐颜色不完整，请先迁移旧搭配");
    if (
      typeof raw.parentId !== "string" ||
      ![0, 90, 180, 270].includes(raw.rotation) ||
      ![raw.x, raw.y, raw.z].every(
        (n) =>
          typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 2000,
      )
    )
      throw new Error("组件位置或方向无效");
    return {
      id: raw.id,
      productId: raw.productId,
      x: round(raw.x),
      y: round(raw.y),
      z: round(raw.z),
      rotation: raw.rotation,
      parentId: raw.parentId,
      colors: normalizeColors(
        raw.colors,
        getProductColorParts(product.id).map((p) => p.id),
        getDefaultColors(product.id),
      ),
    };
  });
  while (pending.length) {
    const index = pending.findIndex(
      (i) =>
        getPlatforms(state).some(p => p.id === i.parentId) || state.items.some((p) => p.id === i.parentId),
    );
    if (index === -1) throw new Error("组件依赖缺失或循环");
    const item = pending.splice(index, 1)[0];
    const match = getPlacements(state, item.productId, item.rotation, undefined, lookup).some(
      (p) =>
        close(p.x, item.x) &&
        close(p.y, item.y) &&
        close(p.z, item.z) &&
        p.parentId === item.parentId,
    );
    if (!match)
      throw new Error(
        `「${getProduct(item.productId).name}」的磁吸位不匹配或与组件重叠`,
      );
    state.items.push(item);
  }
  return state;
}
export interface AssemblyMigrationResult {
  state: AssemblyState;
  messages: string[];
}
const LEGACY_VILLA_PARTS = ["A01", "A02", "G05", "G15"] as const;
function hasLegacyVillaColors(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === LEGACY_VILLA_PARTS.length && LEGACY_VILLA_PARTS.every(key => keys.includes(key));
}
/** Original catalog geometry is used only to validate historical imports before upgrading. */
function legacyProductLookup(source: 2 | 3 | 4 | 5 | 6): ProductLookup {
  return id => {
    const current = getProduct(id);
    const frozen = legacyCatalog6.products[id as keyof typeof legacyCatalog6.products];
    const product: CollisionProduct = frozen ? { ...current, ...frozen, baseMagnetOffsetMm: undefined,
      ...(id === "villa" ? { preciseCollisionBoxes: LEGACY_VILLA_COLLISION_BOXES } : {}),
    } as CollisionProduct : current;
    if (source === 6) return product;
    if (source === 5) return id === "planter" || id === "food-bowl" ? { ...product, allowedParents: ["villa"] } : product;
    if (id === "villa") return { ...product, surfaces: product.surfaces!.map(surface => surface.id === "planter" ? { ...surface, points: [[278.5, 264, 200], [292.5, 264, 200]] } : surface) };
    if (id === "planter") return { ...product, bottomMagnets: [[278.5, 264, 200], [292.5, 264, 200]], minimumMagnetMatches: 2, allowedParents: ["villa"] };
    if (id === "food-bowl") return { ...product, origin: [134, 124, 180], bottomMagnets: [[127, 124, 180], [141, 124, 180]], minimumMagnetMatches: 2, allowedParents: ["villa"], collisionBoxes: [[94.5, 96, 180, 149.5, 156, 201]] };
    if (id === "roof-cottage" && source === 4) return { ...product, bottomMagnets: [[5, 192, 200], [5, 286, 200], [125, 192, 200], [125, 286, 200]], collisionBoxes: [[-3, 179.60000610351562, 200, 133, 298, 373.3333435058594]] };
    return product;
  };
}
function upgradeSteelV9(previous: AssemblyState): AssemblyMigrationResult {
  const lookup = legacyProductLookup(6);
  const validate = (value: unknown) => validateAssemblyWithCatalog(value, lookup);
  const messages = ["搭配已升级为 Steel V9，原有组件与自定义配色已保留。"];
  try { return { state: validate(previous), messages }; }
  catch {
    // Reserve unchanged hats first; a relocated hat must not displace another valid placement.
    const hats = previous.items.filter(item => item.productId === "roof-cottage");
    let state = validate({ ...previous, items: previous.items.filter(item => item.productId !== "roof-cottage") });
    const moved: AssemblyItem[] = [];
    for (const item of hats) {
      const unchanged = getPlacements(state, item.productId, item.rotation, undefined, lookup).some(candidate => candidate.parentId === item.parentId && samePoint([candidate.x, candidate.y, candidate.z], [item.x, item.y, item.z]));
      if (unchanged) state = { ...state, items: [...state.items, item] };
      else moved.push(item);
    }
    // Hats already on a villa must keep that parent. Reserve their only host before
    // relocating first-floor hats, which may use any remaining villa.
    moved.sort((a, b) => Number(a.parentId === "base" || a.parentId === "base2") - Number(b.parentId === "base" || b.parentId === "base2"));
    for (const item of moved) {
      const wasOnPlatform = item.parentId === "base" || item.parentId === "base2";
      const candidates = ([0, 90, 180, 270] as Rotation[]).flatMap(rotation => getPlacements(state, item.productId, rotation, undefined, lookup))
        .filter(candidate => wasOnPlatform || candidate.parentId === item.parentId)
        .sort((a, b) => {
          const parentA = state.items.find(parent => parent.id === a.parentId), parentB = state.items.find(parent => parent.id === b.parentId);
          const samePlatformA = parentA?.parentId === item.parentId, samePlatformB = parentB?.parentId === item.parentId;
          return Number(samePlatformB) - Number(samePlatformA)
            || Math.hypot(a.x - item.x, a.y - item.y, a.z - item.z) - Math.hypot(b.x - item.x, b.y - item.y, b.z - item.z)
            || a.key.localeCompare(b.key);
        });
      const position = candidates[0];
      if (!position) throw new Error("旧搭配无法兼容 Steel V9：帽子小屋已恢复 162 mm 宽，当前没有可用的二层磁吸位置。原搭配未覆盖、组件未删除，请调整后再导入。");
      state = { ...state, items: [...state.items, { ...item, x: position.x, y: position.y, z: position.z, rotation: position.rotation, parentId: position.parentId }] };
      messages.push(wasOnPlatform
        ? "帽子小屋已恢复 162 mm 宽，旧一层位置不再匹配；已移到现有礼物盒的可用二层磁位，配色已保留。"
        : "帽子小屋已恢复 162 mm 宽，已调整到原礼物盒二层最近的合法磁位，配色已保留。");
    }
    return { state: validate(state), messages };
  }
}
/** Source V15 moves the shared upper accessory receiver 5 mm toward the deck.
 * Their pivots move with their source contact, preserving every base/roof attachment.
 * Hats keep their virtual pivot: both the source body and parent contacts move +5.
 */
function upgradeSteelV15(previous: AssemblyState): AssemblyMigrationResult {
  let moved = 0;
  const items = previous.items.map(item => {
    if (item.productId !== "planter" && item.productId !== "food-bowl") return item;
    const parent = previous.items.find(candidate => candidate.id === item.parentId);
    if (parent?.productId !== "villa") return item;
    const [dx, dy] = rotateVector([-5, 0, 0], parent.rotation);
    moved++;
    return { ...item, x: round(item.x + dx), y: round(item.y + dy) };
  });
  try {
    const state = validateAssembly({ ...previous, items });
    const messages = previous.items.some(item => item.productId === "villa")
      ? [`二层平台已更新为 30 厘米宽，原有组件与配色已保留。${moved ? "二层花圃和食盆已随磁吸位向内移动 5 毫米。" : ""}`]
      : [];
    return { state, messages };
  } catch (error) {
    throw new Error(`旧搭配无法兼容 30 厘米二层平台，原存档已保留、组件未删除：${error instanceof Error ? error.message : "磁吸位不匹配"}`);
  }
}
/** Validate historical geometry before migrating; current configurations never receive placement repairs. */
export function migrateAssembly(value: unknown, sourceCatalogVersion?: 2 | 3 | 4 | 5 | 6 | 7): AssemblyMigrationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("搭配数据格式不正确");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.items)) throw new Error("组件数量无效");
  if (sourceCatalogVersion !== undefined && ![2, 3, 4, 5, 6, CATALOG_VERSION].includes(sourceCatalogVersion)) throw new Error("搭配目录版本不兼容");
  if (sourceCatalogVersion !== undefined && raw.catalogVersion !== undefined && raw.catalogVersion !== sourceCatalogVersion) throw new Error("搭配目录版本标记冲突");
  const rawItems = raw.items;
  const villas = rawItems.filter(item => item && typeof item === "object" && item.productId === "villa");
  const inferredLegacy = raw.catalogVersion === undefined && villas.length > 0 && villas.every(item => hasLegacyVillaColors(item.colors));
  const source = sourceCatalogVersion ?? raw.catalogVersion ?? (inferredLegacy ? 2 : CATALOG_VERSION);
  if (source === CATALOG_VERSION) return { state: validateAssembly(value), messages: [] };
  if (source === 6) return upgradeSteelV15(validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION }, legacyProductLookup(6)));
  if (source !== 2 && source !== 3 && source !== 4 && source !== 5) throw new Error("搭配目录版本不兼容");
  if (![0, 100, 200].includes(raw.legHeight as number) || (raw.thirdPlatform !== undefined && raw.thirdPlatform !== null)) throw new Error("旧搭配包含该版本不支持的平台或脚长");
  const messages: string[] = [];
  let items = rawItems;
  if (source === 2) {
    if (!villas.every(item => hasLegacyVillaColors(item.colors))) throw new Error("旧版复式套餐的四色数据不完整");
    let adjustedLofts = 0;
    items = rawItems.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("组件数据格式不正确");
      const next = { ...item, colors: item.colors && typeof item.colors === "object" ? { ...item.colors } : item.colors };
      if (item.productId === "villa") next.colors = { ...item.colors, G16: item.colors.G15, G17: item.colors.G15, W01: item.colors.A02, W02: item.colors.A02 };
      if (item.productId === "roof-cottage") {
        const parent = rawItems.find(candidate => candidate && candidate.id === item.parentId);
        if (parent?.productId === "villa" && [0, 90, 180, 270].includes(parent.rotation) && [0, 90, 180, 270].includes(item.rotation) && (item.rotation - parent.rotation + 360) % 360 === 180) {
          next.rotation = parent.rotation;
          adjustedLofts++;
        }
      }
      return next;
    });
    messages.push(villas.length ? "旧搭配已升级为 V4 八件复式套餐：新增白柱继承二层平台颜色，左右草栏继承原草栏颜色。" : "旧搭配目录已升级，原有配色与位置已保留。");
    if (adjustedLofts) messages.push(`已将 ${adjustedLofts} 个帽子小屋按 V4 围栏安全方向调整，装配位置和自定义配色已保留。`);
  }
  const previous = validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION, thirdPlatform: null, bedding: { mode: "thin", depth: 50 }, hamster: null, ...(source < 4 ? { extension: null, removedCovers: [] } : {}), items }, legacyProductLookup(source), true);
  let relocated = previous;
  if (previous.extension && previous.extension.direction !== "right") {
    const [oldX, oldY] = PLATFORM_OFFSETS[previous.extension.direction];
    const family = descendants(previous, "base2");
    relocated = { ...previous, extension: { ...previous.extension, direction: "right" }, items: previous.items.map(item => family.has(item.id) ? { ...item, x: round(item.x + 300 - oldX), y: round(item.y - oldY) } : item) };
    messages.push("第二个平台已调整为向右贴合，平台上的组件与子配件整体随动，原有配色已保留。");
  }
  try {
    const upgraded = source < 5 ? upgradeSteelV9(relocated) : { state: validateAssemblyWithCatalog(relocated, legacyProductLookup(6)), messages: ["搭配目录已升级，原有组件与配色已保留。"] };
    const current = upgradeSteelV15(upgraded.state);
    return { state: current.state, messages: [...messages, ...upgraded.messages, ...current.messages] };
  } catch (error) {
    if (relocated !== previous) throw new Error(`旧平台布局无法兼容右侧连续布局，原存档已保留：${error instanceof Error ? error.message : "组件相撞"}`);
    throw error;
  }
}

export function getOrderLines(state: AssemblyState): OrderLine[] {
  const basePrice = BASE_PRODUCT.price + (state.legHeight === 300 ? BASE_PRODUCT.extraTallLegSurcharge : state.legHeight === 200 ? BASE_PRODUCT.tallLegSurcharge : 0) - (state.legHeight === 0 ? BASE_PRODUCT.noLegDiscount : 0);
  const lines: OrderLine[] = [];
  for (const platform of getPlatforms(state)) {
    const baseParts = getBaseParts(state.legHeight, platform.baseInsert).filter(part => part.id !== "B01" && !platform.removedCovers.includes(part.id));
    const baseColorKeys = [...baseParts.filter(part => !/^[LXY]0[1-4]$/.test(part.id)).map(part => part.id), ...(state.legHeight ? ["legs"] : [])];
    lines.push({ id: platform.id, sku: `${BASE_PRODUCT.sku}-${state.legHeight}`, name: `${BASE_PRODUCT.name} · ${state.legHeight ? `${state.legHeight / 10} cm 腿` : "无腿"}${platform.id === "base2" ? " · 第二平台" : platform.id === "base3" ? " · 第三平台" : ""}`, quantity: 1, unitPrice: basePrice, total: basePrice, parts: baseParts.map(part => part.id), colors: Object.fromEntries(baseColorKeys.map(key => [key, platform.baseColors[key]])) });
    if (platform.baseInsert === "pool") {
      const pool = getProduct("pool");
      lines.push({ id: `pool-${platform.id}`, sku: pool.sku, name: pool.name, quantity: 1, unitPrice: pool.price, total: pool.price, parts: ["B01"], colors: { B01: platform.baseColors.B01 } });
    }
  }
  for (const item of state.items) {
    const product = getProduct(item.productId);
    const colors = resolveLinkedProductColors(normalizeColors(item.colors, getProductColorParts(product.id).map(part => part.id), getDefaultColors(product.id)));
    const colorKey = JSON.stringify(
      Object.entries(colors).sort(([a], [b]) => a.localeCompare(b)),
    );
    const same = lines.find(
      (line) =>
        line.id !== "base" &&
        line.sku === product.sku &&
        JSON.stringify(
          Object.entries(line.colors).sort(([a], [b]) => a.localeCompare(b)),
        ) === colorKey,
    );
    if (same) {
      same.quantity++;
      same.total += product.price;
    } else
      lines.push({
        id: item.id,
        sku: product.sku,
        name: product.name,
        quantity: 1,
        unitPrice: product.price,
        total: product.price,
        parts: product.parts.map((p) => p.id),
        colors,
      });
  }
  return lines;
}
export function getTotalPrice(state: AssemblyState): number {
  return getOrderLines(state).reduce((total, line) => total + line.total, 0);
}
