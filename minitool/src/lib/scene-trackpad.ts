import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Browsers expose trackpad scroll/pinch as wheel events, not touch pointers. */
export function isTrackpadPan(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey'>) {
  if (event.ctrlKey || event.deltaMode !== 0) return false;
  // Keep conventional notched mouse wheels as zoom. WheelEvent has no device ID;
  // high-resolution wheels otherwise share the trackpad's pixel-scroll behavior.
  const notch = Math.abs(event.deltaY);
  return event.deltaX !== 0 || (notch !== 0 && notch % 100 !== 0 && notch % 120 !== 0);
}

export function panScenePixels(camera: THREE.Camera, controls: OrbitControls, width: number, height: number, dx: number, dy: number) {
  if (!controls.enabled || !controls.enablePan || width <= 0 || height <= 0) return;
  let sx: number, sy: number;
  if (camera instanceof THREE.PerspectiveCamera) {
    const extent = 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
    sx = sy = extent / height;
  } else if (camera instanceof THREE.OrthographicCamera) {
    sx = (camera.right - camera.left) / camera.zoom / width;
    sy = (camera.top - camera.bottom) / camera.zoom / height;
  } else return;
  camera.updateMatrix();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
  const up = controls.screenSpacePanning
    ? new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
    : new THREE.Vector3().crossVectors(camera.up, right);
  const offset = right.multiplyScalar(dx * sx * controls.panSpeed).addScaledVector(up, -dy * sy * controls.panSpeed);
  camera.position.add(offset);
  controls.target.add(offset);
  controls.update();
}
