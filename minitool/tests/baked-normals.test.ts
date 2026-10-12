import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
// Build tooling is JavaScript and never shipped to the small-tool runtime.
// @ts-expect-error Build helper has no declaration file.
import { bakeMesh } from '../scripts/bake-model-normals.mjs';

for (const [name, geometry] of [
  ['hard edges', new THREE.BoxGeometry(100, 100, 100)],
  ['curved surface', new THREE.SphereGeometry(55, 32, 24)],
] as const) test(`baked ${name} preserve the original triangle/normal stream after JSON loading`, () => {
  const p = Array.from(geometry.getAttribute('position').array, value => value * 1000);
  const i = Array.from(geometry.index!.array);
  const reference = new THREE.BufferGeometry();
  reference.setAttribute('position', new THREE.Float32BufferAttribute(p.map(value => value / 1000), 3));
  reference.setIndex(i);
  const smooth = toCreasedNormals(reference, Math.PI / 5);
  const baked = JSON.parse(JSON.stringify(bakeMesh({ name, p, i, extras: { colorKey: 'Snow' } }).mesh));
  const actualPositions = new Float32Array(baked.i.flatMap((index: number) => baked.p.slice(index * 3, index * 3 + 3).map((value: number) => value / 1000)));
  const actualNormals = new Float32Array(baked.i.flatMap((index: number) => baked.n.slice(index * 3, index * 3 + 3)));
  assert.deepEqual(actualPositions, Float32Array.from(smooth.getAttribute('position').array, value => value === 0 ? 0 : value));
  assert.deepEqual(actualNormals, Float32Array.from(smooth.getAttribute('normal').array, value => value === 0 ? 0 : value));
  assert.equal(baked.i.length, i.length, 'no triangle reduction or reordering');
  assert(baked.p.length < smooth.getAttribute('position').array.length, 'identical shaded vertices are shared');
  geometry.dispose(); reference.dispose(); smooth.dispose();
});
