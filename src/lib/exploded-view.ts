import * as THREE from "three";
import { getSourceColorSlot } from "../data/catalog";

/** A display-only arrangement. No assembly positions, color values, or source geometry are changed. */
export interface ExplodedPiece {
  key: string;
  partId: string;
  meshes: THREE.Mesh[];
  originalBounds: THREE.Box3;
  offset: THREE.Vector3;
}

const GAP = 22;
function intersectsWithGap(a: THREE.Box3, b: THREE.Box3) {
  return a.min.x < b.max.x + GAP && a.max.x > b.min.x - GAP
    && a.min.y < b.max.y + GAP && a.max.y > b.min.y - GAP
    && a.min.z < b.max.z + GAP && a.max.z > b.min.z - GAP;
}

/** Slide along a single axis until every previously arranged piece is clear. */
function clearPosition(bounds: THREE.Box3, placed: THREE.Box3[], axis: "x" | "y" | "z", sign: number) {
  const result = bounds.clone();
  for (let step = 0; step <= placed.length; step++) {
    const collisions = placed.filter(other => intersectsWithGap(result, other));
    if (!collisions.length) return result;
    const shift = sign > 0
      ? Math.max(...collisions.map(other => other.max[axis] + GAP - result.min[axis]))
      : Math.min(...collisions.map(other => other.min[axis] - GAP - result.max[axis]));
    const delta = new THREE.Vector3();
    delta[axis] = shift + sign * .01;
    result.translate(delta);
  }
  return result;
}

export function createExplodedLayout(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const pieces: ExplodedPiece[] = [];
  for (const owner of root.children) {
    for (const part of owner.children) {
      const partId = String(part.userData.partId ?? part.name);
      const groups = new Map<string, ExplodedPiece>();
      part.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !node.userData.modelMesh) return;
        // Decorations with an independent color control move separately. Linked physical
        // parts (four legs, two pillars, three grass borders) remain distinct pieces.
        const slot = getSourceColorSlot(partId, node.userData.sourcePart, node.userData.colorKey) ?? "body";
        if (!groups.has(slot)) groups.set(slot, {
          key: `${owner.userData.itemId}:${partId}:${slot}`,
          partId, meshes: [], originalBounds: new THREE.Box3(), offset: new THREE.Vector3(),
        });
        const piece = groups.get(slot)!;
        piece.meshes.push(node);
        node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) piece.originalBounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
      });
      pieces.push(...[...groups.values()].filter(piece => !piece.originalBounds.isEmpty()));
    }
  }
  const originalBounds = pieces.reduce((bounds, piece) => bounds.union(piece.originalBounds), new THREE.Box3());
  const center = originalBounds.getCenter(new THREE.Vector3());
  const placed: THREE.Box3[] = [];
  // Start with platforms as visual anchors; large bodies settle before small trim.
  const volume = (piece: ExplodedPiece) => {
    const size = piece.originalBounds.getSize(new THREE.Vector3());
    return size.x * size.y * size.z;
  };
  pieces.sort((a, b) => Number(b.partId === "P01") - Number(a.partId === "P01")
    || volume(b) - volume(a) || a.key.localeCompare(b.key));
  const expandedBounds = new THREE.Box3();
  for (const piece of pieces) {
    const midpoint = piece.originalBounds.getCenter(new THREE.Vector3());
    const preferred = midpoint.clone().sub(center).multiply(new THREE.Vector3(.38, .38, .48));
    preferred.z += Math.max(0, 18 - originalBounds.min.z) + (midpoint.z - originalBounds.min.z) * .12;
    const desired = piece.originalBounds.clone().translate(preferred);
    if (desired.min.z < 12) desired.translate(new THREE.Vector3(0, 0, 12 - desired.min.z));
    let next = desired;
    if (placed.some(other => intersectsWithGap(next, other))) {
      const candidates = (["x", "y", "z"] as const).flatMap(axis => [1, -1].map(sign => clearPosition(desired, placed, axis, sign)))
        .filter(candidate => candidate.min.z >= 8 && !placed.some(other => intersectsWithGap(candidate, other)));
      candidates.sort((a, b) => {
        const cost = (candidate: THREE.Box3) => {
          const delta = candidate.min.clone().sub(desired.min);
          // Slightly prefer vertical separation for roofs, trim and stacked surfaces.
          return delta.x ** 2 + delta.y ** 2 + delta.z ** 2 * .72;
        };
        return cost(a) - cost(b);
      });
      next = candidates[0] ?? clearPosition(desired, placed, "z", 1);
    }
    piece.offset.copy(next.min).sub(piece.originalBounds.min);
    expandedBounds.union(next);
    placed.push(next);
  }
  const meshOffsets = new Map<THREE.Object3D, THREE.Vector3>();
  pieces.forEach(piece => piece.meshes.forEach(mesh => meshOffsets.set(mesh, piece.offset)));
  const transforms = pieces.flatMap(piece => piece.meshes.map(mesh => {
    let ancestor = mesh.parent;
    while (ancestor && !meshOffsets.has(ancestor)) ancestor = ancestor.parent;
    // If an imported mesh ever owns another moving mesh, subtract its world offset
    // before converting to the child's local space so it cannot move twice.
    const delta = piece.offset.clone().sub(ancestor ? meshOffsets.get(ancestor)! : new THREE.Vector3());
    const inverseParent = mesh.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
    const zero = new THREE.Vector3().applyMatrix4(inverseParent);
    const localDelta = delta.applyMatrix4(inverseParent).sub(zero);
    return { mesh, position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone(), localDelta };
  }));
  return {
    pieces,
    originalBounds,
    expandedBounds,
    apply(progress: number) {
      const amount = THREE.MathUtils.clamp(progress, 0, 1);
      for (const transform of transforms) transform.mesh.position.copy(transform.position).addScaledVector(transform.localDelta, amount);
      root.updateMatrixWorld(true);
    },
    restore() {
      for (const transform of transforms) {
        transform.mesh.position.copy(transform.position);
        transform.mesh.quaternion.copy(transform.quaternion);
        transform.mesh.scale.copy(transform.scale);
      }
      root.updateMatrixWorld(true);
    },
  };
}

/** Camera placement along the current view direction, with room around every corner. */
export function fitExplodedCamera(bounds: THREE.Box3, camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = camera.position.clone().sub(target).normalize();
  if (!direction.lengthSq()) direction.set(1, -1, 1).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), camera.up));
  const inverseRotation = rotation.clone().invert();
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const horizontal = vertical * camera.aspect;
  let distance = 300;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverseRotation);
    distance = Math.max(distance, corner.z + Math.abs(corner.x) / (horizontal * .82), corner.z + Math.abs(corner.y) / (vertical * .78));
  }
  return { position: center.clone().addScaledVector(direction, distance), target: center, distance };
}
