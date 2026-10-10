/** Real-GLB navigation smoke test: npx tsx scripts/check-hamster-scene.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getBaseParts, getProduct } from "../src/data/catalog";
import { createInitialState, tryPlace, getDisplayElevation, getPlatforms } from "../src/lib/assembly";
import type { AssemblyState } from "../src/lib/assembly";
import { createHamsterSimulation } from "../src/lib/hamster-scene";

const loader = new GLTFLoader(), cache = new Map<string, THREE.Group>();
async function load(id: string) {
  if (!cache.has(id)) {
    const data = readFileSync(new URL(`../public/models/${id}.glb`, import.meta.url));
    const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
    cache.set(id, gltf.scene);
  }
  return cache.get(id)!.clone(true);
}
async function environment(state: AssemblyState) {
  const scene = new THREE.Scene(), group = new THREE.Group();
  group.userData.hamsterEnvironment = true; scene.add(group);
  const elevation = getDisplayElevation(state);
  for (const platform of getPlatforms(state)) {
    const frame = new THREE.Group(); frame.position.set(platform.x, platform.y, elevation); group.add(frame);
    for (const part of getBaseParts(state.legHeight, platform.baseInsert, platform.removedCovers)) frame.add(await load(part.id));
  }
  for (const item of state.items) {
    const product = getProduct(item.productId), frame = new THREE.Group(), source = new THREE.Group();
    frame.position.set(item.x, item.y, item.z + elevation); frame.rotation.z = THREE.MathUtils.degToRad(item.rotation);
    source.position.set(-product.origin[0], -product.origin[1], -product.origin[2]); frame.add(source); group.add(frame);
    for (const part of product.parts) source.add(await load(part.id));
  }
  group.updateMatrixWorld(true);
  return scene;
}
let villa: AssemblyState = { ...createInitialState(), hamster: "winter-pearl", legHeight: 300, bedding: { mode: "thick", depth: 300 } };
for (const [id, x, y, z] of [["villa", 150, 190, 110], ["roof-cottage", 78, 239, 200], ["food-bowl", 285.5, 264, 200]] as const) {
  const result = tryPlace(villa, id, { x, y, z }, 0); assert(result.ok, result.ok ? "" : result.reason); villa = result.state;
}
const cases: { label: string; state: AssemblyState; lowerThan?: number; returnHeight: number }[] = [
  { label: "thick-villa-interiors-and-stairs", state: villa, returnHeight: 400 },
  { label: "empty-basin-roundtrip", state: { ...createInitialState(), hamster: "winter-agouti", baseInsert: "pool" }, lowerThan: 35, returnHeight: 110 },
  { label: "H05-bedding-roundtrip", state: { ...createInitialState(), hamster: "winter-agouti", legHeight: 0, removedCovers: ["H05"] }, lowerThan: 25, returnHeight: 60 },
];
for (const { label, state, lowerThan, returnHeight } of cases) {
  const scene = await environment(state), simulation = createHamsterSimulation(scene), started = performance.now();
  simulation.update(state);
  const group = scene.children.find(object => object.name === "hamster-simulation")!;
  let frames = 0;
  while (!group.userData.navigation?.ready && frames++ < 2500) simulation.tick(.016);
  assert(group.userData.navigation?.ready, `${label}: navigation did not finish`);
  const buildMs = performance.now() - started, navigation = group.userData.navigation, pet = group.children[0];
  assert(pet.visible && navigation.reachable > 0, `${label}: no usable surface`);
  if (state.items.length) {
    assert(navigation.interiors.every((room: { reachable: boolean }) => room.reachable), "source door routes must reach the room interiors");
    assert(navigation.maxHeight >= 400 && navigation.reachableRegions.includes("stairs"), "upper platform must be reachable through G05");
  } else assert(navigation.excursions > 0, `${label}: missing safe return route`);
  let minZ = Infinity, maxZ = -Infinity, maximumFrameMove = 0, visitedLower = false, returned = false;
  const last = pet.position.clone();
  for (let i = 0; i < 25000; i++) {
    simulation.tick(.016);
    minZ = Math.min(minZ, pet.position.z); maxZ = Math.max(maxZ, pet.position.z);
    maximumFrameMove = Math.max(maximumFrameMove, pet.position.distanceTo(last)); last.copy(pet.position);
    if (lowerThan !== undefined && pet.position.z < lowerThan) visitedLower = true;
    if (visitedLower && pet.position.z >= returnHeight - .1) returned = true;
  }
  assert(maximumFrameMove < 1, `${label}: discontinuous movement`);
  if (lowerThan !== undefined) assert(visitedLower && returned, `${label}: animal must enter and return`);
  else assert(maxZ >= returnHeight - .1, "the animal must actually use the stairs");
  const position = pet.position.clone(), navigationBefore = group.userData.navigation;
  simulation.update({ ...state, baseColors: { ...state.baseColors, P01: "rose" } });
  assert(pet.position.equals(position) && group.userData.navigation === navigationBefore, "color-only updates must not respawn the hamster");
  console.log(JSON.stringify({ label, buildMs: Math.round(buildMs), budgetFrames: frames, navigation, motion: { minZ, maxZ, maximumFrameMove } }));
  simulation.dispose(); assert(!scene.children.includes(group), "dispose removes the independent hamster group");
}
console.log("PASS: real GLB interiors, stairs, basin/burrow roundtrips, continuous movement, color stability and disposal");
