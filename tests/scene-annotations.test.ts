import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getBaseParts } from "../src/data/catalog";
import { createSelectionBox, dimensionsInCentimeters, disposeAnnotation, getRenderedModelBounds } from "../src/lib/scene-annotations";

const model = (dimensions: [number, number, number], owner: string) => {
  const group = new THREE.Group();
  group.userData.itemId = owner;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), new THREE.MeshBasicMaterial());
  mesh.userData.modelMesh = true;
  group.add(mesh);
  return group;
};

test("selection bounds include only the selected assembly group and ignore scene helpers", () => {
  const scene = new THREE.Group();
  const parent = model([180, 100, 80], "villa");
  parent.position.set(450, 120, 150);
  parent.rotation.z = Math.PI / 2;
  const installedOnRoof = model([40, 40, 70], "hat");
  installedOnRoof.position.set(450, 120, 225);
  const enormousHelper = new THREE.Mesh(new THREE.BoxGeometry(2000, 2000, 2000));
  parent.add(enormousHelper);
  scene.add(parent, installedOnRoof);
  const selected = getRenderedModelBounds(scene, "villa");
  assert.deepEqual(dimensionsInCentimeters(selected), [10, 18, 8]);
  assert.equal(selected.max.z, 190);
  assert.equal(getRenderedModelBounds(scene).max.z, 260);
  assert.ok(getRenderedModelBounds(scene, "missing").isEmpty());
});

test("a selected cover and pool use their own bounds, and the selection box has the requested transparency", () => {
  const scene = new THREE.Group();
  const base = model([300, 300, 110], "base");
  const cover = model([64, 64, 8], "unused");
  cover.userData.selectionId = "cover:base:H01";
  cover.position.set(50, 50, 100);
  const pool = model([154, 154, 50], "unused");
  pool.userData.selectionId = "pool:base";
  base.add(cover, pool);
  scene.add(base);
  assert.deepEqual(dimensionsInCentimeters(getRenderedModelBounds(scene, "cover:base:H01")), [6.4, 6.4, .8]);
  assert.deepEqual(dimensionsInCentimeters(getRenderedModelBounds(scene, "pool:base")), [15.4, 15.4, 5]);
  const helper = createSelectionBox(getRenderedModelBounds(scene, "cover:base:H01"));
  assert.equal(((helper.children[0] as THREE.Mesh).material as THREE.Material).opacity, .1);
  assert.equal(((helper.children[1] as THREE.Line).material as THREE.LineDashedMaterial).opacity, .2);
  assert.ok((helper.children[1] as THREE.Line).geometry.getAttribute("lineDistance"));
  disposeAnnotation(helper);
});

test("real 30 cm leg meshes measure 31 cm overall and helpers or bedding never change dimensions", async () => {
  const assembly = new THREE.Group();
  const platform = new THREE.Group();
  platform.position.z = 200;
  platform.userData.itemId = "base";
  await Promise.all(getBaseParts(300, "lid", []).map(async (part) => {
    const bytes = readFileSync(new URL(`../public/models/${part.id}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.userData.modelMesh = true;
    });
    platform.add(gltf.scene);
  }));
  assembly.add(platform);
  const dimensions = dimensionsInCentimeters(getRenderedModelBounds(assembly));
  assert.deepEqual(dimensions, [30, 30, 31]);
  const fakeBedding = new THREE.Mesh(new THREE.BoxGeometry(400, 400, 200));
  assembly.add(fakeBedding, createSelectionBox(getRenderedModelBounds(assembly, "base")));
  assert.deepEqual(dimensionsInCentimeters(getRenderedModelBounds(assembly)), dimensions);
});
