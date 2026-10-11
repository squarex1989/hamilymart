import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

async function loadModel(id: string) {
  const data = readFileSync(new URL(`../public/models/${id}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function rayZ(model: THREE.Object3D, x: number, y: number, fromAbove: boolean) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, fromAbove ? 220 : 170), new THREE.Vector3(0, 0, fromAbove ? -1 : 1));
  return ray.intersectObject(model, true).map(hit => hit.point.z);
}

function near(actual: number | undefined, expected: number) {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < .02, `Expected ${expected} mm, got ${actual}`);
}

test("V15 actual stair keeps V14's solid flush landing instead of upper magnets", async () => {
  const stair = await loadModel("G05");
  for (const x of [234.5, 284.5]) {
    for (const dx of [-5, -3, 0, 3, 5]) near(rayZ(stair, x + dx, 187, true)[0], 200);
    for (const dx of [-3, 0, 3]) near(rayZ(stair, x + dx, 187, false)[0], 196);
  }
});

test("V15 actual platform is precisely 300 mm wide and fits the stair lip with 0.2 mm floor clearance", async () => {
  const [stair, platform] = await Promise.all([loadModel("G05"), loadModel("A02")]);
  const box = new THREE.Box3().setFromObject(platform);
  assert.deepEqual(box.min.toArray(), [0, 180, 182]);
  assert.deepEqual(box.max.toArray(), [300, 300, 200]);
  for (const x of [234.5, 284.5]) {
    near(rayZ(platform, x, 187, true)[0], 196);
    near(rayZ(platform, x + 5, 187, true)[0], rayZ(stair, x + 5, 187, false)[0]);
  }
  near(rayZ(stair, 260, 192, false)[0], 192);
  near(rayZ(platform, 260, 192, true)[0], 191.8);
  near(rayZ(platform, 260, 192, false)[0], 190);
  near(rayZ(platform, 250, 220, true)[0], 200);
});

test("V15 actual platform retains five closed 0.4 mm steel covers at the relocated receivers", async () => {
  const platform = await loadModel("A02");
  for (const [x, y] of [[10, 192], [10, 286], [156, 192], [156, 286], [280.5, 264]]) {
    near(rayZ(platform, x, y, true)[0], 200);
    const fromBelow = rayZ(platform, x, y, false);
    assert.ok(fromBelow.some(z => Math.abs(z - 199.6) < .02), "steel cavity ends 0.4 mm below the surface");
  }
});

test("V15 imported stairs retain separate original cream and red color bodies", async () => {
  const stair = await loadModel("G05");
  const colors: Record<string, string> = {};
  stair.traverse(object => {
    if (object instanceof THREE.Mesh) colors[object.userData.sourcePart] = object.userData.defaultColor;
  });
  assert.deepEqual(colors, { G05_Snow: "#F1EADB", G05_ChristmasRed: "#B8273C" });
});
