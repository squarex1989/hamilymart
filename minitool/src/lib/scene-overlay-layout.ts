import * as THREE from "three";
import { dimensionSegments } from "./scene-annotations";

/** Keep the overlay write phase free of layout reads and unchanged DOM writes. */
export class OverlayElement {
  private x = NaN;
  private y = NaN;
  constructor(private element: HTMLElement) {}
  show(visible: boolean) {
    // Other scene lifecycle handlers may also hide these elements.
    if (this.element.hidden === visible) this.element.hidden = !visible;
  }
  text(value: string) {
    if (this.element.textContent !== value) this.element.textContent = value;
  }
  position(x: number, y: number) {
    if (x !== this.x) { this.x = x; this.element.style.left = `${x}px`; }
    if (y !== this.y) { this.y = y; this.element.style.top = `${y}px`; }
  }
}

/** Toolbar geometry changes with its content or viewport, not with camera orbit. */
export class ToolbarMetrics {
  width = 0;
  height = 0;
  private viewportWidth = -1;
  private viewportHeight = -1;
  private title = "";
  private canRotate = false;
  private canRemove = false;
  invalidate() { this.viewportWidth = -1; }
  measure(element: HTMLElement, width: number, height: number, title: string, canRotate: boolean, canRemove: boolean) {
    if (width === this.viewportWidth && height === this.viewportHeight && title === this.title
      && canRotate === this.canRotate && canRemove === this.canRemove) return;
    this.viewportWidth = width; this.viewportHeight = height;
    this.title = title; this.canRotate = canRotate; this.canRemove = canRemove;
    this.width = element.offsetWidth;
    this.height = element.offsetHeight;
  }
}

/** Projection uses CSS viewport pixels even when the drawing buffer changes DPR. */
export function projectToViewport(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number, target: THREE.Vector3) {
  target.copy(point).project(camera);
  target.x = (target.x + 1) * width / 2;
  target.y = (1 - target.y) * height / 2;
  return target;
}

/** Dimension endpoints only change when model bounds or the camera-facing sides change. */
export class DimensionLayoutCache {
  segments: THREE.Vector3[][] = [];
  midpoints: THREE.Vector3[] = [];
  private bounds = new THREE.Box3();
  private side = -1;
  invalidate() { this.side = -1; }
  update(bounds: THREE.Box3, cameraPosition: THREE.Vector3) {
    const side = (cameraPosition.x < (bounds.min.x + bounds.max.x) / 2 ? 1 : 0)
      + (cameraPosition.y < (bounds.min.y + bounds.max.y) / 2 ? 2 : 0);
    if (side === this.side && this.bounds.equals(bounds)) return false;
    this.side = side;
    this.bounds.copy(bounds);
    this.segments = dimensionSegments(bounds, cameraPosition);
    this.midpoints = this.segments.map(([start, end]) => start.clone().lerp(end, .5));
    return true;
  }
}
