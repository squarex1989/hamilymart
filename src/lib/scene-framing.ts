import * as THREE from "three";
import { getBoxCorners } from "./scene-annotations";

/** Place UI inside the canvas; selecting an offscreen object never moves the camera. */
export function getSelectionToolbarPosition(bounds: THREE.Box3, camera: THREE.Camera,
  width: number, height: number, toolbarWidth: number, toolbarHeight: number, topInset = 8, bottomInset = 64) {
  const corners = getBoxCorners(bounds).map(point => point.project(camera));
  const left = Math.min(...corners.map(point => (point.x + 1) * width / 2));
  const right = Math.max(...corners.map(point => (point.x + 1) * width / 2));
  const top = Math.min(...corners.map(point => (1 - point.y) * height / 2));
  const halfWidth = toolbarWidth / 2;
  return {
    x: Math.max(halfWidth + 8, Math.min(width - halfWidth - 8, (left + right) / 2)),
    y: THREE.MathUtils.clamp(top - toolbarHeight - 10, topInset, Math.max(topInset, height - bottomInset - toolbarHeight)),
  };
}

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
