import * as THREE from "three";

/** Keep the orbit target centered above an overlay without changing model scale. */
export function applySceneViewport(camera: THREE.PerspectiveCamera, width: number, height: number, bottomInset: number) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const reserved = THREE.MathUtils.clamp(bottomInset, 0, h - 1);
  camera.setViewOffset(w, h, 0, reserved / 2, w, h);
  return (h - reserved) / h;
}

/** A centered camera with the same horizontal field and only the usable vertical field. */
export function cameraForUsableHeight(camera: THREE.PerspectiveCamera, usableHeight: number) {
  const fraction = THREE.MathUtils.clamp(usableHeight, .001, 1);
  const fitting = camera.clone();
  fitting.clearViewOffset();
  fitting.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * fraction));
  fitting.aspect = camera.aspect / fraction;
  fitting.updateProjectionMatrix();
  return fitting;
}
