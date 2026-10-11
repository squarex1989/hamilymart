import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applySceneViewport, cameraForUsableHeight } from "../src/lib/scene-framing";
import { fitExplodedCamera } from "../src/lib/exploded-view";

test("toolbar framing raises the orbit target while preserving projected model scale", () => {
  for (const [width, height, reserved] of [[960, 720, 70], [390, 410, 66], [320, 268, 80]]) {
    const camera = new THREE.PerspectiveCamera(34, width / height, 10, 12000);
    camera.up.set(0, 0, 1);
    const target = new THREE.Vector3(150, 150, 55);
    camera.position.set(630, -560, 500);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const position = camera.position.clone(), rotation = camera.quaternion.clone();
    const points = [target, new THREE.Vector3(0, 0, 0), new THREE.Vector3(300, 300, 110)];
    const before = points.map(point => point.clone().project(camera));
    const usableHeight = applySceneViewport(camera, width, height, reserved);
    assert.equal(usableHeight, (height - reserved) / height);
    points.forEach((point, index) => {
      const after = point.clone().project(camera);
      assert.ok(Math.abs(after.x - before[index].x) < 1e-12);
      assert.ok(Math.abs(after.y - before[index].y - reserved / height) < 1e-12);
      assert.ok(Math.abs(after.z - before[index].z) < 1e-12);
    });
    assert.deepEqual(camera.position, position);
    assert.ok(camera.quaternion.equals(rotation));
    const targetPixelY = (1 - target.clone().project(camera).y) * height / 2;
    assert.ok(Math.abs(targetPixelY - (height - reserved) / 2) < 1e-10);
    applySceneViewport(camera, width, height, 0);
    assert.ok(Math.abs(target.clone().project(camera).y) < 1e-12, "no overlay uses the complete canvas");
  }
});

test("exploded camera fits every corner above the toolbar in desktop and mobile views", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-270, -100, 10), new THREE.Vector3(1520, 660, 830));
  for (const [width, height, reserved] of [[960, 720, 70], [390, 410, 66], [320, 268, 80]]) {
    const camera = new THREE.PerspectiveCamera(34, width / height, 10, 12000);
    camera.up.set(0, 0, 1);
    camera.position.set(1000, -600, 550);
    const usableHeight = applySceneViewport(camera, width, height, reserved);
    const fitted = fitExplodedCamera(bounds, cameraForUsableHeight(camera, usableHeight), new THREE.Vector3(450, 150, 150));
    camera.position.copy(fitted.position);
    camera.lookAt(fitted.target);
    camera.updateMatrixWorld(true);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      const pixelY = (1 - projected.y) * height / 2;
      assert.ok(Math.abs(projected.x) <= .821 && pixelY >= 0 && pixelY <= height - reserved && projected.z < 1,
        `corner outside usable canvas at ${width}x${height}: ${projected.toArray()}`);
    }
  }
});
