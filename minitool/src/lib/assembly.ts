import { fixedDoorPair } from '../data/fixed-door-variants';
import { hasReversiblePanel } from '../data/reversible-panels';
import { getHouseDoorways, getHouseRoomFloors } from "./aite-panel";
import legacyCatalog9 from "../data/legacy-catalog-9.json";
import legacyCatalog8 from "../data/legacy-catalog-8.json";
import housePipeClearances from "../data/house-pipe-clearances.json";
import downPipeFit from "../data/down-pipe-fit.json";
import { DEFAULT_CAGE, normalizeCage, type CageSize } from "../data/cages";
import { HAMSTER_VARIANTS } from "../data/hamsters";
import modelIndex from "../data/model-index.json";
import legacyCatalog6 from "../data/legacy-catalog-6.json";
import legacySeesaw from "../data/legacy-seesaw-v16.json";
import {
  BASE_PRODUCT,
  CATALOG_VERSION,
  COLOR_IDS,
  P01_TOP_XY, H06_TOP_XY,
  SNAP_DISTANCE_MM,
  getBaseParts,
  getDefaultColors, getPoolRimColor,
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
  doorSide?: "left" | "right";
}
export interface AssemblyState {
  version: 1;
  catalogVersion: typeof CATALOG_VERSION;
  legHeight: 0 | 100 | 200 | 300;
  baseRemoved?: boolean;
  removedCovers: string[];
  extension: PlatformExtension | null;
  thirdPlatform: PlatformExtension | null;
  fourthPlatform: PlatformExtension | null;
  bedding: Bedding;
  cage?: CageSize | null;
  hamster: string | null;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  items: AssemblyItem[];
}
export type Bedding = { mode: "none"; depth: 0 } | { mode: "thin"; depth: 50 } | { mode: "thick"; depth: 100 | 200 | 300 };
export type PlatformDirection = "left" | "right" | "front" | "back";
export type PlatformId = "base" | "base2" | "base3" | "base4";
export interface PlatformExtension {
  legHeight?: AssemblyState["legHeight"];
  direction: PlatformDirection;
  baseInsert: "lid" | "pool";
  baseColors: ColorMap;
  removedCovers: string[];
}
export interface PlatformView {
  legHeight: AssemblyState["legHeight"];
  elevation: number;
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
    fourthPlatform: null,
    bedding: { mode: "thin", depth: 50 },
    cage: { ...DEFAULT_CAGE },
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
      "B01-rim": "red",
    },
    items: [],
  };
}
export function getPlatforms(state: AssemblyState): PlatformView[] {
  const result: Omit<PlatformView, "legHeight" | "elevation">[] = state.baseRemoved ? [] : [{ id: "base", x: 0, y: 0, baseInsert: state.baseInsert, baseColors: state.baseColors, removedCovers: state.removedCovers }];
  if (state.extension) {
    const [x, y] = PLATFORM_OFFSETS[state.extension.direction];
    result.push({ id: "base2", x, y, baseInsert: state.extension.baseInsert, baseColors: state.extension.baseColors, removedCovers: state.extension.removedCovers });
  }
  if (state.thirdPlatform) result.push({ id: "base3", x: 600, y: 0, baseInsert: state.thirdPlatform.baseInsert, baseColors: state.thirdPlatform.baseColors, removedCovers: state.thirdPlatform.removedCovers });
  if (state.fourthPlatform) result.push({ id: "base4", x: 900, y: 0, baseInsert: state.fourthPlatform.baseInsert, baseColors: state.fourthPlatform.baseColors, removedCovers: state.fourthPlatform.removedCovers });
  return result.map(platform => ({ ...platform, legHeight: getPlatformLegHeight(state, platform.id), elevation: getDisplayElevation(state, platform.id), removedCovers: [...new Set([...platform.removedCovers,
    ...state.items.filter(item => item.parentId === platform.id && getProduct(item.productId).attachment === "platform-hole")
      .map(item => holeForItem(item, platform)).filter((id): id is string => Boolean(id)),
  ])] }));
}
function manualRemovedCovers(state: AssemblyState, id: PlatformId): string[] {
  return id === "base" ? state.removedCovers : id === "base2" ? state.extension!.removedCovers
    : id === "base3" ? state.thirdPlatform!.removedCovers : state.fourthPlatform!.removedCovers;
}
function holeForItem(item: Pick<AssemblyItem,"x"|"y">, platform: {x:number;y:number}): string | undefined {
  return REMOVABLE_COVERS.find(id => {
    const b = modelIndex[id].bounds;
    return close(item.x, platform.x+(b[0]+b[3])/2) && close(item.y, platform.y+(b[1]+b[4])/2);
  });
}
export function getPlatformLegHeight(state: AssemblyState, platformId: PlatformId = "base"): AssemblyState["legHeight"] {
  const extension = platformId === "base2" ? state.extension : platformId === "base3" ? state.thirdPlatform : platformId === "base4" ? state.fourthPlatform : null;
  return extension?.legHeight ?? state.legHeight;
}
export function getDisplayElevation(state: AssemblyState, platformId: PlatformId = "base"): number {
  const height = getPlatformLegHeight(state, platformId);
  return height === 0 ? state.bedding.depth - 100 : height - 100;
}
/** Stored Z remains relative to each supporting platform, preserving old saved designs. */
export function getPlacementDisplayElevation(state: AssemblyState, placement: Pick<Placement, "parentId">): number {
  let parentId = placement.parentId;
  const seen = new Set<string>();
  while (!seen.has(parentId)) {
    seen.add(parentId);
    const parent = state.items.find(item => item.id === parentId);
    if (!parent) return parentId === "ground" ? state.bedding.depth : getDisplayElevation(state, parentId as PlatformId);
    parentId = parent.parentId;
  }
  return 0;
}
export const getItemDisplayElevation = getPlacementDisplayElevation;
function rootParent(state: AssemblyState, parentId: string): string {
  const seen = new Set<string>();
  while (!seen.has(parentId)) {
    seen.add(parentId); const item=state.items.find(item=>item.id===parentId);
    if(!item)return parentId;
    parentId=item.parentId;
  }
  return parentId;
}
const physicalStates = new WeakSet<AssemblyState>();
function physicalState(state: AssemblyState): AssemblyState {
  if (physicalStates.has(state)) return state;
  const result = { ...state, items: state.items.map(item => ({ ...item, z: round(item.z + getItemDisplayElevation(state, item)) })) };
  physicalStates.add(result);
  return result;
}
function platformTop(state: AssemblyState, platform: PlatformView): number {
  return 110 + (physicalStates.has(state) ? platform.elevation : 0);
}
function groundTop(state: AssemblyState): number { return physicalStates.has(state) ? state.bedding.depth : 0; }
function groundHeight(product: Product): number { return product.origin[2] - Math.min(...product.collisionBoxes.map(box => box[2])); }
function groundSurface(state: AssemblyState): Surface {
  const z = groundTop(state);
  return { id: "ground", parentId: "ground", parentProduct: "ground", points: [], bounds: [-2000,-2000,z,2000,2000,z] };
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
/** Only downward pipe entrances may occupy source-verified empty room space.
 * Broad house envelopes remain solid for furniture and ordinary pipe modules. */
function pipeInsideRoom(a: Product, pa: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">, b: Product, pb: Pick<AssemblyItem, "x" | "y" | "z" | "rotation">): boolean {
  const pipe = a.attachment === "platform-hole" ? a : b.attachment === "platform-hole" ? b : null;
  if (!pipe) return false;
  const house = pipe === a ? b : a, roomPose = pipe === a ? pb : pa, pipePose = pipe === a ? pa : pb;
  const rooms = (housePipeClearances as unknown as Record<string, Bounds[]>)[house.id];
  if (!rooms || !close(pipePose.z,roomPose.z)) return false;
  const voids = rooms.map(box => transformBox(box,house,roomPose));
  const pipeBoxes = solidCollisionBounds(pipe,pipePose), houseBoxes = solidCollisionBounds(house,roomPose);
  return pipeBoxes.every(pipeBox => houseBoxes.every(houseBox => {
    if (!overlap(pipeBox,houseBox)) return true;
    const intersection = [0,1,2].map(i=>Math.max(pipeBox[i],houseBox[i])).concat([0,1,2].map(i=>Math.min(pipeBox[i+3],houseBox[i+3])));
    return voids.some(room => [0,1,2].every(i=>intersection[i]>=room[i]-EPS && intersection[i+3]<=room[i+3]+EPS));
  }));
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
      if ((result.has(item.parentId) || (getProduct(item.productId).supportMode === "bridge" && bridgeSupportIds(state, item).some(parent => result.has(parent)))) && !result.has(item.id)) {
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
  supports?: [Surface, Surface];
}
function receiverMatches(magnet: Vec3, receiver: Vec3, product: Product, surface: Surface): boolean {
  const offset = surface.parentProduct === "base" ? product.baseMagnetOffsetMm ?? 0 : product.roofMagnetOffsets?.[surface.parentProduct] ?? 0;
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
    const z = platformTop(state, platform);
    const receivers = [...P01_TOP_XY.map(point => ({ point, sourcePart: "P01" as const })), ...(platform.baseInsert === "lid" ? H06_TOP_XY.map(point => ({ point, sourcePart: "H06" as const })) : [])];
    return { id: `platform-${platform.id}`, parentId: platform.id, parentProduct: "base", points: receivers.map(({ point: [x, y] }) => [x + platform.x, y + platform.y, z] as Vec3), sourceParts: receivers.map(receiver => receiver.sourcePart),
      bounds: [platform.x, platform.y, z, platform.x + 300, platform.y + 300, z] as Bounds };
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
/** Roof pairs retain their own receivers: a bridge cannot hang from one roof. */
function placementSurfaces(state: AssemblyState, product: Product, excluded: Set<string>, lookup: ProductLookup): Surface[] {
  const surfaces = getSurfaces(state, excluded, lookup);
  if (product.supportMode !== "bridge") return surfaces;
  const roofs = surfaces.filter(surface => product.allowedParents?.includes(surface.parentProduct))
    .sort((a,b) => a.bounds[0]-b.bounds[0] || a.bounds[1]-b.bounds[1] || a.bounds[2]-b.bounds[2] || a.id.localeCompare(b.id));
  const pairs: Surface[] = [];
  for (let i=0;i<roofs.length;i++) for (let j=i+1;j<roofs.length;j++) {
    const a=roofs[i], b=roofs[j];
    if (a.parentId === b.parentId || !close(a.bounds[2],b.bounds[2])) continue;
    // A 16.4 cm bridge cannot reach arbitrarily distant supports.
    if (Math.max(a.bounds[0]-b.bounds[3],b.bounds[0]-a.bounds[3],a.bounds[1]-b.bounds[4],b.bounds[1]-a.bounds[4]) > 164) continue;
    pairs.push({ ...a, id: `${a.id}+${b.id}`, points: [...a.points,...b.points], supports: [a,b],
      bounds: [Math.min(a.bounds[0],b.bounds[0]),Math.min(a.bounds[1],b.bounds[1]),a.bounds[2],Math.max(a.bounds[3],b.bounds[3]),Math.max(a.bounds[4],b.bounds[4]),a.bounds[5]] });
  }
  return pairs;
}
function bridgeFits(magnets: Vec3[], supports: [Surface, Surface]): boolean {
  const supported = (feet: Vec3[], surface: Surface) => {
    const center = feet.reduce((sum, point) => sum.map((v,i) => v + point[i]/feet.length) as Vec3, [0,0,0] as Vec3);
    return center[0] >= surface.bounds[0]-EPS && center[0] <= surface.bounds[3]+EPS
      && center[1] >= surface.bounds[1]-EPS && center[1] <= surface.bounds[4]+EPS;
  };
  const contacts = magnets.filter(foot => supports.some(surface => surface.points.some(point => samePoint(foot,point)))).length;
  if (contacts < 2) return false;
  return (supported(magnets.slice(0,2),supports[0]) && supported(magnets.slice(2),supports[1]))
    || (supported(magnets.slice(0,2),supports[1]) && supported(magnets.slice(2),supports[0]));
}
/** Recompute secondary dependencies from geometry, keeping saved-code indices unchanged. */
function bridgeSupportIds(state: AssemblyState, item: AssemblyItem): string[] {
  if (!physicalStates.has(state)) { const world = physicalState(state); return bridgeSupportIds(world, world.items.find(other => other.id === item.id) ?? { ...item, z: item.z + getItemDisplayElevation(state,item) }); }
  const product = getProduct(item.productId);
  const magnets = product.bottomMagnets.map(point => transformPoint(point,product,item));
  return [...new Set(placementSurfaces(state,product,new Set([item.id]),getProduct)
    .filter(surface => surface.supports && bridgeFits(magnets,surface.supports))
    .flatMap(surface => surface.supports!.map(support => support.parentId)))];
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
          b[2] < platformTop(state,hostPlatform) + 3.65 &&
          b[5] > platformTop(state,hostPlatform) &&
          Math.hypot(
            Math.max(b[0], Math.min(centerX, b[3])) - centerX,
            Math.max(b[1], Math.min(centerY, b[4])) - centerY,
          ) <
            78 - EPS,
      )
    )
      return false;
  }
  // A shorter platform does not make a neighboring higher deck transparent.
  for (const platform of getPlatforms(state)) {
    if (platform.id === placement.parentId) continue;
    const top = platformTop(state,platform);
    const board: Bounds = [platform.x,platform.y,top-10,platform.x+300,platform.y+300,top];
    const solids = solidCollisionBounds(product,placement);
    if (solids.some(box => overlap(box,board))) return false;
    if (platform.legHeight > 0) {
      const prefix = platform.legHeight === 100 ? "L" : platform.legHeight === 200 ? "X" : "Y";
      for (let leg=1;leg<=4;leg++) {
        const bounds = (modelIndex as Record<string,{bounds:number[]}>)[`${prefix}0${leg}`].bounds;
        const x=platform.x+(bounds[0]+bounds[3])/2, y=platform.y+(bounds[1]+bounds[4])/2;
        const offset=physicalStates.has(state)?platform.elevation:0;
        if (solids.some(box => box[2] < bounds[5]+offset-EPS && box[5] > bounds[2]+offset+EPS
          && Math.hypot(Math.max(box[0],Math.min(x,box[3]))-x,Math.max(box[1],Math.min(y,box[4]))-y) < (bounds[3]-bounds[0])/2-EPS)) return false;
      }
    }
  }
  const magnets = product.bottomMagnets.map((m) =>
    transformPoint(m, product, placement),
  );
  if (surface.supports && !bridgeFits(magnets, surface.supports)) return false;
  const receivers = matchedReceivers(magnets, product, surface);
  const faces = facesFor(product, placement);
  for (const other of state.items) {
    if (excluded.has(other.id) || (other.id === placement.parentId && product.supportMode !== "bridge")) continue;
    const otherProduct = lookup(other.productId);
    if ((surface.parentProduct !== "ground" && other.parentId === placement.parentId) || product.supportMode === "bridge" || otherProduct.supportMode === "bridge") {
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
      if (preciseBoxes.some(a => otherBoxes.some(b => overlap(a, b))) && !pipeInsideRoom(product,placement,otherProduct,other)) return false;
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
/** Loose furniture rests on a real floor; it never claims a magnetic contact. */
function floorAxis(min: number, max: number, step: number): number[] {
  if (max < min - EPS) return [];
  const values = [min, max, (min + max) / 2];
  for (let value = min + step; value < max - EPS; value += step) values.push(value);
  return [...new Set(values.map(round))].sort((a,b) => a-b);
}
function inversePoint(point: Vec3, house: Product, pose: Pick<AssemblyItem,"x"|"y"|"z"|"rotation">): Vec3 {
  return rotateVector([point[0]-pose.x,point[1]-pose.y,point[2]-pose.z], ((360-pose.rotation)%360) as Rotation)
    .map((v,i) => round(v+house.origin[i])) as Vec3;
}
/** Prefer the farthest room, then direct the low curved entry at its connecting arch. */
export function getRoomFloorPlacementScore(state: AssemblyState, placement: Placement): number {
  const parent = state.items.find(item => item.id === placement.parentId);
  const front = rotateVector([Math.SQRT1_2,-Math.SQRT1_2,0],placement.rotation);
  if (!parent) return front[0]*.56-front[1]*.83;
  const house = getProduct(parent.productId), local = inversePoint([placement.x,placement.y,placement.z],house,parent);
  const room = getHouseRoomFloors(parent.productId,parent.doorSide)?.find(room => local[0]>=room.bounds[0] && local[0]<=room.bounds[3] && local[1]>=room.bounds[1] && local[1]<=room.bounds[4]);
  if (!room) return -1e6;
  const entry = transformPoint(room.entry,house,parent);
  const mouthOffset = rotateVector([130/Math.SQRT2-65,65-130/Math.SQRT2,0],placement.rotation);
  const dx=entry[0]-placement.x-mouthOffset[0], dy=entry[1]-placement.y-mouthOffset[1];
  const alignment = (dx*front[0]+dy*front[1])/Math.max(.001,Math.hypot(dx,dy));
  const outside = transformPoint(getHouseDoorways(parent.productId,parent.doorSide)[0].center,house,parent);
  return room.depth*10000+alignment*1000+Math.hypot(outside[0]-placement.x,outside[1]-placement.y)/10;
}
function roomFloorPlacements(state: AssemblyState, product: Product, rotation: Rotation, excluded: Set<string>, lookup: ProductLookup): Placement[] {
  const result: Placement[] = [];
  const footprint = product.collisionBoxes[0], halfX=(footprint[3]-footprint[0])/2, halfY=(footprint[4]-footprint[1])/2;
  const height=footprint[5]-footprint[2];
  const add = (surface: Surface, parent?: AssemblyItem, obstacles: Bounds[] = []) => {
    const host = parent ? lookup(parent.productId) : null;
    const bounds=surface.bounds;
    if (parent && bounds[5]-bounds[2] < height-EPS) return;
    // Room coordinates are local to their house, so every house rotation preserves the fit.
    for (const x of floorAxis(bounds[0]+halfX+1,bounds[3]-halfX-1,parent?15:40))
      for (const y of floorAxis(bounds[1]+halfY+1,bounds[4]-halfY-1,parent?15:40)) {
        const point: Vec3 = [x,y,bounds[2]];
        const world = parent ? transformPoint(point,host!,parent) : point;
        const placement: Placement = {x:world[0],y:world[1],z:world[2],rotation,parentId:surface.parentId,key:`${surface.parentId}:floor:${world.join(',')}:${rotation}`,magnetCount:0};
        const worldBounds=parent?transformBox(bounds,host!,parent):bounds;
        const realSurface:Surface={...surface,bounds:[worldBounds[0],worldBounds[1],world[2],worldBounds[3],worldBounds[4],world[2]]};
        const boxes=product.collisionBoxes.map(b=>transformBox(b,product,placement));
        if (obstacles.some(obstacle => boxes.some(box => overlap(box,transformBox(obstacle,host!,parent!))))) continue;
        // At the base datum, a loose basin needs a closed supporting floor, not a pool or open hole.
        const floorFoot = boxes[0];
        if (landingOverOpening(state,[floorFoot[0],floorFoot[1],placement.z+.5,floorFoot[3],floorFoot[4],placement.z+1])) continue;
        if (compatiblePlacement(state,product,placement,realSurface,excluded,lookup)) result.push(placement);
      }
  };
  if (product.allowedParents?.includes("base")) for (const platform of getPlatforms(state)) {
    add({id:`floor-${platform.id}`,parentId:platform.id,parentProduct:"base",points:[],bounds:[platform.x,platform.y,platformTop(state,platform),platform.x+300,platform.y+300,platformTop(state,platform)]});
  }
  for (const parent of state.items) {
    if (excluded.has(parent.id) || !product.allowedParents?.includes(parent.productId)) continue;
    for (const room of getHouseRoomFloors(parent.productId,parent.doorSide)) add({id:room.id,parentId:parent.id,parentProduct:parent.productId,points:[],bounds:room.bounds},parent,room.obstacles);
  }
  return result.sort((a,b)=>getRoomFloorPlacementScore(state,b)-getRoomFloorPlacementScore(state,a)||a.key.localeCompare(b.key));
}
export function getPlacements(state: AssemblyState, productId: string, rotation: Rotation = 0, ignoreId?: string, lookup: ProductLookup = getProduct): Placement[] {
  const candidates = getWorldPlacements(physicalState(state),productId,rotation,ignoreId,lookup);
  return candidates.map(candidate => ({ ...candidate, z: round(candidate.z - getPlacementDisplayElevation(state,candidate)) }));
}
/** Ground is a supporting surface, without simulated magnetic contacts. */
function groundPlacements(state: AssemblyState, product: Product, rotation: Rotation, excluded: Set<string>, lookup: ProductLookup): Placement[] {
  const positions: Placement[] = [];
  const surface = groundSurface(state), z = groundTop(state)+groundHeight(product);
  const anchors = new Map<string,[number,number]>();
  for (let x=50;x<=1150;x+=100) for (let y=50;y<=550;y+=100) anchors.set(`${x},${y}`,[x,y]);
  for (const item of state.items) if (excluded.has(item.id)) anchors.set(`${item.x},${item.y}`,[item.x,item.y]);
  for (const [x,y] of anchors.values()) {
    const placement: Placement = {x,y,z,rotation,parentId:"ground",key:`ground:${x},${y}:${rotation}`,magnetCount:0};
    if (compatiblePlacement(state,product,placement,surface,excluded,lookup)) positions.push(placement);
  }
  return positions;
}
/** Enumerates transforms meeting each product’s source-backed contact minimum. */
function getWorldPlacements(
  state: AssemblyState,
  productId: string,
  rotation: Rotation = 0,
  ignoreId?: string,
  lookup: ProductLookup = getProduct,
): Placement[] {
  if (![0, 90, 180, 270].includes(rotation)) return [];
  const product = lookup(productId);
  const excluded = descendants(state, ignoreId);
  const onGround = !getPlatforms(state).length || state.items.find(item=>item.id===ignoreId)?.parentId === "ground" ? groundPlacements(state,product,rotation,excluded,lookup) : [];
  if (product.attachment === "room-floor") return [...roomFloorPlacements(state,product,rotation,excluded,lookup), ...onGround];
  if (product.attachment === "platform-hole") {
    const positions: Placement[] = [];
    for (const platform of getPlatforms(state)) for (const cover of REMOVABLE_COVERS) {
      const b=modelIndex[cover].bounds;
      const position: Placement={x:platform.x+(b[0]+b[3])/2,y:platform.y+(b[1]+b[4])/2,z:platformTop(state,platform),rotation,parentId:platform.id,key:`${platform.id}:${cover}:${rotation}`,magnetCount:0};
      const surface: Surface={id:cover,parentId:platform.id,parentProduct:"base",points:[],bounds:[platform.x,platform.y,platformTop(state,platform),platform.x+300,platform.y+300,platformTop(state,platform)]};
      if (!compatiblePlacement(state,product,position,surface,excluded,lookup)) continue;
      // Boolean-checked against the actual cylindrical legs and basin, not their
      // square bounding boxes (which falsely obstruct the corner holes).
      const fit=downPipeFit[`${cover}:${rotation}` as keyof typeof downPipeFit];
      if ((platform.legHeight > 0 && !fit.legClear) || (platform.baseInsert === "pool" && !fit.poolClear)) continue;
      positions.push(position);
    }
    return [...positions, ...onGround];
  }
  const local = product.bottomMagnets.map((p) =>
    rotateVector(p.map((v, i) => v - product.origin[i]) as Vec3, rotation),
  );
  if (!local.length) return onGround;
  const candidates: Placement[] = [];
  for (const surface of placementSurfaces(state, product, excluded, lookup)) {
    if (
      product.allowedParents &&
      !product.allowedParents.includes(surface.parentProduct)
    )
      continue;
    const parentRotation =
      state.items.find((i) => i.id === surface.parentId)?.rotation ?? 0;
    if (
      surface.parentProduct === "villa" &&
      product.allowedRelativeRotations &&
      !product.allowedRelativeRotations.includes(
        ((rotation - parentRotation + 360) % 360) as Rotation,
      )
    )
      continue;
    // Keep exact placements, including all existing saves and four-point upper-floor fits.
    const shifts: Vec3[] = surface.points.flatMap(anchor => local.map(foot =>
      anchor.map((v, i) => round(v - foot[i])) as Vec3));
    const offset = surface.parentProduct === "base" ? product.baseMagnetOffsetMm ?? 0 : product.roofMagnetOffsets?.[surface.parentProduct] ?? 0;
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
  return [...candidates.sort(
    (a, b) =>
      a.z - b.z ||
      a.y - b.y ||
      a.x - b.x ||
      a.parentId.localeCompare(b.parentId),
  ), ...onGround];
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
    keys.map((key) => [key, (input[key] ?? (key === "B01-rim" ? getPoolRimColor((input.B01 ?? defaults.B01) as ColorId) : defaults[key])) as ColorId]),
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
    if (!ignoreId && state.items.length + getPlatforms(state).filter(platform=>platform.baseInsert === "pool").length >= 196)
      throw new Error("组件数量已达到上限");
    const candidates = getPlacements(state, productId, rotation, ignoreId);
    const groundZ = groundHeight(getProduct(productId));
    const free: Placement = { x: round(point.x), y: round(point.y), z: groundZ, rotation, parentId: "ground", key: "ground-free", magnetCount: 0 };
    const worldFree = { ...free, z: groundZ + state.bedding.depth };
    if ((point.z !== undefined || !getPlatforms(state).length || state.items.find(item=>item.id===ignoreId)?.parentId === "ground")
      && compatiblePlacement(physicalState(state),getProduct(productId),worldFree,groundSurface(physicalState(state)),descendants(state,ignoreId))) candidates.push(free);
    const distance = (p: Placement) =>
      Math.hypot(
        p.x - point.x,
        p.y - point.y,
        point.z === undefined ? 0 : p.z - point.z,
      );
    const nearest = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (!nearest || distance(nearest) > SNAP_DISTANCE_MM)
      throw new Error(getProduct(productId).attachment === "room-floor" ? "请靠近可用的平面或房间，避开墙壁与已有组件" : "不匹配：请靠近可用磁吸位，避开已有组件");
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
      ...(previous?.doorSide ? { doorSide: previous.doorSide } : {}),
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
function ownedFamily(state: AssemblyState, id: string): Set<string> {
  const ids = new Set([id]);
  for (let changed=true;changed;) { changed=false; for (const item of state.items) if (ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed=true; } }
  return ids;
}
export function addPlatform(state: AssemblyState, direction: PlatformDirection = "right"): ActionResult {
  if (direction !== "right") return { ok: false, state, reason: "新增平台只能向右贴合" };
  if (getPlatforms(state).length >= 4) return { ok: false, state, reason: "最多可以添加四个平台" };
  const extension: PlatformExtension = { direction: "right", baseInsert: "lid", baseColors: createInitialState().baseColors, removedCovers: [] };
  const vacant = (["base","base2","base3","base4"] as const).filter(id=>!getPlatforms(state).some(p=>p.id===id));
  for (const id of vacant) {
    let next: AssemblyState = id === "base" ? { ...state, baseRemoved:false,baseInsert:"lid" as const,removedCovers:[] } :
      {...state,...(id === "base2" ? {extension} : id === "base3" ? {thirdPlatform:extension} : {fourthPlatform:extension})};
    const platform = getPlatforms(next).find(p=>p.id===id)!;
    // When putting a platform back, lift the loose families resting in that slot.
    const roots = state.items.filter(item=>item.parentId==="ground" && item.x>=platform.x && item.x<=platform.x+300 && item.y>=platform.y && item.y<=platform.y+300);
    for (const root of roots) {
      const group = ownedFamily(next,root.id), without = {...next,items:next.items.filter(item=>!group.has(item.id))};
      if (root.productId === "pool" && close(root.x,platform.x+100) && close(root.y,platform.y+100)) {
        const poolNext = updatePlatform(without,id,{baseInsert:"pool",baseColors:{...platform.baseColors,...root.colors}});
        if (action(state,poolNext).ok) next=poolNext;
        continue;
      }
      const candidate = getPlacements(without,root.productId,root.rotation).find(p=>p.parentId===id && close(p.x,root.x) && close(p.y,root.y));
      if (!candidate) continue;
      const dz=candidate.z-root.z;
      next={...next,items:next.items.map(item=>group.has(item.id)?{...item,z:round(item.z+dz),...(item.id===root.id?{parentId:id}:{})}:item)};
    }
    const result=action(state,next); if(result.ok) return result;
  }
  return {ok:false,state,reason:"新增平台的位置被现有组件占用，请先调整布局"};
}
export function movePlatform(state: AssemblyState, direction: PlatformDirection): ActionResult {
  if (!state.extension) return { ok: false, state, reason: "请先添加第二个平台" };
  if (direction !== "right") return { ok: false, state, reason: "平台固定向右连续贴合" };
  return action(state, state);
}
export function removePlatform(state: AssemblyState, id: PlatformId = "base2"): ActionResult {
  const platform = getPlatforms(state).find(platform => platform.id === id);
  if (!platform) return { ok: false, state, reason: "未找到平台" };
  // Keep stable platform slots, XY coordinates, and the parent links of stacked items.
  // A bridge losing either support becomes a loose ground item with its descendants.
  const rootOf = (parentId:string):string => { const parent=state.items.find(item=>item.id===parentId); return parent ? rootOf(parent.parentId) : parentId; };
  const roots = state.items.filter(item => item.parentId === id || (getProduct(item.productId).supportMode === "bridge" && bridgeSupportIds(state,item).some(support=>rootOf(support)===id)))
    .sort((a,b)=>Number(getProduct(a.productId).supportMode === "bridge")-Number(getProduct(b.productId).supportMode === "bridge"));
  const changes = new Map<string,number>();
  const rootIds = new Set(roots.map(item=>item.id));
  for (const root of roots) {
    const delta = groundHeight(getProduct(root.productId)) - root.z;
    for (const member of ownedFamily(state,root.id)) changes.set(member,delta);
  }
  const items = state.items.map(item => changes.has(item.id) ? { ...item, z: round(item.z+changes.get(item.id)!), ...(rootIds.has(item.id) ? {parentId:"ground"} : {}) } : item);
  // The inserted pool is a purchased component too, so preserve it as a loose basin.
  if (platform.baseInsert === "pool") items.push({ id: nextId({ ...state, items }), productId: "pool", x: platform.x+100, y: platform.y+100,
    z: groundHeight(getProduct("pool")), rotation:0, parentId:"ground", colors:{B01:platform.baseColors.B01,"B01-rim":platform.baseColors["B01-rim"]} });
  const next = { ...state, items, ...(id === "base" ? {baseRemoved:true,baseInsert:"lid" as const,removedCovers:[]} : id === "base2" ? {extension:null} : id === "base3" ? {thirdPlatform:null} : {fourthPlatform:null}) };
  return settleDetachedFixtures(state,next);
}
function settleDetachedFixtures(previous: AssemblyState, next: AssemblyState): ActionResult {
  const fixtures = next.items.filter(item => item.parentId === "ground" && previous.items.find(old=>old.id===item.id)?.parentId !== "ground")
    .sort((a,b)=>Number(getProduct(b.productId).category === "house")-Number(getProduct(a.productId).category === "house"));
  if (!fixtures.length) return action(previous,next);
  const deferred = new Set(fixtures.flatMap(item=>[...ownedFamily(next,item.id)]));
  let settled = {...next,items:next.items.filter(item=>!deferred.has(item.id))};
  const initial = action(previous,settled); if (!initial.ok) return initial; settled=initial.state;
  for (const root of fixtures) {
    const group = ownedFamily(next,root.id), family = next.items.filter(item=>group.has(item.id));
    const offsets:[number,number][]=[[0,0]];
    // Preserve XY when possible; only a newly grounded family that would collide
    // moves to the nearest free ground, with its internal layout kept intact.
    for (let radius=25;radius<=1500;radius+=25) for(let x=-radius;x<=radius;x+=25) for(const y of [-radius,radius]) offsets.push([x,y]);
    for (let radius=25;radius<=1500;radius+=25) for(let y=-radius+25;y<radius;y+=25) for(const x of [-radius,radius]) offsets.push([x,y]);
    offsets.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
    let found:AssemblyState|undefined;
    for (const [dx,dy] of offsets) {
      const moved=family.map(item=>({...item,x:round(item.x+dx),y:round(item.y+dy)}));
      const world=physicalState(settled), pose={...moved[0],z:moved[0].z+settled.bedding.depth,key:"settle",magnetCount:0};
      if (Math.abs(pose.x)>2000 || Math.abs(pose.y)>2000 || !compatiblePlacement(world,getProduct(root.productId),pose,groundSurface(world),new Set())) continue;
      const result=action(previous,{...settled,items:[...settled.items,...moved]});
      if(result.ok){found=result.state;break;}
    }
    if(!found) return {ok:false,state:previous,reason:"地面暂时没有足够空间，请先调整附近组件"};
    settled=found;
  }
  return {ok:true,state:settled};
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
    const bedding = normalizeBedding(value), platforms = getPlatforms(state);
    const next: AssemblyState = { ...state, bedding };
    // Raising thick bedding raises only positive legs that would otherwise be buried.
    // Snapshot each old height before updating the base so legacy inherited heights
    // and deliberately legless platforms keep their own settings.
    for (const platform of platforms) {
      const legHeight = bedding.mode === "thick" && platform.legHeight > 0 && platform.legHeight < bedding.depth
        ? bedding.depth : platform.legHeight;
      if (platform.id === "base") next.legHeight = legHeight;
      else {
        const key = platform.id === "base2" ? "extension" : platform.id === "base3" ? "thirdPlatform" : "fourthPlatform";
        next[key] = { ...state[key]!, legHeight };
      }
    }
    return action(state,next);
  } catch (error) { return { ok: false, state, reason: error instanceof Error ? error.message : "垫料设置无效" }; }
}
export function setLegHeight(state: AssemblyState, legHeight: AssemblyState["legHeight"], platformId: PlatformId = "base", applyAll = false): ActionResult {
  if (!getPlatforms(state).some(platform=>platform.id===platformId)) return {ok:false,state,reason:"未找到平台"};
  // Freeze legacy inherited heights before changing the base so other platforms stay put.
  let next = { ...state };
  for (const key of ["extension","thirdPlatform","fourthPlatform"] as const) if (state[key]) next[key] = { ...state[key], legHeight: state[key].legHeight ?? state.legHeight };
  for (const platform of getPlatforms(state)) if (applyAll || platform.id === platformId) {
    if (platform.id === "base") next.legHeight = legHeight;
    else {
      const key = platform.id === "base2" ? "extension" : platform.id === "base3" ? "thirdPlatform" : "fourthPlatform";
      next[key] = { ...next[key]!, legHeight };
    }
  }
  return action(state,next);
}
export function setItemDoorSide(state: AssemblyState, id: string, doorSide: "left" | "right"): ActionResult {
  if (doorSide !== "left" && doorSide !== "right") return {ok:false,state,reason:"门板方向无效"};
  const item = state.items.find(item=>item.id===id);
  if (!item || !hasReversiblePanel(item.productId)) return {ok:false,state,reason:"该组件不支持门板左右互换"};
  const {doorSide:_old,...rest} = item;
  const replacement = {...rest,...(doorSide==="left"?{doorSide}: {})};
  const world = physicalState(state), pose = {...replacement,z:replacement.z+getItemDisplayElevation(state,replacement)};
  if (doorwayLandings(pose).some(door=>world.items.some(other=>other.id!==id && solidCollisionBounds(getProduct(other.productId),other).some(box=>overlap(door.bounds,box)))))
    return {ok:false,state,reason:"这一侧门口被组件挡住，请先移开门前组件"};
  return action(state,{...state,items:state.items.map(other=>other.id===id ? replacement : other)});
}
export function setHamster(state: AssemblyState, hamster: string | null): ActionResult {
  return action(state, { ...state, hamster });
}
function updatePlatform(state: AssemblyState, id: PlatformId, changes: Partial<Pick<PlatformExtension, "baseInsert" | "baseColors" | "removedCovers">>): AssemblyState {
  return id === "base" ? { ...state, ...changes } : id === "base2" ? { ...state, extension: { ...state.extension!, ...changes } } : id === "base3" ? { ...state, thirdPlatform: { ...state.thirdPlatform!, ...changes } } : { ...state, fourthPlatform: { ...state.fourthPlatform!, ...changes } };
}
export function setCoverRemoved(state: AssemblyState, platformId: PlatformId, coverId: string, removed: boolean): ActionResult {
  if (!REMOVABLE_COVERS.includes(coverId as typeof REMOVABLE_COVERS[number])) return { ok: false, state, reason: "只能移除小圆盖，大圆盖会随泳池自动替换" };
  const platform = getPlatforms(state).find(p => p.id === platformId);
  if (!platform) return { ok: false, state, reason: "未找到平台" };
  if (!removed && state.items.some(item => item.parentId === platformId && getProduct(item.productId).attachment === "platform-hole" && holeForItem(item,platform) === coverId))
    return {ok:false,state,reason:"请先移除向下连通管道，再恢复圆盖"};
  const manual = manualRemovedCovers(state,platformId);
  const removedCovers = removed ? [...new Set([...manual, coverId])].sort() : manual.filter(id => id !== coverId);
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
/** Full rendered geometry, rather than only contact/collision allowances. */
export function getVisualItemBounds(item: Pick<AssemblyItem, "productId" | "x" | "y" | "z" | "rotation">): Bounds[] {
  const product = getProduct(item.productId);
  return product.parts.map(part => transformBox((modelIndex as Record<string, { bounds: number[] }>)[part.id].bounds as Bounds, product, item));
}
function doorwayLandings(item: Pick<AssemblyItem, "productId" | "x" | "y" | "z" | "rotation" | "doorSide">) {
  const product = getProduct(item.productId);
  return getHouseDoorways(product.id,item.doorSide).map(door => {
    const [x,y,z] = transformPoint(door.center, product, item), normal = rotateVector(door.normal, item.rotation);
    const [nx,ny] = normal;
    const bounds: Bounds = nx ? [Math.min(x,x+nx*door.depth),y-30,z+.5,Math.max(x,x+nx*door.depth),y+30,z+60]
      : [x-30,Math.min(y,y+ny*door.depth),z+.5,x+30,Math.max(y,y+ny*door.depth),z+60];
    return { bounds, normal, center: [x,y,z] as Vec3 };
  });
}
function containsFootprint(floors: Bounds[], bounds: Bounds, tolerance = EPS): boolean {
  return [bounds[0],(bounds[0]+bounds[3])/2,bounds[3]].every(x =>
    [bounds[1],(bounds[1]+bounds[4])/2,bounds[4]].every(y => floors.some(floor =>
      x >= floor[0]-tolerance && x <= floor[3]+tolerance && y >= floor[1]-tolerance && y <= floor[4]+tolerance)));
}
function placementFloors(state: AssemblyState, parentId: string): Bounds[] {
  const parent = state.items.find(item => item.id === parentId);
  if (parentId === "ground") return [groundSurface(state).bounds];
  if (!parent) { const host = getPlatforms(state).find(platform=>platform.id===parentId); return getPlatforms(state).filter(platform=>!host || close(platformTop(state,platform),platformTop(state,host))).map(platform => [platform.x,platform.y,platformTop(state,platform),platform.x+300,platform.y+300,platformTop(state,platform)]); }
  if (parent.productId === "l-house") return getItemBounds(parent);
  if (parent.productId === "villa") return [transformBox(modelIndex.A02.bounds as Bounds,getProduct(parent.productId),parent)];
  return getSurfaces(state,new Set()).filter(surface => surface.parentId === parentId).map(surface => surface.bounds);
}
function landingOverOpening(state: AssemblyState, bounds: Bounds, poolAccessPlatform?: string): boolean {
  return getPlatforms(state).some(platform => {
    if (!close(bounds[2],platformTop(state,platform)+.5)) return false;
    // The villa intentionally opens toward its matching pool; removed covers remain open holes.
    const circles: [number,number,number][] = platform.baseInsert === "pool" && platform.id !== poolAccessPlatform ? [[platform.x+100,platform.y+100,78]] : [];
    for (const id of platform.removedCovers) {
      const b = (modelIndex as Record<string,{bounds:number[]}>)[id].bounds;
      circles.push([platform.x+(b[0]+b[3])/2,platform.y+(b[1]+b[4])/2,33]);
    }
    return circles.some(([x,y,r]) => Math.hypot(Math.max(bounds[0],Math.min(x,bounds[3]))-x,Math.max(bounds[1],Math.min(y,bounds[4]))-y) < r-EPS);
  });
}
/** Automatic suggestions are stricter than manual magnetic placement: never
 * overhang the supporting floor, point a house backwards, or obstruct a door. */
export function getAutomaticPlacementIssues(state: AssemblyState, productId: string, placement: Placement): string[] {
  return worldAutomaticPlacementIssues(physicalState(state),productId,{...placement,z:placement.z+getPlacementDisplayElevation(state,placement)});
}
function worldAutomaticPlacementIssues(state: AssemblyState, productId: string, placement: Placement): string[] {
  const item = { ...placement, productId }, issues: string[] = [];
  const product = getProduct(productId);
  const holder = state.items.find(item=>item.id===placement.parentId);
  const floors = product.attachment === "room-floor" && holder ? getItemBounds(holder) : placementFloors(state,placement.parentId);
  const visual = getVisualItemBounds(item);
  // Bridges may cross a gap between roofs, but never the outer platform boundary.
  const outerFloors: Bounds[] = rootParent(state,placement.parentId) === "ground" ? [groundSurface(state).bounds] : getPlatforms(state).map(platform => [platform.x,platform.y,platformTop(state,platform),platform.x+300,platform.y+300,platformTop(state,platform)]);
  if (visual.some(bounds => !containsFootprint(outerFloors,bounds))) issues.push("overhang");
  if (product.supportMode !== "bridge" && visual.some(bounds => !containsFootprint(floors,bounds,state.items.some(parent => parent.id === placement.parentId) ? 1 : EPS))) issues.push("overhang");
  const doors = doorwayLandings(item);
  if (doors.length && !doors.some(door => productId === "pokemon-center" ? door.normal[1] < -.99
    : door.normal[0]*480 + door.normal[1]*-710 > 100)) issues.push("door-facing-away");
  for (const door of doors) {
    if (!containsFootprint(floors,door.bounds)) issues.push("door-outside-floor");
    if (landingOverOpening(state,door.bounds, productId === "villa" ? placement.parentId : undefined)) issues.push("door-over-opening");
    if (state.items.some(other => other.id !== placement.parentId && solidCollisionBounds(getProduct(other.productId),other).some(b => overlap(door.bounds,b)))) issues.push("door-blocked");
  }
  const candidateSolids = solidCollisionBounds(product,item);
  for (const other of state.items) {
    if (other.id === placement.parentId) continue;
    for (const door of doorwayLandings(other)) {
      // A bridge's 6.2 mm walking deck may meet a doorway; it is a landing, not a wall.
      const blocking = candidateSolids.filter(bounds => product.supportMode !== "bridge" || bounds[5] > door.center[2] + 10);
      if (blocking.some(bounds => overlap(bounds,door.bounds))) issues.push("blocks-existing-door");
    }
  }
  return [...new Set(issues)];
}
/** Prefer a visible front door and an unobstructed floor before compactness. */
export function autoPlace(state: AssemblyState, productId: string, preferredPlatformId?: PlatformId): ActionResult {
  const noSpaceReason = getPlatforms(state).length >= 4
    ? "没有足够空间，请调整现有布局"
    : "没有足够空间，请增加平台或者调整现有布局";
  if (productId === "pool" && getPlatforms(state).length) {
    for (const platform of getPlatforms(state).sort((a, b) => Number(b.id === preferredPlatformId) - Number(a.id === preferredPlatformId))) {
      if (platform.baseInsert === "pool") continue;
      const result = setPlatformPool(state, platform.id, true);
      if (result.ok) return result;
    }
    return { ok: false, state, reason: noSpaceReason };
  }
  try {
    const candidates = ([0, 90, 180, 270] as Rotation[]).flatMap(rotation => getPlacements(state, productId, rotation))
      .filter(placement => !getAutomaticPlacementIssues(state,productId,placement).length);
    const rootOf = (parentId: string): string => { const parent = state.items.find(item => item.id === parentId); return parent ? rootOf(parent.parentId) : parentId; };
    const compactScore = (placement: Placement) => {
      const siblings = state.items.filter(item => item.parentId === placement.parentId);
      if (siblings.length) return Math.min(...siblings.map(item => Math.hypot(item.x - placement.x, item.y - placement.y)));
      const platform = getPlatforms(state).find(p => p.id === rootOf(placement.parentId));
      const product = getProduct(productId);
      return Math.hypot(placement.x - product.origin[0] - (platform?.x ?? 0), placement.y - product.origin[1] - (platform?.y ?? 0));
    };
    const frontScore = (placement: Placement) => Math.max(0,...doorwayLandings({ ...placement, productId }).map(door => -door.normal[1]));
    candidates.sort((a, b) => (getProduct(productId).attachment === "room-floor" ? getRoomFloorPlacementScore(state,b)-getRoomFloorPlacementScore(state,a) : 0) || b.magnetCount - a.magnetCount || frontScore(b)-frontScore(a) || Number(rootOf(b.parentId) === preferredPlatformId) - Number(rootOf(a.parentId) === preferredPlatformId) || (productId === "pokemon-center" ? b.y - a.y : 0) || compactScore(a) - compactScore(b) || a.z - b.z || a.rotation - b.rotation || a.key.localeCompare(b.key));
    for (const candidate of candidates) {
      const result = tryPlace(state, productId, candidate, candidate.rotation);
      if (result.ok) return result;
    }
  } catch { /* Unknown products or unavailable placements must not change the assembly. */ }
  return { ok: false, state, reason: noSpaceReason };
}
function normalizeRemovedCovers(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => !REMOVABLE_COVERS.includes(id)) || new Set(value).size !== value.length) throw new Error("小圆盖配置无效");
  return [...value].sort();
}
/** Strict schema, coordinates, bundle contents, collision, and attachment validation on every import. */
export function validateAssembly(value: unknown): AssemblyState {
  // Convert the historical loose-panel flag into a complete fixed-wall variant.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as AssemblyState;
    if (Array.isArray(raw.items)) value = { ...raw, items: raw.items.map(item => {
      if (!item) return item;
      const pair = fixedDoorPair(item.productId);
      if (!pair || item.doorSide === undefined) return item;
      const { doorSide, ...rest } = item;
      const left = doorSide === "left";
      const colors = Object.fromEntries(Object.entries(item.colors).map(([key, color]) => [
        key === pair.body || key === pair.leftBody ? (left ? pair.leftBody : pair.body)
          : key === pair.roof || key === pair.leftRoof ? (left ? pair.leftRoof : pair.roof) : key, color,
      ]));
      return { ...rest, productId: left ? pair.left : pair.right, colors };
    }) };
  }
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
  if (!Array.isArray(input.items) || input.items.length > 196)
    throw new Error("组件数量无效");
  if (input.baseRemoved !== undefined && typeof input.baseRemoved !== "boolean") throw new Error("基础平台设置无效");
  const defaults = createInitialState();
  const state: AssemblyState = {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    legHeight: input.legHeight,
    ...(input.baseRemoved === true ? {baseRemoved:true} : {}),
    removedCovers: normalizeRemovedCovers(input.removedCovers),
    extension: null,
    thirdPlatform: null,
    fourthPlatform: null,
    bedding: normalizeBedding(input.bedding ?? defaults.bedding),
    cage: normalizeCage(input.cage === undefined ? DEFAULT_CAGE : input.cage),
    hamster: input.hamster ?? null,
    baseInsert: input.baseInsert,
    baseColors: normalizeColors(
      input.baseColors,
      Object.keys(defaults.baseColors),
      defaults.baseColors,
    ),
    items: [],
  };
  for (const [key, label] of [["extension", "第二个"], ["thirdPlatform", "第三个"], ["fourthPlatform", "第四个"]] as const) {
    const extension = input[key];
    if (extension === null || extension === undefined) continue;
    if (!extension || typeof extension !== "object" || Array.isArray(extension) || !Object.hasOwn(PLATFORM_OFFSETS, extension.direction) || (!legacyLayout && extension.direction !== "right") || !["lid", "pool"].includes(extension.baseInsert)) throw new Error(`${label}平台数据无效`);
    if (extension.legHeight !== undefined && ![0,100,200,300].includes(extension.legHeight)) throw new Error("支撑脚长度无效");
    state[key] = { ...(extension.legHeight !== undefined ? {legHeight:extension.legHeight} : {}), direction: extension.direction, baseInsert: extension.baseInsert, baseColors: normalizeColors(extension.baseColors, Object.keys(defaults.baseColors), defaults.baseColors), removedCovers: normalizeRemovedCovers(extension.removedCovers) };
  }
  if (input.items.length + getPlatforms(state).filter(platform=>platform.baseInsert === "pool").length > 196) throw new Error("组件数量无效");
  if (state.hamster !== null && (typeof state.hamster !== "string" || !HAMSTER_VARIANTS.some(variant => variant.id === state.hamster))) throw new Error("仓鼠品种无效");
  const ids = new Set<string>();
  const pending = input.items.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ||
      (["base", "base2", "base3", "base4", "ground"].includes(raw.id)) ||
      ids.has(raw.id)
    )
      throw new Error("组件编号无效或重复");
    ids.add(raw.id);
    const product = lookup(raw.productId);
    if (product.id === "pool" && raw.parentId !== "ground") throw new Error("泳池必须安装在平台预留孔中或放在地面");
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
    if (raw.doorSide !== undefined && (!hasReversiblePanel(product.id) || !["left","right"].includes(raw.doorSide))) throw new Error("门板方向无效");
    return {
      ...(raw.doorSide === "left" ? {doorSide:"left" as const} : {}),
      id: raw.id,
      productId: raw.productId,
      x: round(raw.x),
      y: round(raw.y),
      z: round(raw.z),
      rotation: raw.rotation,
      parentId: raw.parentId,
      colors: normalizeColors(
        product.id === "seesaw" && product.minimumMagnetMatches === 1 && raw.colors ? { "SS01-base": raw.colors.SS01, ...raw.colors } : raw.colors,
        getProductColorParts(product.id).map((p) => p.id),
        getDefaultColors(product.id),
      ),
    };
  });
  pending.sort((a,b) => Number(lookup(a.productId).supportMode === "bridge") - Number(lookup(b.productId).supportMode === "bridge"));
  while (pending.length) {
    const index = pending.findIndex(
      (i) =>
        i.parentId === "ground" || getPlatforms(state).some(p => p.id === i.parentId) || state.items.some((p) => p.id === i.parentId),
    );
    if (index === -1) throw new Error("组件依赖缺失或循环");
    const item = pending.splice(index, 1)[0];
    const world = physicalState(state), worldItem = {...item,z:item.z+getItemDisplayElevation(state,item)};
    const match = item.parentId === "ground" ? close(item.z,groundHeight(lookup(item.productId))) && compatiblePlacement(world,lookup(item.productId),{...worldItem,key:"ground-check",magnetCount:0},groundSurface(world),new Set(),lookup) : getPlacements(state, item.productId, item.rotation, undefined, lookup).some(
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
function legacyProductLookup(source: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): ProductLookup {
  return id => {
    const catalog9 = { ...getProduct(id), ...legacyCatalog9.products[id as keyof typeof legacyCatalog9.products] } as CollisionProduct;
    if (source === 9) return catalog9;
    const current = { ...catalog9, ...legacyCatalog8.products[id as keyof typeof legacyCatalog8.products] } as CollisionProduct;
    if (id === "seesaw" && source < 8) return { ...current, ...legacySeesaw } as CollisionProduct;
    if (source >= 7) return current;
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
    const state = validateAssemblyWithCatalog({ ...previous, items }, legacyProductLookup(7));
    const messages = previous.items.some(item => item.productId === "villa")
      ? [`二层平台已更新为 30 厘米宽，原有组件与配色已保留。${moved ? "二层花圃和食盆已随磁吸位向内移动 5 毫米。" : ""}`]
      : [];
    return { state, messages };
  } catch (error) {
    throw new Error(`旧搭配无法兼容 30 厘米二层平台，原存档已保留、组件未删除：${error instanceof Error ? error.message : "磁吸位不匹配"}`);
  }
}
/** Only old catalogs may relocate the enlarged four-contact rocker; never drop a part. */
function upgradeSeesawV17(previous: AssemblyState): AssemblyMigrationResult {
  const lookup = legacyProductLookup(8);
  const validate = (value: unknown) => validateAssemblyWithCatalog(value, lookup);
  const seesaws = previous.items.filter(item => item.productId === "seesaw");
  if (!seesaws.length) return { state: validate(previous), messages: [] };
  let state = validate({ ...previous, items: previous.items.filter(item => item.productId !== "seesaw") });
  const pending: AssemblyItem[] = [];
  for (const item of seesaws) {
    const matches = getPlacements(state, "seesaw", item.rotation, undefined, lookup).some(p => p.parentId === item.parentId && samePoint([p.x,p.y,p.z],[item.x,item.y,item.z]));
    if (matches) state = { ...state, items: [...state.items, item] };
    else pending.push(item);
  }
  for (const item of pending) {
    const choices = (current: AssemblyState) => ([0,90,180,270] as Rotation[]).flatMap(turn => getPlacements(current, "seesaw", turn, undefined, lookup))
      .filter(p => p.parentId === item.parentId)
      .sort((a,b) => Math.hypot(a.x-item.x,a.y-item.y)-Math.hypot(b.x-item.x,b.y-item.y) || Number(a.rotation !== item.rotation)-Number(b.rotation !== item.rotation) || a.key.localeCompare(b.key));
    let candidate = choices(state)[0];
    // Old official pool/hat layouts can leave enough room only after moving a
    // small single-contact accessory. Preserve its parent, direction and color.
    if (!candidate) {
      const smallItems = state.items.filter(other => other.parentId === item.parentId && ["planter", "food-bowl"].includes(other.productId));
      for (const small of smallItems) {
        const without = { ...state, items: state.items.filter(other => other.id !== small.id) };
        const options = getPlacements(without, small.productId, small.rotation, undefined, lookup).filter(p => p.parentId === small.parentId)
          .sort((a,b) => Math.hypot(a.x-small.x,a.y-small.y)-Math.hypot(b.x-small.x,b.y-small.y) || a.key.localeCompare(b.key));
        for (const point of options) {
          const adjusted = { ...state, items: state.items.map(other => other.id === small.id ? { ...small, x:point.x, y:point.y, z:point.z } : other) };
          candidate = choices(adjusted)[0];
          if (candidate) { state = adjusted; break; }
        }
        if (candidate) break;
      }
    }
    if (!candidate) throw new Error("新版四磁吸跷跷板需要更大空间，旧搭配无法完整安装；原存档已保留，组件未删除，请调整布局后重试。");
    state = { ...state, items: [...state.items, { ...item, x:candidate.x, y:candidate.y, z:candidate.z, rotation:candidate.rotation, parentId:candidate.parentId }] };
  }
  return { state: validate(state), messages: ["跷跷板已更新为四点磁吸防滑版，原有配色已保留；安装位置已按新底座调整，必要时同平台的小配件会移到附近空位。"] };
}
/** A roof moves its complete descendant family, including nested roofs and bridges.
 * Origins and lower hardware stay fixed; each raised ancestor contributes once.
 * Validate the historical layout first, then the complete migrated layout. */
function upgradeStorey90(previous: AssemblyMigrationResult): AssemblyMigrationResult {
  const delta: Record<string, number> = { "l-house": 4.4, "cube-house": 6.6, "milk-house-left": 6.6, "milk-house-right": 6.6, "milk-house-double": 6.6 };
  const byId = new Map(previous.state.items.map(item => [item.id, item]));
  const offsets = new Map<string, number>();
  const offset = (id: string): number => {
    if (offsets.has(id)) return offsets.get(id)!;
    const item = byId.get(id), parent = item && byId.get(item.parentId);
    const value = parent ? round(offset(parent.id) + (delta[parent.productId] ?? 0)) : 0;
    offsets.set(id, value);
    return value;
  };
  const items = previous.state.items.map(item => ({ ...item, z: round(item.z + offset(item.id)) }));
  const affected = items.some(item => delta[item.productId] || item.productId.startsWith("stairs-"));
  try {
    return upgradeMilk100({ state: validateAssemblyWithCatalog({ ...previous.state, items }, legacyProductLookup(9)), messages: [...previous.messages,
      ...(affected ? ["旧版叠放高度已升级，上层组件已随屋顶调整，原有位置、朝向与配色已保留。"] : [])] });
  } catch (error) {
    throw new Error(`旧搭配无法完整适配 9 cm 层高，原存档已保留、组件未删除：${error instanceof Error ? error.message : "组件安装冲突"}`);
  }
}
/** Carry each descendant by the sum of its changed ancestors; never mutate the saved input. */
function upgradeMilk100(previous: AssemblyMigrationResult): AssemblyMigrationResult {
  const raised = new Set(["milk-house-left", "milk-house-right", "milk-house-double", "milk-house-double-2x3"]);
  const byId = new Map(previous.state.items.map(item => [item.id, item]));
  const offsets = new Map<string, number>();
  const offset = (id: string): number => {
    if (offsets.has(id)) return offsets.get(id)!;
    const parent = byId.get(byId.get(id)?.parentId ?? "");
    const value = parent ? offset(parent.id) + (raised.has(parent.productId) ? 10 : 0) : 0;
    offsets.set(id, value); return value;
  };
  const items = previous.state.items.map(item => ({ ...item, z: round(item.z + offset(item.id)) }));
  const affected = items.some(item => raised.has(item.productId) || item.productId.startsWith("stairs-"));
  try {
    return { state: validateAssembly({ ...previous.state, items }), messages: [...previous.messages,
      ...(affected ? ["奶糖系列含盖高度及台阶已更新为 10 cm，屋顶上的组件已同步升高，配色与朝向已保留。"] : [])] };
  } catch (error) {
    throw new Error(`旧搭配无法完整适配奶糖 10 cm 高度，原存档已保留、组件未删除：${error instanceof Error ? error.message : "组件安装冲突"}`);
  }
}
/** Validate historical geometry before migrating; current configurations never receive placement repairs. */
export function migrateAssembly(value: unknown, sourceCatalogVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10): AssemblyMigrationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("搭配数据格式不正确");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.items)) throw new Error("组件数量无效");
  if (sourceCatalogVersion !== undefined && ![2, 3, 4, 5, 6, 7, 8, 9, CATALOG_VERSION].includes(sourceCatalogVersion)) throw new Error("搭配目录版本不兼容");
  if (sourceCatalogVersion !== undefined && raw.catalogVersion !== undefined && raw.catalogVersion !== sourceCatalogVersion) throw new Error("搭配目录版本标记冲突");
  const rawItems = raw.items;
  const villas = rawItems.filter(item => item && typeof item === "object" && item.productId === "villa");
  const inferredLegacy = raw.catalogVersion === undefined && villas.length > 0 && villas.every(item => hasLegacyVillaColors(item.colors));
  const source = sourceCatalogVersion ?? raw.catalogVersion ?? (inferredLegacy ? 2 : CATALOG_VERSION);
  if (source === CATALOG_VERSION) return { state: validateAssembly(value), messages: [] };
  if (source === 9) return upgradeMilk100({ state: validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION }, legacyProductLookup(9)), messages: [] });
  if (source === 8) return upgradeStorey90({ state: validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION }, legacyProductLookup(8)), messages: [] });
  if (source === 7) return upgradeStorey90(upgradeSeesawV17(validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION }, legacyProductLookup(7))));
  if (source === 6) {
    const deck = upgradeSteelV15(validateAssemblyWithCatalog({ ...raw, catalogVersion: CATALOG_VERSION }, legacyProductLookup(6)));
    const rocker = upgradeSeesawV17(deck.state);
    return upgradeStorey90({ state: rocker.state, messages: [...deck.messages, ...rocker.messages] });
  }
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
    const rocker = upgradeSeesawV17(current.state);
    return upgradeStorey90({ state: rocker.state, messages: [...messages, ...upgraded.messages, ...current.messages, ...rocker.messages] });
  } catch (error) {
    if (relocated !== previous) throw new Error(`旧平台布局无法兼容右侧连续布局，原存档已保留：${error instanceof Error ? error.message : "组件相撞"}`);
    throw error;
  }
}

export function getOrderLines(state: AssemblyState): OrderLine[] {
  const lines: OrderLine[] = [];
  for (const platform of getPlatforms(state)) {
    const legHeight = platform.legHeight;
    const basePrice = BASE_PRODUCT.price + (legHeight === 300 ? BASE_PRODUCT.extraTallLegSurcharge : legHeight === 200 ? BASE_PRODUCT.tallLegSurcharge : 0) - (legHeight === 0 ? BASE_PRODUCT.noLegDiscount : 0);
    const baseParts = getBaseParts(legHeight, platform.baseInsert).filter(part => part.id !== "B01" && !platform.removedCovers.includes(part.id));
    const baseColorKeys = [...baseParts.filter(part => !/^[LXY]0[1-4]$/.test(part.id)).map(part => part.id), ...(legHeight ? ["legs"] : [])];
    lines.push({ id: platform.id, sku: `${BASE_PRODUCT.sku}-${legHeight}`, name: `${BASE_PRODUCT.name} · ${legHeight ? `${legHeight / 10} cm 腿` : "无腿"}${platform.id === "base2" ? " · 第二平台" : platform.id === "base3" ? " · 第三平台" : platform.id === "base4" ? " · 第四平台" : ""}`, quantity: 1, unitPrice: basePrice, total: basePrice, parts: baseParts.map(part => part.id), colors: Object.fromEntries(baseColorKeys.map(key => [key, platform.baseColors[key]])) });
    if (platform.baseInsert === "pool") {
      const pool = getProduct("pool");
      lines.push({ id: `pool-${platform.id}`, sku: pool.sku, name: pool.name, quantity: 1, unitPrice: pool.price, total: pool.price, parts: ["B01"], colors: { B01: platform.baseColors.B01, "B01-rim": platform.baseColors["B01-rim"] } });
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
