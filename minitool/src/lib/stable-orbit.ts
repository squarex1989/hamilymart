import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

/** OrbitControls continues applying sub-epsilon damping even when update()
 * returns false. An on-demand renderer must keep that unpainted drift out of
 * saved camera poses, otherwise a later edit/context restore reveals a jump. */
export function stableOrbitUpdate(camera: PerspectiveCamera, controls: { target: Vector3; update(): boolean }) {
  const position = new Vector3(), target = new Vector3(), quaternion = new Quaternion();
  return () => {
    position.copy(camera.position); quaternion.copy(camera.quaternion); target.copy(controls.target);
    const changed = controls.update();
    if (!changed) {
      camera.position.copy(position); camera.quaternion.copy(quaternion); controls.target.copy(target);
      camera.updateMatrixWorld();
    }
    return changed;
  };
}
