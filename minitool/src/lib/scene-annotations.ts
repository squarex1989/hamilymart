import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

/** Measures only imported model meshes: selection seams and other helpers never count. */
export function getRenderedModelBounds(root: THREE.Object3D, selectionId?: string): THREE.Box3 {
  const bounds = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.userData.modelMesh) return;
    if (selectionId) {
      let owner: THREE.Object3D | null = node;
      let matches = false;
      while (owner && owner !== root) {
        if (owner.userData.selectionId === selectionId || owner.userData.itemId === selectionId) {
          matches = true;
          break;
        }
        owner = owner.parent;
      }
      if (!matches) return;
    }
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    if (node.geometry.boundingBox)
      bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return bounds;
}

export function getBoxCorners(bounds: THREE.Box3): THREE.Vector3[] {
  return [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) =>
      [bounds.min.z, bounds.max.z].map((z) => new THREE.Vector3(x, y, z)),
    ),
  );
}

export function dimensionsInCentimeters(bounds: THREE.Box3): [number, number, number] {
  const size = bounds.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z].map((value) => Math.round(value) / 10) as [number, number, number];
}

export function createSelectionBox(bounds: THREE.Box3): THREE.Group {
  const group = new THREE.Group();
  const size = bounds.getSize(new THREE.Vector3()).addScalar(1.6);
  group.position.copy(bounds.getCenter(new THREE.Vector3()));
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: "#EEC741", transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide,
  }));
  fill.renderOrder = 3;
  const edgePositions = new THREE.EdgesGeometry(geometry);
  const lineGeometry = new LineSegmentsGeometry().setPositions(Array.from(edgePositions.getAttribute("position").array));
  edgePositions.dispose();
  // Mesh-backed lines have a dependable CSS-pixel width in WebGL on mobile too.
  const edges = new LineSegments2(lineGeometry, new LineMaterial({
    color: "#DEAD00", transparent: true, opacity: .5, linewidth: 2.5,
    dashed: true, dashSize: 6, gapSize: 4, worldUnits: false,
    depthTest: false, depthWrite: false,
  }));
  edges.computeLineDistances();
  edges.renderOrder = 4;
  group.add(fill, edges);
  return group;
}

/** Keep dashes readable at every orbit distance; LineSegments2 handles viewport resolution. */
export function updateSelectionStroke(root: THREE.Object3D, camera: THREE.PerspectiveCamera, viewportHeight: number) {
  const center = root.getWorldPosition(new THREE.Vector3());
  const distance = Math.max(1, camera.position.distanceTo(center));
  const pixelsPerMillimeter = Math.max(1, viewportHeight) / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  root.traverse((node) => {
    if (node instanceof LineSegments2) node.material.dashScale = pixelsPerMillimeter;
  });
}

export function disposeAnnotation(root: THREE.Object3D) {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

/** The dimension lines follow the camera-facing edges of the actual assembly. */
export function dimensionSegments(bounds: THREE.Box3, cameraPosition: THREE.Vector3) {
  const { min, max } = bounds;
  const center = bounds.getCenter(new THREE.Vector3());
  const xSide = cameraPosition.x < center.x ? min.x - 18 : max.x + 18;
  const ySide = cameraPosition.y < center.y ? min.y - 18 : max.y + 18;
  const z = min.z - 10;
  return [
    [new THREE.Vector3(min.x, ySide, z), new THREE.Vector3(max.x, ySide, z)],
    [new THREE.Vector3(xSide, min.y, z), new THREE.Vector3(xSide, max.y, z)],
    [new THREE.Vector3(xSide, ySide, min.z), new THREE.Vector3(xSide, ySide, max.z)],
  ];
}
