import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getSourceColorSlot } from "../src/data/catalog";

test("separate hat window color preserves every triangle and leaves the brim and pompom independent", async () => {
  const data = readFileSync(new URL("../public/models/G03.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  const triangles: number[][] = [];
  let windowTriangles = 0;
  const compare = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    const p = geometry.attributes.position, indices = geometry.index;
    const count = indices?.count ?? p.count;
    for (let i = 0; i < count; i += 3) {
      const vertices = [0, 1, 2].map(n => { const index = indices ? indices.getX(i + n) : i + n; return [p.getX(index), p.getY(index), p.getZ(index)]; });
      triangles.push(vertices.sort(compare).flat());
    }
    const source = object.userData.sourcePart;
    if (source === "G03_WindowSnow") {
      windowTriangles += count / 3;
      const bounds = new THREE.Box3().setFromObject(object);
      for (const [actual, expected] of [...bounds.min.toArray(), ...bounds.max.toArray()].map((v, i) => [v, [49, 179.6, 210, 117, 185.5, 246][i]])) assert.ok(Math.abs(actual - expected) < .001);
      assert.equal(getSourceColorSlot("G03", source, object.userData.colorKey), "G03-window");
      assert.equal(object.userData.defaultColor, "#F1EADB");
    } else if (source === "G03_Snow") {
      assert.ok(new THREE.Box3().setFromObject(object).min.z > 260, "remaining Snow contains only brim and pompom");
      assert.equal(getSourceColorSlot("G03", source, object.userData.colorKey), "G03-trim");
    }
  });
  assert.equal(windowTriangles, 764);
  assert.equal(triangles.length, 13694);
  const coordinates = triangles.sort(compare).flat();
  const bytes = Buffer.alloc(coordinates.length * 4);
  coordinates.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  // Independently reconstructed from the approved V15 source before splitting
  // Snow; V15 translates the intact cottage +5 mm without scaling its geometry.
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "0532b1384b98b959875766523ef50b0173bf26d0cdc6b32470cbeadf38c08822");
});
