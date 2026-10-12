import * as THREE from "three";

export type SceneViewSnapshot = {
  position: THREE.Vector3Tuple;
  quaternion: THREE.QuaternionTuple;
  target: THREE.Vector3Tuple;
  zoom: number;
  consumedViewResetKey: number;
};

export function captureSceneView(camera: THREE.PerspectiveCamera, target: THREE.Vector3, consumedViewResetKey: number): SceneViewSnapshot {
  return {
    position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
    target: target.toArray(), zoom: camera.zoom, consumedViewResetKey,
  };
}

/** A renderer retry restores presentation only; the current design stays in React. */
export function restoreSceneView(camera: THREE.PerspectiveCamera, target: THREE.Vector3, view: SceneViewSnapshot) {
  camera.position.fromArray(view.position);
  camera.quaternion.fromArray(view.quaternion);
  camera.zoom = view.zoom;
  target.fromArray(view.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
