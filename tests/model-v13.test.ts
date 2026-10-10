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

test("V13 actual stair GLB has a flush landing with both magnetic seats underneath", async () => {
  const stair = await loadModel("G05");
  for (const x of [234.5, 284.5]) {
    for (const dx of [-5, -3, 0, 3, 5]) near(rayZ(stair, x + dx, 187, true)[0], 200);
    near(rayZ(stair, x + 5, 187, false)[0], 194.6);
    // The open magnet pocket ends at 198.8, leaving 1.2 mm of material above it.
    near(rayZ(stair, x, 187, false)[0], 198.8);
  }
});

test("V13 actual platform GLB matches the lowered seats and keeps 0.4 mm steel covers", async () => {
  const [stair, platform] = await Promise.all([loadModel("G05"), loadModel("A02")]);
  for (const x of [234.5, 284.5]) {
    near(rayZ(platform, x, 187, true)[0], 194.6);
    const fromBelow = rayZ(platform, x, 187, false);
    assert.ok(fromBelow.some(z => Math.abs(z - 194.2) < .02), "steel cavity must end 0.4 mm below its contact face");
    near(rayZ(platform, x + 5, 187, true)[0], rayZ(stair, x + 5, 187, false)[0]);
  }
  near(rayZ(platform, 250, 220, true)[0], 200);
});

test("V13 imported stairs retain separate original cream and red color bodies", async () => {
  const stair = await loadModel("G05");
  const colors: Record<string, string> = {};
  stair.traverse(object => {
    if (object instanceof THREE.Mesh) colors[object.userData.sourcePart] = object.userData.defaultColor;
  });
  assert.deepEqual(colors, { G05_Snow: "#F1EADB", G05_ChristmasRed: "#B8273C" });
});
