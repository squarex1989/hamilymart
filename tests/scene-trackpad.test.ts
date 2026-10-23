import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isTrackpadPan, panScenePixels } from '../src/lib/scene-trackpad';
import { panScenePixels as miniPan } from '../minitool/src/lib/scene-trackpad';

test('trackpad scroll pans; pinch and ordinary mouse wheel retain zoom', () => {
  const wheel = { deltaMode: 0, deltaX: 0, deltaY: 3.5, ctrlKey: false };
  assert.equal(isTrackpadPan(wheel), true);
  assert.equal(isTrackpadPan({ ...wheel, deltaX: 20, deltaY: 0 }), true);
  assert.equal(isTrackpadPan({ ...wheel, ctrlKey: true }), false);
  for (const deltaY of [100, -100, 120, -120, 240]) assert.equal(isTrackpadPan({ ...wheel, deltaY }), false);
  assert.equal(isTrackpadPan({ ...wheel, deltaMode: 1 }), false);
  assert.equal(isTrackpadPan({ ...wheel, deltaY: 0 }), false);
});
for (const [name, pan] of [['web', panScenePixels], ['mini', miniPan]] as const) {
  test(`${name}: pan moves target and camera together without rotating or zooming`, () => {
    const camera = new THREE.PerspectiveCamera(34, 2, 10, 4500);
    camera.up.set(0, 0, 1); camera.position.set(300, -600, 500);
    const target = new THREE.Vector3(150, 150, 80);
    camera.lookAt(target); camera.updateMatrixWorld();
    const beforePosition = camera.position.clone(), beforeTarget = target.clone(), beforeRotation = camera.quaternion.clone();
    let updates = 0;
    const controls = { enabled: true, enablePan: true, screenSpacePanning: true, panSpeed: 1, target, update: () => { updates++; camera.lookAt(target); } } as unknown as OrbitControls;
    pan(camera, controls, 800, 400, 24, 40);
    assert.equal(updates, 1);
    assert(camera.position.distanceTo(beforePosition) > 1);
    assert(camera.position.clone().sub(beforePosition).distanceTo(target.clone().sub(beforeTarget)) < 1e-9);
    assert(camera.quaternion.angleTo(beforeRotation) < 1e-7);
    assert(Math.abs(camera.position.distanceTo(target) - beforePosition.distanceTo(beforeTarget)) < 1e-9);
    const after = camera.position.clone(); controls.enabled = false;
    pan(camera, controls, 800, 400, 100, 100);
    assert(camera.position.equals(after));
    controls.enabled = true; controls.enablePan = false;
    pan(camera, controls, 800, 400, 100, 100);
    assert(camera.position.equals(after));
  });
}
