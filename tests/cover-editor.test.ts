import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoverEditor } from '../src/lib/cover-editor';
import { createInitialState, setCoverRemoved } from '../src/lib/assembly';
import { getBeddingBounds } from '../src/lib/bedding-scene';

test('five holes remain selectable after cover removal, other models fade and recover', () => {
  const scene = new THREE.Scene(), objects = new THREE.Group(), owner = new THREE.Group();
  owner.userData.itemId = 'house';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); owner.add(mesh); objects.add(owner);scene.add(objects);
  const editor = createCoverEditor(scene, objects), state = createInitialState();
  editor.update(state, 'base', null);
  assert.equal(new Set(editor.rings.children.map(o=>o.userData.selectionId)).size,5);
  assert.equal(mesh.material.opacity,.12);
  const removed = setCoverRemoved(state,'base','H01',true);assert.ok(removed.ok);
  if (!removed.ok) return;
  editor.update(removed.state,'base','cover:base:H01');
  assert.ok(editor.selectionBounds('cover:base:H01'));
  const restored = setCoverRemoved(removed.state,'base','H01',false); assert.ok(restored.ok);
  if(restored.ok) assert.ok(!restored.state.removedCovers.includes('H01'));
  editor.update(state,null,null);assert.equal(mesh.material.opacity,1);assert.equal(mesh.material.transparent,false);assert.equal(editor.rings.children.length,0);
  editor.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
test('default cage is Buca Cube 120 and bedding follows its interior, including custom sizes', () => {
  const state=createInitialState();assert.equal(state.cage?.presetId,'buca-cube-120');
  const b=getBeddingBounds(state);assert.equal(b.maxX-b.minX,1200);assert.equal(b.maxY-b.minY,600);
  const custom=getBeddingBounds({...state,cage:{presetId:null,width:100,depth:60,height:50}});assert.equal(custom.maxX-custom.minX,1000);assert.equal(custom.maxY-custom.minY,600);
});
