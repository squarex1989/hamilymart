export const SCENE_GEOMETRY_BUDGET = { triangles: 100_000, calls: 100 };
export function budgetPixelRatio(width: number, height: number, deviceRatio: number, reducedResolution: boolean, still = false, maxBufferSize = 4096, interactionDpr = 1.5) {
  // A single settled frame can use native phone pixels without paying that cost
  // on every drag/animation frame. Both modes retain a hard pixel/size ceiling.
  const pixelLimit = !still && reducedResolution ? 1_000_000 : 2_000_000;
  const ratioLimit = still ? 3 : reducedResolution ? 1 : Math.min(2, interactionDpr);
  return Math.min(ratioLimit, Math.max(.1, deviceRatio || 1),
    Math.sqrt(pixelLimit / Math.max(1, width * height)),
    maxBufferSize / Math.max(1, width), maxBufferSize / Math.max(1, height));
}
export class FrameBudget {
  // This is an intermediate resolution/effects reduction, not a geometry LOD.
  // Keep valid models in the standard geometry budget instead of deleting them
  // as soon as resolution drops. Persistently unusable frames still stop safely.
  reducedResolution = false;
  private elapsed = 0;
  private samples = 0;
  private slowWindows = 0;
  sample(milliseconds: number): 'keep' | 'reduce-resolution' | 'fallback' {
    this.elapsed += milliseconds; this.samples++;
    if (this.samples < 30) return 'keep';
    const slow = this.elapsed / this.samples > (this.reducedResolution ? 65 : 48);
    this.elapsed = this.samples = 0;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2) return 'keep';
    this.slowWindows = 0;
    if (this.reducedResolution) return 'fallback';
    this.reducedResolution = true; return 'reduce-resolution';
  }
  reset() { this.elapsed = this.samples = this.slowWindows = 0; }
}
