import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createModelLighting, createModelMaterial } from '../src/lib/model-presentation';
import { getProduct } from '../src/data/catalog';
import { getProductStyleColors } from '../src/lib/color-styles';

test('moving the light rig to another platform never changes its illumination directions', () => {
  const scene = new THREE.Scene(), lights = createModelLighting(scene);
  const directions = () => [lights.sun, lights.fill, lights.underside].map(light => light.position.clone().sub(light.target.position).normalize().toArray());
  const original = directions();
  for (const x of [150, 450, 750]) {
    lights.centerAt(x, 150);
    assert.deepEqual(directions(), original);
  }
  assert.equal(lights.underside.visible, false);
});

test('shared product materials preserve clearcoat and the stair face treatment without tinting their source', () => {
  const source = new THREE.MeshStandardMaterial({ color: '#010203', roughness: .9 });
  const product = getProduct('l-house');
  const material = createModelMaterial(source, product.parts[0], 'LHB_PineGreen', 'PineGreen', getProductStyleColors(product.id, 4));
  assert.equal(material.color.getHexString(), '299c82');
  assert.equal(material.roughness, .22);
  assert.equal(material.clearcoat, .8);
  assert.equal(source.color.getHexString(), '010203');
  const stair = getProduct('villa').parts.find(p => p.id === 'G05')!;
  const step = createModelMaterial(source, stair, 'G05_ChristmasRed', 'ChristmasRed', getProductStyleColors('villa', 1));
  assert.equal(step.color.getHexString(), 'be896f');
  assert.equal(step.polygonOffset, true);
  assert.equal(step.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  source.dispose(); material.dispose(); step.dispose();
});
