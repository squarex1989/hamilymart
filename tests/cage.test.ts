import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAGE_PRESETS, normalizeCage } from '../src/data/cages';
import { createInitialState, addPlatform, validateAssembly } from '../src/lib/assembly';
import { getCageBounds } from '../src/lib/cage-scene';
import { encodeConfig, decodeConfig } from '../src/lib/config-code';

test('all 16 supplied cage interiors retain exact measurements', () => {
  assert.equal(CAGE_PRESETS.length, 16);
  assert.equal(new Set(CAGE_PRESETS.map(p => p.id)).size, 16);
  assert.deepEqual(CAGE_PRESETS.find(p => p.id === 'tafit-crystal-75'), {id:'tafit-crystal-75',name:'它适水晶笼 · 75',width:71,depth:42.5,height:40.6});
});
test('custom cage values reject invalid numbers and clear a mismatched preset', () => {
  for (const width of [0, -1, Infinity, NaN, 501, '80']) assert.throws(() => normalizeCage({ width, depth:50, height:50 }));
  assert.equal(normalizeCage({ presetId:'carno-cheese-80',width:81,depth:50,height:50 })?.presetId,null);
});
test('cage survives validation and share-code round trip, legacy codes still decode', () => {
  const state = {...createInitialState(), cage: {presetId:'carno-tv-73',width:73.5,depth:48,height:53}};
  assert.deepEqual(validateAssembly(state).cage,state.cage);
  assert.deepEqual(decodeConfig(encodeConfig(state)).cage,state.cage);
  assert.equal(decodeConfig(encodeConfig({...createInitialState(), cage: null})).cage,null);
});
test('small enclosure never limits platform additions and stays grounded/centered', () => {
  const state = {...createInitialState(), cage: {presetId:null,width:20,depth:20,height:10}};
  const added = addPlatform(state);
  assert.ok(added.ok);
  if (!added.ok) return;
  assert.deepEqual(getCageBounds(state)?.min.toArray(),[50,50,0]);
  assert.deepEqual(getCageBounds(state)?.max.toArray(),[250,250,100]);
  assert.deepEqual(getCageBounds(added.state)?.min.toArray(),[200,50,0]);
  assert.ok(addPlatform(added.state).ok);
});

import * as THREE from 'three';
import { createCagePreview } from '../src/lib/cage-scene';
test('cage reference draws behind the model instead of tinting colors as the camera crosses its walls', () => {
  const scene = new THREE.Scene(), preview = createCagePreview(scene);
  preview.update(createInitialState());
  const shell = scene.getObjectByName('Cage size reference') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  assert.equal(shell.material.side, THREE.BackSide);
  assert.equal(shell.material.opacity, .1);
  assert.equal(shell.material.depthWrite, false);
  preview.dispose();
});
