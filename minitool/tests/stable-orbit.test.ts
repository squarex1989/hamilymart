import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { stableOrbitUpdate } from '../src/lib/stable-orbit';

test('sub-epsilon updates cannot accumulate unpainted camera drift between idle and recovery', () => {
  const camera = new PerspectiveCamera(); camera.position.set(100, -200, 350); camera.lookAt(0, 0, 0);
  const initialPosition = camera.position.clone(), initialQuaternion = camera.quaternion.clone();
  let visibleChange = false;
  const controls = { target: new Vector3(), update() {
    camera.position.addScalar(.00003); controls.target.addScalar(.00001); camera.rotateY(.0000001);
    return visibleChange;
  } };
  const update = stableOrbitUpdate(camera, controls);
  for (let i = 0; i < 500; i++) assert.equal(update(), false);
  assert(camera.position.equals(initialPosition)); assert(camera.quaternion.equals(initialQuaternion));
  assert(controls.target.equals(new Vector3()));
  visibleChange = true;
  assert.equal(update(), true);
  assert(!camera.position.equals(initialPosition), 'visible manual/inertial movement continues normally');
});
