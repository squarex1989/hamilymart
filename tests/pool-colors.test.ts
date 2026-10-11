import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AVAILABLE_COLORS, COLORS, getBaseParts, getProduct } from "../src/data/catalog";
import { autoPlace, createInitialState } from "../src/lib/assembly";
import { COLOR_STYLES, applyColorStyle, getBaseStyleColors, getProductStyleColors } from "../src/lib/color-styles";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";
import { getModelMaterialColor } from "../src/lib/model-colors";
import { createModelMaterial } from "../src/lib/model-presentation";

test("the actual pool lip follows every palette in both the catalog and embedded platform", async () => {
  const data = readFileSync(new URL("../public/models/B01.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  assert.equal(meshes.length, 2, "the source basin and lip are separate color bodies");
  const basePart = getBaseParts(100, true).find(part => part.id === "B01")!;
  const productPart = getProduct("pool").parts[0];
  const expected = [
    ["cream", "red"], ["peachwood", "darkwood"], ["rose", "white"],
    ["sky", "yellow"], ["jade", "rose"],
  ];
  for (const [index, style] of COLOR_STYLES.entries()) {
    const baseColors = getBaseStyleColors(index), productColors = getProductStyleColors("pool", index);
    for (const mesh of meshes) {
      const source = mesh.userData.sourcePart, key = mesh.userData.colorKey;
      const color = expected[index][key === "Snow" ? 0 : 1];
      assert.equal(getModelMaterialColor(basePart, source, key, baseColors), color, `${style.name}: ${source}`);
      assert.equal(getModelMaterialColor(productPart, source, key, productColors), color);
      assert(!Array.isArray(mesh.material));
      const material = createModelMaterial(mesh.material, basePart, source, key, baseColors);
      assert.equal(material.color.getHexString().toUpperCase(), COLORS.find(entry => entry.id === color)!.hex.slice(1));
      material.dispose();
    }
  }
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
  });
});

test("pool accent is derived after sharing or loading, with unchanged persisted color keys", () => {
  const placed = autoPlace(createInitialState(), "pool");
  assert.ok(placed.ok);
  const defaultKeys = Object.keys(createInitialState().baseColors);
  assert.deepEqual(Object.keys(getProductStyleColors("pool", 0)), ["B01"]);
  for (const [index] of COLOR_STYLES.entries()) {
    const styled = applyColorStyle(placed.state, index), code = encodeConfig(styled), restored = decodeConfig(code);
    assert.deepEqual(Object.keys(restored.baseColors), defaultKeys);
    assert.equal(encodeConfig(restored), code);
    assert.equal(getModelMaterialColor(getProduct("pool").parts[0], "B01_ChristmasRed", "ChristmasRed", restored.baseColors),
      getModelMaterialColor(getProduct("pool").parts[0], "B01_ChristmasRed", "ChristmasRed", getProductStyleColors("pool", index)));
  }
  for (const color of AVAILABLE_COLORS) {
    const colors = { B01: color.id };
    assert.equal(getModelMaterialColor(getProduct("pool").parts[0], "B01_Snow", "Snow", colors), color.id, "manual basin color remains exact");
    assert.notEqual(getModelMaterialColor(getProduct("pool").parts[0], "B01_ChristmasRed", "ChristmasRed", colors), color.id, "lip stays visible against its basin");
    assert.deepEqual(colors, { B01: color.id });
  }
});
