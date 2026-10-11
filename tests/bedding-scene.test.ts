import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createBedding, getBeddingBounds } from "../src/lib/bedding-scene";
import { addPlatform, createInitialState, setBedding, setLegHeight, setPlatformPool } from "../src/lib/assembly";
import type { ActionResult } from "../src/lib/assembly";

function success(result: ActionResult) {
  if (!result.ok) assert.fail(result.reason);
  return result.state;
}

// Only the decorative texture needs canvas; geometry and instance bounds are
// real Three.js objects, so this test does not require a browser or WebGL.
const context = new Proxy({}, { get: () => () => undefined, set: () => true });
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
} });

test("zero bedding builds no meshes and removes an existing pile without breaking visibility controls", () => {
  const empty = success(setBedding(createInitialState(), { mode: "none", depth: 0 }));
  const filled = success(setBedding(empty, { mode: "thin", depth: 50 }));
  const scene = new THREE.Scene(), bedding = createBedding(scene);
  const group = scene.children[0];
  bedding.update(empty);
  assert.equal(group.children.length, 0);
  assert(new THREE.Box3().setFromObject(group).isEmpty());

  bedding.update(filled);
  assert(group.children.length > 0);
  const firstMesh = group.children[0] as THREE.Mesh;
  let disposed = false;
  firstMesh.geometry.addEventListener("dispose", () => { disposed = true; });
  bedding.update(empty);
  assert(disposed, "the old pile releases its geometry when zero bedding is selected");
  assert.equal(group.children.length, 0);
  bedding.setVisible(true);
  bedding.update(empty);
  assert.equal(group.children.length, 0, "showing the environment cannot bring back a zero-height pile");

  bedding.setVisible(false);
  bedding.update(filled);
  assert(group.children.length > 0, "a positive height reconstructs the pile");
  assert.equal(group.visible, false);
  bedding.setVisible(true);
  assert.equal(group.visible, true);
  bedding.dispose();
  assert.equal(scene.children.length, 0);
});

test("the complete fluffy bedding envelope extends exactly 50 mm beyond every outside platform edge", () => {
  let state = createInitialState();
  const scene = new THREE.Scene(), bedding = createBedding(scene);
  for (let count = 1; count <= 3; count++) {
    if (count > 1) state = success(addPlatform(state));
    assert.deepEqual(getBeddingBounds(state), { minX: -50, maxX: count * 300 + 50, minY: -50, maxY: 350 });
    for (const depth of [50, 100, 200, 300] as const) {
      state = success(setBedding(state, depth === 50 ? { mode: "thin", depth } : { mode: "thick", depth }));
      bedding.update(state);
      const bounds = new THREE.Box3().setFromObject(scene);
      for (const [actual, expected] of [[bounds.min.x, -50], [bounds.max.x, count * 300 + 50], [bounds.min.y, -50], [bounds.max.y, 350]]) {
        assert.ok(Math.abs(actual - expected) < .002, `${count} platforms / ${depth} mm: ${actual} versus ${expected}`);
      }
      assert.equal(bounds.min.z, 0);
      assert.ok(bounds.max.z <= depth + .002);
      assert.equal(scene.children.length, 1, "joined platforms share one continuous bedding group");
    }
  }
  bedding.dispose();
  assert.equal(scene.children.length, 0);
});

test("sizing the outside fringe preserves the pool cavity position and radius", () => {
  let state = success(setLegHeight(createInitialState(), 200));
  state = success(setBedding(state, { mode: "thick", depth: 200 }));
  state = success(setPlatformPool(state, "base", true));
  const scene = new THREE.Scene(), bedding = createBedding(scene);
  bedding.update(state);
  const group = scene.children[0];
  const cavity = group.children[3] as THREE.Mesh;
  const positions = cavity.geometry.getAttribute("position");
  assert.equal(positions.count, 130);
  for (let index = 0; index < positions.count; index++) {
    const radius = Math.hypot(positions.getX(index) - 100, positions.getY(index) - 100);
    assert.ok(Math.abs(radius - 82) < .001);
  }
  bedding.dispose();
});
