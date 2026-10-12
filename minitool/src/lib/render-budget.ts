/** Advisory draw-cost thresholds: exceeding them lowers cadence, never removes geometry. */
export const SCENE_GEOMETRY_BUDGET = { triangles: 100_000, calls: 100 };
export function budgetPixelRatio(width: number, height: number, deviceRatio: number, reducedResolution: boolean, still = false, maxBufferSize = 4096, interactionDpr = 1.5) {
  // A single settled frame can use native phone pixels without paying that cost
  // on every drag/animation frame. Both modes retain a hard pixel/size ceiling.
  const pixelLimit = !still && reducedResolution ? 1_000_000 : 2_000_000;
  const ratioLimit = still ? 3 : Math.min(reducedResolution ? 1 : 2, interactionDpr);
  return Math.min(ratioLimit, Math.max(.1, deviceRatio || 1),
    Math.sqrt(pixelLimit / Math.max(1, width * height)),
    maxBufferSize / Math.max(1, width), maxBufferSize / Math.max(1, height));
}

const PERFORMANCE_TIERS = [
  { fpsCap: Infinity, dprCap: 2, slowFrameMs: 48 },
  { fpsCap: 30, dprCap: 1, slowFrameMs: 65 },
  { fpsCap: 20, dprCap: .75, slowFrameMs: 85 },
  { fpsCap: 15, dprCap: .6, slowFrameMs: Infinity },
] as const;
export type FrameBudgetAction = 'keep' | 'reduce-quality';

/** Bound interactive pixel/cadence cost while keeping the full 3D scene at every tier.
 * Settled high-resolution frames are independent of these interactive limits.
 */
export class FrameBudget {
  private level = 0;
  private elapsed = 0;
  private samples = 0;
  private slowWindows = 0;
  get reducedResolution() { return this.level > 0; }
  get fpsCap() { return PERFORMANCE_TIERS[this.level].fpsCap; }
  get dprCap() { return PERFORMANCE_TIERS[this.level].dprCap; }

  sample(milliseconds: number): FrameBudgetAction {
    if (!(milliseconds > 0) || !Number.isFinite(milliseconds)) { this.reset(); return 'keep'; }
    // There is no stop/fallback state, even if the lowest tier remains slow.
    if (this.level === PERFORMANCE_TIERS.length - 1) return 'keep';
    this.elapsed += milliseconds; this.samples++;
    if (this.samples < 30) return 'keep';
    const slow = this.elapsed / this.samples > PERFORMANCE_TIERS[this.level].slowFrameMs;
    this.elapsed = this.samples = 0;
    this.slowWindows = slow ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2) return 'keep';
    return this.reduceTo(this.level + 1);
  }

  /** Geometry counts choose a conservative render tier, without changing any model. */
  constrainGeometry(triangles: number, calls: number): FrameBudgetAction {
    const load = Math.max(triangles / SCENE_GEOMETRY_BUDGET.triangles, calls / SCENE_GEOMETRY_BUDGET.calls);
    return this.reduceTo(load > 2 ? 2 : load > 1 ? 1 : 0);
  }

  private reduceTo(level: number): FrameBudgetAction {
    if (level <= this.level) return 'keep';
    this.level = level;
    this.reset();
    return 'reduce-quality';
  }
  /** Pauses and scene changes clear observations, without repeatedly retrying a costly tier. */
  reset() { this.elapsed = this.samples = this.slowWindows = 0; }
}
