import * as THREE from "three";
import { getSourceColorSlot } from "../src/data/catalog";

/** A display-only arrangement. No assembly positions, color values, or source geometry are changed. */
export interface ExplodedPiece {
  key: string;
  partId: string;
  /** Physical parts which must travel together even when their colors differ. */
  partIds: string[];
  meshes: THREE.Mesh[];
  originalBounds: THREE.Box3;
  offset: THREE.Vector3;
}


const PIPE_PART = /^(ST|LT|TT)\d*N?[TB]$/;

/** These are assembly groups, independent of the controls used to paint them. */
function assemblyGroup(partId: string, sourcePart?: string, colorKey?: string) {
  if (/^(P01|H0[1-6]|[LXY]0[1-4])$/.test(partId)) return "platform";
  if (/^(A02|W0[12])$/.test(partId)) return "upper-platform";
  if (/^G1[567]$/.test(partId)) return "grass";
  if (PIPE_PART.test(partId)) return "pipe";
  if (["A01", "G03", "G05", "PCW", "PCR"].includes(partId)) return partId;
  return `${partId}:${getSourceColorSlot(partId, sourcePart, colorKey) ?? "body"}`;
}

function overlapFootprints(a: THREE.Box3, b: THREE.Box3) {
  // Edge-sharing platforms are neighboring columns, not a vertical stack.
  // The small inward tolerance ignores float noise in exported coplanar edges.
  return a.min.x < b.max.x - .01 && a.max.x > b.min.x + .01
    && a.min.y < b.max.y - .01 && a.max.y > b.min.y + .01;
}

export function createExplodedLayout(root: THREE.Object3D, grouping: "assembly" | "parts" = "assembly", gap = 22) {
  root.updateWorldMatrix(true, true);
  const pieces: ExplodedPiece[] = [];
  for (const owner of root.children) {
    const groups = new Map<string, ExplodedPiece>();
    for (const part of owner.children) {
      const partId = String(part.userData.partId ?? part.name);
      part.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !node.userData.modelMesh) return;
        const group = grouping === "parts"
          ? `${partId}:${getSourceColorSlot(partId, node.userData.sourcePart, node.userData.colorKey) ?? "body"}`
          : assemblyGroup(partId, node.userData.sourcePart, node.userData.colorKey);
        if (!groups.has(group)) groups.set(group, {
          key: `${owner.userData.itemId}:${group}`,
          partId, partIds: [], meshes: [], originalBounds: new THREE.Box3(), offset: new THREE.Vector3(),
        });
        const piece = groups.get(group)!;
        if (!piece.partIds.includes(partId)) piece.partIds.push(partId);
        piece.meshes.push(node);
        node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) piece.originalBounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
      });
    }
    for (const [group, piece] of groups) {
      piece.partIds.sort();
      piece.partId = ({ platform: "P01", "upper-platform": "A02", grass: "G15" } as Record<string, string>)[group]
        ?? piece.partIds[0];
      if (!piece.originalBounds.isEmpty()) pieces.push(piece);
    }
  }
  const originalBounds = pieces.reduce((bounds, piece) => bounds.union(piece.originalBounds), new THREE.Box3());
  const placed: THREE.Box3[] = [];
  // Keep the source's bottom-to-top order, including inset roof locating tabs.
  // The gift body, stairs and upper-platform pillars start at the same height;
  // their explicit order keeps the upper deck above its supporting assembly.
  const order: Record<string, number> = { P01: 0, A01: 1, G05: 2, A02: 3, G15: 4 };
  pieces.sort((a, b) => Math.round(a.originalBounds.min.z * 100) - Math.round(b.originalBounds.min.z * 100)
    || (order[a.partId] ?? 5) - (order[b.partId] ?? 5)
    || a.originalBounds.max.z - b.originalBounds.max.z || a.key.localeCompare(b.key));
  const expandedBounds = new THREE.Box3();
  for (const piece of pieces) {
    // Lift straight up without changing X/Y or rotation. Roofs remain aligned
    // above their houses, and stacked houses stay above the roof they stood on.
    // Only overlapping footprints require clearance, so separate columns need
    // not turn into one excessively tall stack.
    const supportHeight = placed.filter(other => overlapFootprints(piece.originalBounds, other))
      .reduce((height, other) => Math.max(height, other.max.z + gap), piece.originalBounds.min.z);
    piece.offset.set(0, 0, supportHeight - piece.originalBounds.min.z);
    const next = piece.originalBounds.clone().translate(piece.offset);
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
