/** Keep the bedding legible from below without an abrupt visibility switch. */
export const MIN_BEDDING_OPACITY = .2;
export const BEDDING_FADE_DURATION_MS = 420;

export function beddingOpacityForAngle(polarAngle: number) {
  const t = Math.min(1, Math.max(0, (polarAngle - Math.PI / 2) / (Math.PI / 12)));
  return Math.max(MIN_BEDDING_OPACITY, 1 - (1 - MIN_BEDDING_OPACITY) * t * t * (3 - 2 * t));
}

/** Bounded, reversible motion: a camera jump cannot make the pile disappear. */
export class BeddingFade {
  private opacity = 1;
  private previousTime: number | null = null;

  step(polarAngle: number, now: number) {
    const target = beddingOpacityForAngle(polarAngle);
    const delta = this.previousTime === null ? 0 : Math.min(64, Math.max(0, now - this.previousTime));
    this.previousTime = now;
    const distance = target - this.opacity;
    const limit = (1 - MIN_BEDDING_OPACITY) * delta / BEDDING_FADE_DURATION_MS;
    const next = Math.abs(distance) <= limit ? target : this.opacity + Math.sign(distance) * limit;
    const changed = next !== this.opacity;
    this.opacity = next;
    return { opacity: next, changed, active: next !== target };
  }
}
