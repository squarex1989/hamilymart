import * as THREE from "three";
import { HAMSTER_VARIANTS } from "../data/hamsters";
import type { HamsterVariant } from "../data/hamsters";
import { getProduct } from "../data/catalog";
import type { Vec3 } from "../data/catalog";
import { getPlatforms, getDisplayElevation, transformPoint, getItemBounds } from "./assembly";
import type { AssemblyState } from "./assembly";

/** Z-up, millimetres. Edges are reversible, physically checked motion segments. */
export interface HamsterWalkSample { point: Vec3; region: string }
export interface HamsterNavNode extends HamsterWalkSample { links: number[] }
const STEP = 12;
const lengthXY = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as Vec3;
const xyKey = (p: Vec3, spacing: number) => `${Math.round(p[0] / spacing)},${Math.round(p[1] / spacing)}`;

export function connectWalkSurfaceSamples(samples: HamsterWalkSample[], spacing: number, isClear: (a: HamsterWalkSample, b: HamsterWalkSample) => boolean): HamsterNavNode[] {
  const nodes = samples.map(s => ({ ...s, point: [...s.point] as Vec3, links: [] as number[] }));
  const buckets = new Map<string, number[]>();
  nodes.forEach((n, i) => { const k = xyKey(n.point, spacing); buckets.set(k, [...(buckets.get(k) ?? []), i]); });
  nodes.forEach((a, i) => {
    const x = Math.round(a.point[0] / spacing), y = Math.round(a.point[1] / spacing);
    // Cardinal edges avoid cutting through the inside corner of a solid wall.
    for (const [dx, dy] of [[1, 0], [0, 1]]) for (const j of buckets.get(`${x + dx},${y + dy}`) ?? []) {
      const b = nodes[j];
      if (lengthXY(a.point, b.point) > spacing + .01 || lengthXY(a.point, b.point) < spacing * .5) continue;
      if (Math.abs(a.point[2] - b.point[2]) > Math.min(14, spacing * .8) + 1e-8) continue;
      if (!isClear(a, b)) continue;
      a.links.push(j); b.links.push(i);
    }
  });
  return nodes;
}
export function findHamsterPath(nodes: HamsterNavNode[], from: number, to: number): number[] {
  if (!nodes[from] || !nodes[to]) return [];
  const queue = [from], previous = new Map<number, number>([[from, -1]]);
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === to) { const path = [at]; while (previous.get(path[0]) !== -1) path.unshift(previous.get(path[0])!); return path; }
    for (const next of nodes[at].links) if (nodes[next] && !previous.has(next)) { previous.set(next, at); queue.push(next); }
  }
  return [];
}
export function canUseBurrow(bodyLength: number, holeRadius: number, dropToBedding: number): boolean {
  return bodyLength > 0 && holeRadius + 1e-8 >= bodyLength * .24 + 3 && Math.max(0, dropToBedding) <= bodyLength * .65 + 10 + 1e-8;
}

interface Pet {
  root: THREE.Group; stance: THREE.Group; head: THREE.Group; feet: THREE.Mesh[];
  geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>;
}
/** Shared low-poly primitives keep the nine coats inexpensive on a phone. */
function makePet(variant: HamsterVariant): Pet {
  const root = new THREE.Group(); root.name = `hamster-${variant.id}`;
  const stance = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group();
  const size = variant.size;
  stance.position.set(-.22 * size, 0, .045 * size); body.position.set(.22 * size, 0, -.045 * size);
  root.add(stance); stance.add(body);
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  const geometries = new Set<THREE.BufferGeometry>([sphere]);
  const material = (color: string, roughness = .9) => new THREE.MeshStandardMaterial({ color, roughness });
  const fur = material(variant.primary), cream = material(variant.secondary), pink = material("#DCA2A0"), dark = material("#39322E"), eyes = material("#181517", .22), shine = material("#FFFFFF", .18);
  const materials = new Set<THREE.Material>([fur, cream, pink, dark, eyes, shine]);
  const ball = (parent: THREE.Object3D, mat: THREE.Material, p: Vec3, scale: Vec3) => {
    const m = new THREE.Mesh(sphere, mat); m.position.set(...p.map(v => v * size) as Vec3); m.scale.set(...scale.map(v => v * size) as Vec3); m.castShadow = true; parent.add(m); return m;
  };
  ball(body, variant.pattern === "panda" ? cream : fur, [-.09, 0, .24], [.35, .23, .23]);
  ball(body, cream, [-.06, 0, .125], [.31, .185, .115]);
  if (variant.pattern === "banded") ball(body, cream, [-.1, 0, .244], [.12, .232, .231]);
  if (variant.pattern === "panda") { ball(body, fur, [-.25, 0, .25], [.17, .218, .215]); ball(body, fur, [.08, 0, .255], [.085, .218, .20]); }
  if (variant.pattern === "dorsal") ball(body, dark, [-.085, 0, .466], [.275, .032, .014]);
  head.position.set(.23 * size, 0, .255 * size); body.add(head);
  ball(head, variant.pattern === "panda" ? cream : fur, [0, 0, 0], [.23, .212, .208]);
  for (const side of [-1, 1]) {
    const ear = ball(head, variant.pattern === "panda" ? dark : fur, [-.085, side * .145, .175], [.072, .066, .088]); ear.rotation.x = side * -.22;
    ball(head, pink, [-.069, side * .153, .184], [.027, .049, .057]);
    ball(head, cream, [.132, side * .09, -.067], [.115, .125, .105]);
    if (variant.pattern === "panda") ball(head, fur, [.10, side * .17, .033], [.094, .065, .091]);
    ball(head, eyes, [.132, side * .169, .047], [.043, .030, .046]);
    ball(head, shine, [.148, side * .184, .066], [.012, .009, .013]);
    // Roborovski's pale eyebrow gives the smallest variant its characteristic face.
    if (variant.id.startsWith("robo")) ball(head, cream, [.113, side * .17, .108], [.072, .032, .031]);
  }
  ball(head, pink, [.233, 0, -.052], [.035, .042, .028]);
  ball(head, dark, [.22, 0, -.092], [.007, .030, .008]);
  const whiskerMaterial = new THREE.LineBasicMaterial({ color: "#6B5B50", transparent: true, opacity: .62 }); materials.add(whiskerMaterial);
  for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(.20 * size, side * .061 * size, -.06 * size),
      new THREE.Vector3((.22 - Math.abs(i) * .045) * size, side * .30 * size, (-.05 + i * .046) * size),
    ]); geometries.add(geometry); head.add(new THREE.Line(geometry, whiskerMaterial));
  }
  const feet: THREE.Mesh[] = [];
  for (const x of [-.27, .22]) for (const y of [-.155, .155]) feet.push(ball(body, pink, [x, y, .035], [.088, .052, .033]));
  const chinese = variant.id.startsWith("chinese");
  ball(body, pink, [-.435, 0, .135], [chinese ? .13 : .052, .037, .039]);
  root.userData.hamsterSimulation = true;
  return { root, stance, head, feet, geometries, materials };
}
function disposePet(pet: Pet | null) { if (!pet) return; pet.root.removeFromParent(); pet.geometries.forEach(g => g.dispose()); pet.materials.forEach(m => m.dispose()); }

interface Collider { mesh: THREE.Mesh; bounds: THREE.Box3; part: string; normal: THREE.Matrix3 }
interface WorldProbe {
  floors(x: number, y: number): HamsterWalkSample[];
  clear(point: Vec3, climbing?: boolean): boolean;
  segment(a: HamsterWalkSample, b: HamsterWalkSample): boolean;
  straight(a: Vec3, b: Vec3, margin?: number): boolean;
}
const openings: [string, number, number][] = [["H01", 50, 250], ["H02", 150, 250], ["H03", 250, 250], ["H04", 250, 150], ["H05", 250, 50]];
function collectColliders(scene: THREE.Scene): Collider[] {
  const result: Collider[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    let parent: THREE.Object3D | null = object, environment = false;
    while (parent) { if (parent.userData.hamsterSimulation) return; if (parent.userData.hamsterEnvironment) environment = true; if (!parent.visible) return; parent = parent.parent; }
    // GLB sourceGroup is also available when an integration uses a different parent group.
    if (!environment && !object.userData.sourceGroup) return;
    const part = String(object.userData.sourceGroup ?? object.name.split("_")[0]);
    result.push({ mesh: object, bounds: new THREE.Box3().setFromObject(object), part, normal: new THREE.Matrix3().getNormalMatrix(object.matrixWorld) });
  });
  return result;
}
/** A small XY acceleration grid avoids scanning entire GLB meshes for each paw probe. */
class TriangleIndex {
  private cells = new Map<string, number[]>();
  private triangles: number[][] = [];
  private parts: string[] = [];
  private marks: number[] = [];
  private query = 0;
  readonly cellSize = 24;
  add(v: number[], part: string) {
    const loX = Math.min(v[0], v[3], v[6]), hiX = Math.max(v[0], v[3], v[6]);
    const loY = Math.min(v[1], v[4], v[7]), hiY = Math.max(v[1], v[4], v[7]);
    const loZ = Math.min(v[2], v[5], v[8]), hiZ = Math.max(v[2], v[5], v[8]);
    const id = this.triangles.length;
    this.triangles.push([...v, loZ, hiZ]); this.parts.push(part); this.marks.push(0);
    for (let x = Math.floor(loX / this.cellSize); x <= Math.floor(hiX / this.cellSize); x++) for (let y = Math.floor(loY / this.cellSize); y <= Math.floor(hiY / this.cellSize); y++) {
      const key = `${x},${y}`, list = this.cells.get(key);
      if (list) list.push(id); else this.cells.set(key, [id]);
    }
  }
  hits(origin: Vec3, direction: THREE.Vector3, far: number, firstOnly = false) {
    const end = origin.map((v, i) => v + direction.getComponent(i) * far);
    const loX = Math.floor(Math.min(origin[0], end[0]) / this.cellSize), hiX = Math.floor(Math.max(origin[0], end[0]) / this.cellSize);
    const loY = Math.floor(Math.min(origin[1], end[1]) / this.cellSize), hiY = Math.floor(Math.max(origin[1], end[1]) / this.cellSize);
    const loZ = Math.min(origin[2], end[2]), hiZ = Math.max(origin[2], end[2]);
    const result: { point: THREE.Vector3; normal: THREE.Vector3; part: string }[] = [];
    this.query++;
    for (let x = loX; x <= hiX; x++) for (let y = loY; y <= hiY; y++) for (const id of this.cells.get(`${x},${y}`) ?? []) {
      if (this.marks[id] === this.query) continue; this.marks[id] = this.query;
      const t = this.triangles[id];
      if (hiZ < t[9] - .01 || loZ > t[10] + .01) continue;
      const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
      const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
      const px = direction.y * bz - direction.z * by, py = direction.z * bx - direction.x * bz, pz = direction.x * by - direction.y * bx;
      const determinant = ax * px + ay * py + az * pz;
      // Floor queries use upward outward faces. Clearance queries see both
      // sides, so a probe accidentally inside solid material is also rejected.
      if (firstOnly ? Math.abs(determinant) < 1e-9 : determinant < 1e-9) continue;
      const tx = origin[0] - t[0], ty = origin[1] - t[1], tz = origin[2] - t[2], inverse = 1 / determinant;
      const u = (tx * px + ty * py + tz * pz) * inverse;
      if (u < -.00001 || u > 1.00001) continue;
      const qx = ty * az - tz * ay, qy = tz * ax - tx * az, qz = tx * ay - ty * ax;
      const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
      if (v < -.00001 || u + v > 1.00001) continue;
      const distance = (bx * qx + by * qy + bz * qz) * inverse;
      if (distance < .12 || distance > far) continue;
      result.push({ point: new THREE.Vector3(...origin).addScaledVector(direction, distance), normal: new THREE.Vector3(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx).normalize(), part: this.parts[id] });
      if (firstOnly) return result;
    }
    return result;
  }
}
function* indexTriangles(colliders: Collider[]): Generator<void, TriangleIndex> {
  const result = new TriangleIndex(), v = new THREE.Vector3();
  for (const { mesh, part } of colliders) {
    const positions = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index;
    if (!positions) continue;
    const count = indices ? indices.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      const points: number[] = [];
      for (let k = 0; k < 3; k++) { const at = indices ? indices.getX(i + k) : i + k; v.fromBufferAttribute(positions, at).applyMatrix4(mesh.matrixWorld); points.push(v.x, v.y, v.z); }
      result.add(points, part);
      if (i % 768 === 0) yield;
    }
  }
  return result;
}
function makeProbe(state: AssemblyState, variant: HamsterVariant, spatial: TriangleIndex): WorldProbe {
  const radius = variant.size * .24, height = variant.size * .51, elevation = getDisplayElevation(state);
  const platforms = getPlatforms(state), up = new THREE.Vector3(0, 0, 1), down = new THREE.Vector3(0, 0, -1);
  const boxes = state.items.flatMap(item => getItemBounds(item).map(box => ({ item, box })));
  const hits = (origin: Vec3, direction: THREE.Vector3, far: number, firstOnly = false) => spatial.hits(origin, direction, far, firstOnly);
  const clear = (point: Vec3, climbing = false) => {
    const [x, y, z] = point;
    // G05 has shallow tread ridges: the interpolated foot plane may pass up
    // to 7 mm below their peaks. Start its headroom test above those ridges;
    // transverse body clearance and the support-height limit still apply.
    if (hits([x, y, z + (climbing ? 7 : 1)], up, height, true).length) return false;
    const level = z + height * (climbing ? .84 : .55);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      if (hits([x, y, level], new THREE.Vector3(Math.cos(a), Math.sin(a), 0), radius + 1.5, true).length) return false;
    }
    return true;
  };
  const floors = (x: number, y: number) => {
    const found: HamsterWalkSample[] = [];
    const platform = platforms.find(p => x >= p.x + radius && x <= p.x + 300 - radius && y >= p.y + radius && y <= p.y + 300 - radius)
      ?? platforms.find(p => x >= p.x && x <= p.x + 300 && y >= p.y && y <= p.y + 300 &&
        // A shared platform seam is supported on both sides, unlike an outer edge.
        [[-radius, 0], [radius, 0], [0, -radius], [0, radius]].every(([dx, dy]) => platforms.some(q => x + dx >= q.x && x + dx <= q.x + 300 && y + dy >= q.y && y + dy <= q.y + 300)));
    if (!platform) return found;
    const localX = x - platform.x, localY = y - platform.y;
    const inPool = platform.baseInsert === "pool" && Math.hypot(localX - 100, localY - 100) < 78 + radius * .3;
    const open = openings.some(([id, hx, hy]) => platform.removedCovers.includes(id) && Math.hypot(localX - hx, localY - hy) < 33 + radius * .25);
    if (!inPool && !open) found.push({ point: [x, y, 110 + elevation], region: "platform" });
    // Bedding is a support surface, never an invisible bridge across an empty basin.
    if (!inPool) found.push({ point: [x, y, state.bedding.depth], region: "bedding" });
    if (boxes.some(({ box }) => x >= box[0] - 1 && x <= box[3] + 1 && y >= box[1] - 1 && y <= box[4] + 1)) {
      const high = 600 + elevation;
      for (const hit of hits([x, y, high], down, high + 2)) {
        if (/^(P01|H0[1-6]|[LX]0[1-4]|B01)$/.test(hit.part) || hit.normal.z < .44 || hit.point.z < state.bedding.depth - .5) continue;
        const part = hit.part;
        const region = part === "G05" ? "stairs" : part;
        if (!found.some(s => Math.abs(s.point[2] - hit.point.z) < 1)) found.push({ point: [x, y, hit.point.z], region });
      }
    }
    return found.filter(s => clear(s.point, s.region === "stairs"));
  };
  const straight = (a: Vec3, b: Vec3, margin = 0) => {
    const dir = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), length = dir.length();
    if (length < .1) return true;
    return !hits(a, dir.normalize(), Math.max(.1, length - margin), true).length;
  };
  const segment = (a: HamsterWalkSample, b: HamsterWalkSample) => {
    const p = mix(a.point, b.point, .5), climbing = a.region === "stairs" || b.region === "stairs";
    if (!clear(p, climbing)) return false;
    const support = floors(p[0], p[1]);
    if (!support.some(s => Math.abs(s.point[2] - p[2]) < (climbing ? 7 : 3))) return false;
    const dz = height * .65;
    if (!straight([a.point[0], a.point[1], a.point[2] + dz], [b.point[0], b.point[1], b.point[2] + dz])) return false;
    // Check the long nose/body capsule as well as its transverse width. The
    // height follows a real ramp, rather than driving a horizontal head into it.
    const run = lengthXY(a.point, b.point), dx = (b.point[0] - a.point[0]) / run, dy = (b.point[1] - a.point[1]) / run;
    const rise = (b.point[2] - a.point[2]) / run, rear = variant.size * .29, nose = variant.size * .43;
    for (const side of [-1, 1]) {
      const lateral = radius * .58 * side;
      const start: Vec3 = [a.point[0] - dx * rear - dy * lateral, a.point[1] - dy * rear + dx * lateral, a.point[2] + dz - rise * rear];
      const end: Vec3 = [b.point[0] + dx * nose - dy * lateral, b.point[1] + dy * nose + dx * lateral, b.point[2] + dz + rise * nose];
      if (!straight(start, end)) return false;
    }
    return true;
  };
  return { floors, clear, segment, straight };
}

interface Excursion { node: number; points: Vec3[]; kind: "burrow" | "basin" }
function excursions(state: AssemblyState, variant: HamsterVariant, nodes: HamsterNavNode[], probe: WorldProbe): Excursion[] {
  const result: Excursion[] = [], elevation = getDisplayElevation(state), level = 110 + elevation, radius = variant.size * .24;
  const nearest = (point: Vec3, max: number) => {
    let best = -1, length = max;
    nodes.forEach((n, i) => { const d = distance(n.point, point); if (n.links.length && d < length) { best = i; length = d; } }); return best;
  };
  for (const platform of getPlatforms(state)) {
    for (const [id, x, y] of openings) {
      if (!platform.removedCovers.includes(id) || !canUseBurrow(variant.size, 33, level - state.bedding.depth)) continue;
      for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = x + platform.x, cy = y + platform.y;
        const at = nearest([cx + nx * (33 + radius * .5), cy + ny * (33 + radius * .5), level], STEP * 1.6);
        if (at < 0 || nodes[at].region === "bedding") continue;
        const above: Vec3 = [cx, cy, level + 2];
        if (!probe.clear(above) || !probe.straight([nodes[at].point[0], nodes[at].point[1], level + variant.size * .3], [cx, cy, level + variant.size * .3])) continue;
        const below: Vec3 = [cx, cy, Math.min(level - 12, state.bedding.depth - variant.size * .45)];
        result.push({ node: at, kind: "burrow", points: [nodes[at].point, above, below] }); break;
      }
    }
    if (platform.baseInsert !== "pool") continue;
    const cx = platform.x + 100, cy = platform.y + 100, inner = 69 - radius - 4;
    if (inner < 14) continue;
    for (const [nx, ny] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const at = nearest([cx + nx * (78 + radius + 3), cy + ny * (78 + radius + 3), level], STEP * 1.7);
      if (at < 0 || Math.abs(nodes[at].point[2] - level) > 4) continue;
      const rim: Vec3 = [cx + nx * 78, cy + ny * 78, 114 + elevation];
      const lip: Vec3 = [cx + nx * inner, cy + ny * inner, 114 + elevation];
      const bottom: Vec3 = [lip[0], lip[1], 33.7 + elevation];
      if (!probe.clear(lip, true) || !probe.clear(bottom) || !probe.straight([lip[0], lip[1], lip[2] + 2], [bottom[0], bottom[1], bottom[2] + 2], 1)) continue;
      if (!probe.straight([nodes[at].point[0], nodes[at].point[1], level + variant.size * .4], [lip[0], lip[1], lip[2] + variant.size * .4])) continue;
      const middle: Vec3 = [cx, cy, bottom[2]];
      result.push({ node: at, kind: "basin", points: [nodes[at].point, rim, lip, bottom, middle, [cx - ny * inner * .6, cy + nx * inner * .6, bottom[2]], middle, bottom, lip, rim, nodes[at].point] }); break;
    }
  }
  return result;
}

function* buildNetwork(state: AssemblyState, variant: HamsterVariant, probe: WorldProbe): Generator<void, HamsterNavNode[]> {
  const platforms = getPlatforms(state), seen = new Set<string>(), samples: HamsterWalkSample[] = [];
  for (const platform of platforms) for (let x = Math.ceil(platform.x / STEP) * STEP; x <= platform.x + 300; x += STEP) for (let y = Math.ceil(platform.y / STEP) * STEP; y <= platform.y + 300; y += STEP) {
    const key = `${x},${y}`;
    if (!seen.has(key)) { seen.add(key); samples.push(...probe.floors(x, y)); }
    yield;
  }
  // Allocate links separately so geometry queries are spread over animation frames.
  const graph = connectWalkSurfaceSamples(samples, STEP, () => true);
  for (let i = 0; i < graph.length; i++) {
    for (const j of [...graph[i].links]) if (j > i && !probe.segment(graph[i], graph[j])) { graph[i].links = graph[i].links.filter(k => k !== j); graph[j].links = graph[j].links.filter(k => k !== i); }
    yield;
  }
  // G05 is an actual steep walking ramp. Only this source-backed surface may
  // exceed an ordinary step; nearby roofs do not gain invented ladder links.
  const columns = new Map<string, number[]>();
  graph.forEach((n, i) => { const key = xyKey(n.point, STEP); columns.set(key, [...(columns.get(key) ?? []), i]); });
  for (let i = 0; i < graph.length; i++) {
    const a = graph[i];
    if (a.region !== "stairs") continue;
    const x = Math.round(a.point[0] / STEP), y = Math.round(a.point[1] / STEP);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const j of columns.get(`${x + dx},${y + dy}`) ?? []) {
      const b = graph[j];
      if (i === j || a.links.includes(j) || Math.abs(a.point[2] - b.point[2]) > 17) continue;
      if (probe.segment(a, b)) { a.links.push(j); b.links.push(i); }
    }
    yield;
  }
  return graph;
}

/** Independent of React selection/colors. The caller updates after GLB objects mount. */
export function createHamsterSimulation(scene: THREE.Scene): { update(state: AssemblyState): void; tick(deltaSeconds: number): void; dispose(): void } {
  const group = new THREE.Group(); group.name = "hamster-simulation"; group.userData.hamsterSimulation = true; scene.add(group);
  let pet: Pet | null = null, variant: HamsterVariant | undefined, state: AssemblyState | null = null;
  let signature = "", probe: WorldProbe | null = null, building: Generator<void, HamsterNavNode[]> | null = null;
  let nodes: HamsterNavNode[] = [], trips: Excursion[] = [], currentNode = -1, route: number[] = [], targetTrip: Excursion | null = null;
  let tripPoints: Vec3[] = [], tripIndex = 0, tripKind: Excursion["kind"] | null = null;
  let time = 0, phase = 0, pause = 1, specialPause = 0, facing = 0, slope = 0, action: "sniff" | "rear" | "dig" = "sniff";
  let disposed = false, randomSeed = 92817;
  const random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
  const worldPoint = () => pet!.root.position.toArray() as Vec3;
  const choosePause = () => { pause = .7 + random() * 2.8; action = random() < .19 ? "rear" : random() < .25 ? "dig" : "sniff"; };
  const componentOf = (from: number) => {
    const list = [from], found = new Set([from]);
    for (let i = 0; i < list.length; i++) for (const next of nodes[list[i]].links) if (!found.has(next)) { found.add(next); list.push(next); }
    return list;
  };
  const finishBuild = (graph: HamsterNavNode[]) => {
    nodes = graph;
    if (!pet || !variant || !state || !probe) return;
    const prior = worldPoint(), level = 110 + getDisplayElevation(state);
    const valid = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.links.length);
    const nearby = valid.filter(({ n }) => distance(n.point, prior) < STEP * 1.7);
    // On initial placement use the accessible main platform, never an isolated roof.
    const first = nearby[0] ?? valid.filter(({ n }) => Math.abs(n.point[2] - level) < 6).sort((a, b) => lengthXY(a.n.point, [150, 65, level]) - lengthXY(b.n.point, [150, 65, level]))[0] ?? valid[0];
    if (!first) { pet.root.visible = false; group.userData.navigation = { ready: true, nodes: 0 }; return; }
    currentNode = first.i; pet.root.position.set(...first.n.point); pet.root.visible = true;
    route = []; trips = excursions(state, variant, nodes, probe); targetTrip = null; tripPoints = []; tripKind = null;
    pause = .35;
    const reachable = componentOf(currentNode);
    group.userData.navigation = { ready: true, nodes: nodes.length, reachable: reachable.length, excursions: trips.filter(t => reachable.includes(t.node)).length,
      reachableRegions: [...new Set(reachable.map(i => nodes[i].region))], maxHeight: Math.max(...reachable.map(i => nodes[i].point[2])), minHeight: Math.min(...reachable.map(i => nodes[i].point[2])),
      interiors: state.items.filter(item => ["villa", "l-house", "cube-house", "roof-cottage"].includes(item.productId)).map(item => {
        const source: Vec3 = item.productId === "villa" ? [100, 235, 110] : item.productId === "l-house" ? [50, 145, 0] : item.productId === "cube-house" ? [50, 50, 0] : [78, 239, 200];
        const target = transformPoint(source, getProduct(item.productId), item); target[2] += getDisplayElevation(state!);
        return { id: item.id, reachable: reachable.some(i => lengthXY(nodes[i].point, target) < STEP * 2 && Math.abs(nodes[i].point[2] - target[2]) < 8) };
      }) };
  };
  const chooseRoute = () => {
    if (!pet || currentNode < 0) return;
    const component = componentOf(currentNode), possible = trips.filter(t => component.includes(t.node));
    if (possible.length && random() < .24) {
      targetTrip = possible[Math.floor(random() * possible.length)]; route = findHamsterPath(nodes, currentNode, targetTrip.node).slice(1); return;
    }
    targetTrip = null;
    const away = component.filter(i => distance(nodes[i].point, nodes[currentNode].point) > 55);
    const goals = away.length ? away : component;
    route = findHamsterPath(nodes, currentNode, goals[Math.floor(random() * goals.length)]).slice(1);
    if (!route.length) choosePause();
  };
  const beginTrip = () => {
    if (!targetTrip) return;
    tripKind = targetTrip.kind; tripPoints = targetTrip.points.map(p => [...p] as Vec3);
    if (tripKind === "burrow") tripPoints.push(...targetTrip.points.slice(0, -1).reverse().map(p => [...p] as Vec3));
    tripIndex = 1; targetTrip = null;
  };
  const moveToward = (target: Vec3, dt: number, climbing = false) => {
    if (!pet || !variant) return false;
    const p = worldPoint(), d = distance(p, target);
    if (d < .25) { pet.root.position.set(...target); return true; }
    const xy = lengthXY(p, target), speed = variant.size * (climbing ? .34 : .70), step = Math.min(d, speed * dt);
    const vector = new THREE.Vector3(...target).sub(pet.root.position);
    if (xy > .15) facing = Math.atan2(vector.y, vector.x);
    slope = Math.max(-.85, Math.min(.85, -Math.atan2(vector.z, Math.max(1, xy))));
    pet.root.position.addScaledVector(vector.normalize(), step); phase += step / variant.size * 17;
    return step >= d - .001;
  };
  return {
    update(next) {
      if (disposed) return;
      const desired = HAMSTER_VARIANTS.find(v => v.id === next.hamster);
      state = next;
      const nextSignature = JSON.stringify({ hamster: next.hamster, leg: next.legHeight, bedding: next.bedding, platforms: getPlatforms(next).map(p => [p.id, p.x, p.y, p.baseInsert, p.removedCovers]), items: next.items.map(i => [i.id, i.productId, i.x, i.y, i.z, i.rotation, i.parentId]) });
      if (!desired) { disposePet(pet); pet = null; variant = undefined; signature = nextSignature; building = null; nodes = []; trips = []; return; }
      if (nextSignature === signature && pet) return;
      const oldPosition = pet?.root.position.clone();
      if (variant?.id !== desired.id || !pet) { disposePet(pet); pet = makePet(desired); group.add(pet.root); if (oldPosition) pet.root.position.copy(oldPosition); }
      variant = desired; signature = nextSignature;
      const colliders = collectColliders(scene);
      if (!colliders.length) { signature = ""; pet.root.visible = false; return; }
      const selectedVariant = variant;
      building = (function* () {
        const spatial = yield* indexTriangles(colliders);
        probe = makeProbe(next, selectedVariant, spatial);
        return yield* buildNetwork(next, selectedVariant, probe);
      })();
      // A layout edit may remove the support below the animal. Hide during the
      // new solve; normal walking never jumps between disconnected components.
      pet.root.visible = false; route = []; tripPoints = []; targetTrip = null; currentNode = -1;
      group.userData.navigation = { ready: false };
    },
    tick(deltaSeconds) {
      if (disposed || !pet || !variant) return;
      const dt = Math.min(.05, Math.max(0, deltaSeconds)); time += dt;
      if (building) {
        const started = performance.now();
        do { const step = building.next(); if (step.done) { building = null; finishBuild(step.value); break; } } while (performance.now() - started < 6);
      }
      if (!pet.root.visible || building) return;
      let moving = false;
      if (specialPause > 0) { specialPause -= dt; action = "dig"; }
      else if (tripPoints.length) {
        moving = true;
        const to = tripPoints[tripIndex], from = tripPoints[tripIndex - 1];
        if (moveToward(to, dt, Math.abs(to[2] - from[2]) > 6)) {
          if (tripKind === "burrow" && tripIndex === 2) specialPause = 1.2 + random() * 2;
          tripIndex++;
          if (tripIndex >= tripPoints.length) { tripPoints = []; tripKind = null; slope = 0; choosePause(); }
        }
      } else if (pause > 0) pause -= dt;
      else if (route.length) {
        moving = true; const next = route[0];
        if (moveToward(nodes[next].point, dt, nodes[next].region === "stairs")) { currentNode = next; route.shift(); }
      } else if (targetTrip) beginTrip();
      else { choosePause(); chooseRoute(); }
      const turn = Math.atan2(Math.sin(facing - pet.root.rotation.z), Math.cos(facing - pet.root.rotation.z));
      pet.root.rotation.z += turn * Math.min(1, dt * 9);
      pet.stance.rotation.y = moving ? slope : action === "rear" ? -.77 * Math.min(1, Math.max(0, Math.sin((pause + .2) * 1.6))) : 0;
      pet.stance.position.z = variant.size * (.045 + (moving ? Math.abs(Math.sin(phase * 2)) * .007 : .003 * Math.sin(time * 3)));
      pet.head.rotation.y = moving ? -.025 : .06 * Math.sin(time * 8);
      pet.head.rotation.z = moving ? 0 : .07 * Math.sin(time * 2.7);
      pet.feet.forEach((foot, i) => { const wave = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)); foot.rotation.y = moving ? wave * .30 : action === "dig" && i > 1 ? Math.sin(time * 18 + i) * .4 : 0; });
    },
    dispose() { if (disposed) return; disposed = true; building = null; disposePet(pet); pet = null; probe = null; state = null; group.removeFromParent(); nodes = []; trips = []; },
  };
}
