import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AVAILABLE_COLORS, COLORS, WOOD_COLOR_IDS, getColorSwatch } from "../src/data/catalog";
import { createInitialState } from "../src/lib/assembly";
import { decodeConfig, encodeConfig } from "../src/lib/config-code";
import { applyFinish } from "../src/lib/scene-finishes";

test("wood finishes append to the HM3 palette and round-trip without changing original colors", () => {
  assert.deepEqual(COLORS.slice(0, 11).map(color => color.id), [
    "cream", "pine", "red", "butter", "sage", "rose", "sky", "lilac", "white", "marble", "jade",
  ]);
  assert.deepEqual(COLORS.slice(11).map(color => color.id), [...WOOD_COLOR_IDS]);
  assert.deepEqual(AVAILABLE_COLORS.slice(-3).map(color => color.name), ["桃木", "仿木", "深棕"]);
  for (const color of WOOD_COLOR_IDS) {
    const state = createInitialState();
    state.baseColors.P01 = color;
    state.baseColors.legs = color;
    const decoded = decodeConfig(encodeConfig(state));
    assert.deepEqual(decoded.baseColors, state.baseColors);
    assert.match(getColorSwatch(color), /gradient/);
  }
  assert.equal(getColorSwatch("cream"), "#F1EADB");
});

test("retired marble designs remain valid without offering marble in the picker", () => {
  // HM3 catalog 6 used index 9 for marble before the wood finishes were added.
  const previousMarbleCode = "HM3.WzMsNiwxMDAsWzAsWzksMSwwLDAsMCwwLDAsMCwwXSxbXV0sbnVsbCxbXSxudWxsLFswLDUwXSxudWxsXQ.34F06C49";
  const decoded = decodeConfig(previousMarbleCode);
  assert.equal(decoded.baseColors.P01, "marble");
  assert.equal(encodeConfig(decoded), previousMarbleCode);
  assert.ok(!AVAILABLE_COLORS.some(color => (color.id as string) === "marble"));
  const material = new THREE.MeshPhysicalMaterial();
  applyFinish(material, decoded.baseColors.P01);
  assert.notEqual(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  material.dispose();
});

test("changing wood, marble or jade back to a solid color removes the previous finish", () => {
  const material = new THREE.MeshPhysicalMaterial();
  const plain = new THREE.MeshPhysicalMaterial();
  applyFinish(plain, "cream");
  for (const finish of [...WOOD_COLOR_IDS, "marble", "jade"]) {
    applyFinish(material, finish);
    const previousVersion = material.version;
    applyFinish(material, "cream");
    assert.equal(material.onBeforeCompile, plain.onBeforeCompile);
    assert.equal(material.customProgramCacheKey(), plain.customProgramCacheKey());
    assert.equal(material.roughness, plain.roughness);
    assert.equal(material.metalness, plain.metalness);
    assert.equal(material.clearcoat, plain.clearcoat);
    assert.equal(material.clearcoatRoughness, plain.clearcoatRoughness);
    assert.ok(material.color.equals(plain.color));
    assert.ok(material.version > previousVersion, "a reused material must invalidate its old program");
  }
  applyFinish(material, "jade");
  applyFinish(material, "wood");
  assert.equal(material.clearcoat, 0);
  assert.equal(material.metalness, 0);
  assert.notEqual(material.customProgramCacheKey(), plain.customProgramCacheKey());
  material.dispose();
  plain.dispose();
});
