import {
  BASE_PRODUCT,
  COLOR_IDS,
  SNAP_DISTANCE_MM,
  getBaseParts,
  getDefaultColors,
  getProduct,
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
  legHeight: 100 | 200;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  items: AssemblyItem[];
}
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
    legHeight: 100,
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
export function getItemBounds(item: AssemblyItem): Bounds[] {
  const product = getProduct(item.productId);
  return product.collisionBoxes.map((box) => transformBox(box, product, item));
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
}
function getSurfaces(state: AssemblyState, excluded: Set<string>): Surface[] {
  const grid = [10, 90, 110, 190, 210, 290];
  const points: Vec3[] = [];
  for (const x of grid)
    for (const y of grid) {
      if (
        state.baseInsert === "pool" &&
        (x === 90 || x === 110) &&
        (y === 90 || y === 110)
      )
        continue;
      points.push([x, y, 110]);
    }
  const surfaces: Surface[] = [
    {
      id: "platform",
      parentId: "base",
      parentProduct: "base",
      points,
      bounds: [0, 0, 110, 300, 300, 110],
    },
  ];
  for (const item of state.items) {
    if (excluded.has(item.id)) continue;
    const product = getProduct(item.productId);
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
): { point: Vec3; parentId: string }[] {
  return getSurfaces(state, new Set()).flatMap((s) =>
    s.points.map((point) => ({ point, parentId: s.parentId })),
  );
}
function facesFor(
  product: Product,
  item: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">,
) {
  return (product.pipeFaces ?? []).map((face) => ({
    center: transformPoint(face.center, product, item),
    normal: rotateVector(face.normal, item.rotation),
    pole: face.pole,
  }));
}
function compatiblePlacement(
  state: AssemblyState,
  product: Product,
  placement: Placement,
  surface: Surface,
  excluded: Set<string>,
): boolean {
  const boxes = product.collisionBoxes.map((b) =>
    transformBox(b, product, placement),
  );
  const overhang = surface.parentId === "base" ? 6 : 2;
  // Bounds describe reserved assembly space, not mesh boolean collision. Conservative on purpose.
  if (
    boxes.some(
      (b) =>
        b[0] < surface.bounds[0] - overhang ||
        b[1] < surface.bounds[1] - overhang ||
        b[3] > surface.bounds[3] + overhang ||
        b[4] > surface.bounds[4] + overhang,
    )
  )
    return false;
  if (state.baseInsert === "pool" && placement.parentId === "base") {
    // Reserve the real opening/upper rim, not the whole square around the circular basin.
    if (
      boxes.some(
        (b) =>
          b[2] < 113.65 &&
          b[5] > 110 &&
          Math.hypot(
            Math.max(b[0], Math.min(100, b[3])) - 100,
            Math.max(b[1], Math.min(100, b[4])) - 100,
          ) <
            78 - EPS,
      )
    )
      return false;
  }
  const magnets = product.bottomMagnets.map((m) =>
    transformPoint(m, product, placement),
  );
  const faces = facesFor(product, placement);
  for (const other of state.items) {
    if (excluded.has(other.id) || other.id === placement.parentId) continue;
    const otherProduct = getProduct(other.productId);
    if (other.parentId === placement.parentId) {
      const otherMagnets = otherProduct.bottomMagnets.map((m) =>
        transformPoint(m, otherProduct, other),
      );
      if (magnets.some((m) => otherMagnets.some((n) => samePoint(m, n))))
        return false;
    }
    if (boxes.some((a) => getItemBounds(other).some((b) => overlap(a, b))))
      return false;
    for (const a of faces)
      for (const b of facesFor(otherProduct, other)) {
        if (samePoint(a.center, b.center)) {
          const opposing = a.normal.every((n, i) => close(n, -b.normal[i]));
          if (!opposing || a.pole === b.pole) return false;
        }
      }
  }
  return true;
}
/** Enumerates only transforms where EVERY external bottom magnet has a matching host magnet. */
export function getPlacements(
  state: AssemblyState,
  productId: string,
  rotation: Rotation = 0,
  ignoreId?: string,
): Placement[] {
  if (![0, 90, 180, 270].includes(rotation)) return [];
  const product = getProduct(productId);
  const excluded = descendants(state, ignoreId);
  const local = product.bottomMagnets.map((p) =>
    rotateVector(p.map((v, i) => v - product.origin[i]) as Vec3, rotation),
  );
  if (!local.length) return [];
  const candidates: Placement[] = [];
  for (const surface of getSurfaces(state, excluded)) {
    if (
      product.allowedParents &&
      !product.allowedParents.includes(surface.parentProduct)
    )
      continue;
    const parentRotation =
      state.items.find((i) => i.id === surface.parentId)?.rotation ?? 0;
    if (
      product.allowedRelativeRotations &&
      !product.allowedRelativeRotations.includes(
        ((rotation - parentRotation + 360) % 360) as Rotation,
      )
    )
      continue;
    for (const anchor of surface.points) {
      const shift = anchor.map((v, i) => round(v - local[0][i])) as Vec3;
      if (
        !local.every((m) =>
          surface.points.some((n) =>
            samePoint(m.map((v, i) => v + shift[i]) as Vec3, n),
          ),
        )
      )
        continue;
      const placement: Placement = {
        x: shift[0],
        y: shift[1],
        z: shift[2],
        rotation,
        parentId: surface.parentId,
        key: `${surface.parentId}:${shift.join(",")}:${rotation}`,
        magnetCount: local.length,
      };
      if (
        compatiblePlacement(state, product, placement, surface, excluded) &&
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
    if (!ignoreId && state.items.length >= 48)
      throw new Error("单个平台最多支持 48 组组件");
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
        product.parts.map((p) => p.id),
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
  const match = getPlacements(state, previous.productId, rotation, id).find(
    (p) =>
      close(p.x, previous.x) &&
      close(p.y, previous.y) &&
      close(p.z, previous.z) &&
      p.parentId === previous.parentId,
  );
  if (!match)
    return {
      ok: false,
      state,
      reason: "这个方向的磁吸孔位不匹配，或与其他组件重叠",
    };
  return tryPlace(
    state,
    previous.productId,
    previous,
    rotation,
    previous.colors,
    id,
  );
}
export function changeBaseInsert(
  state: AssemblyState,
  baseInsert: "lid" | "pool",
): { ok: boolean; state: AssemblyState; reason?: string } {
  try {
    return { ok: true, state: validateAssembly({ ...state, baseInsert }) };
  } catch {
    return {
      ok: false,
      state,
      reason: "池盆会占用中央磁吸位，请先移开中央组件",
    };
  }
}
/** Strict schema, coordinates, bundle contents, collision, and attachment validation on every import. */
export function validateAssembly(value: unknown): AssemblyState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("搭配数据格式不正确");
  const input = value as AssemblyState;
  if (input.version !== 1) throw new Error("暂不支持这个搭配版本");
  if (input.legHeight !== 100 && input.legHeight !== 200)
    throw new Error("支撑脚长度无效");
  if (input.baseInsert !== "lid" && input.baseInsert !== "pool")
    throw new Error("平台嵌件无效");
  if (!Array.isArray(input.items) || input.items.length > 48)
    throw new Error("组件数量无效");
  const defaults = createInitialState();
  const state: AssemblyState = {
    version: 1,
    legHeight: input.legHeight,
    baseInsert: input.baseInsert,
    baseColors: normalizeColors(
      input.baseColors,
      Object.keys(defaults.baseColors),
      defaults.baseColors,
    ),
    items: [],
  };
  const ids = new Set<string>();
  const pending = input.items.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ||
      raw.id === "base" ||
      ids.has(raw.id)
    )
      throw new Error("组件编号无效或重复");
    ids.add(raw.id);
    const product = getProduct(raw.productId);
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
        product.parts.map((p) => p.id),
        getDefaultColors(product.id),
      ),
    };
  });
  while (pending.length) {
    const index = pending.findIndex(
      (i) =>
        i.parentId === "base" || state.items.some((p) => p.id === i.parentId),
    );
    if (index === -1) throw new Error("组件依赖缺失或循环");
    const item = pending.splice(index, 1)[0];
    const match = getPlacements(state, item.productId, item.rotation).some(
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
export function getOrderLines(state: AssemblyState): OrderLine[] {
  const basePrice =
    BASE_PRODUCT.price +
    (state.legHeight === 200 ? BASE_PRODUCT.tallLegSurcharge : 0) +
    (state.baseInsert === "pool" ? BASE_PRODUCT.poolSurcharge : 0);
  const baseParts = getBaseParts(state.legHeight, state.baseInsert);
  const baseColorKeys = [
    ...baseParts.filter((p) => !/^[LX]0[1-4]$/.test(p.id)).map((p) => p.id),
    "legs",
  ];
  const orderBaseColors = Object.fromEntries(
    baseColorKeys.map((key) => [key, state.baseColors[key]]),
  );
  const lines: OrderLine[] = [
    {
      id: "base",
      sku: `${BASE_PRODUCT.sku}-${state.legHeight}${state.baseInsert === "pool" ? "-POOL" : ""}`,
      name: `${BASE_PRODUCT.name} · ${state.legHeight / 10} cm 腿${state.baseInsert === "pool" ? " · 池盆款" : ""}`,
      quantity: 1,
      unitPrice: basePrice,
      total: basePrice,
      parts: baseParts.map((p) => p.id),
      colors: orderBaseColors,
    },
  ];
  for (const item of state.items) {
    const product = getProduct(item.productId);
    const colorKey = JSON.stringify(
      Object.entries(item.colors).sort(([a], [b]) => a.localeCompare(b)),
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
        colors: item.colors,
      });
  }
  return lines;
}
export function getTotalPrice(state: AssemblyState): number {
  return getOrderLines(state).reduce((total, line) => total + line.total, 0);
}
