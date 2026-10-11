type Vector = { x: number | null; y: number | null; z: number | null };
export type MotionSample = {
  acceleration: Vector | null;
  accelerationIncludingGravity?: Vector | null;
};

/** Two strong opposing impulses: turning a phone or one accidental bump is not a shake. */
export function createShakeDetector() {
  let gravity = [0, 0, 0];
  let hasGravity = false;
  let impulse: { vector: number[]; at: number } | null = null;
  let cooldownUntil = 0;
  let lastAt = 0;
  return {
    reset() { impulse = null; hasGravity = false; lastAt = 0; },
    sample(sample: MotionSample, now: number) {
      if (now < cooldownUntil) return false;
      const vector = sample.acceleration;
      let values: number[];
      if (vector && [vector.x, vector.y, vector.z].every(value => typeof value === "number" && Number.isFinite(value))) {
        values = [vector.x!, vector.y!, vector.z!];
      } else {
        const including = sample.accelerationIncludingGravity;
        if (!including || ![including.x, including.y, including.z].every(value => typeof value === "number" && Number.isFinite(value))) return false;
        const raw = [including.x!, including.y!, including.z!];
        if (!hasGravity || now - lastAt > 500) { gravity = raw; hasGravity = true; lastAt = now; return false; }
        // Low-pass gravity estimate rejects slow orientation changes on older sensors.
        const smoothing = Math.min(.25, Math.max(.025, (now - lastAt) / 600));
        gravity = raw.map((value, index) => gravity[index] + (value - gravity[index]) * smoothing);
        values = raw.map((value, index) => value - gravity[index]);
      }
      lastAt = now;
      const magnitude = Math.hypot(...values);
      if (magnitude < 15) return false;
      if (impulse) {
        const delay = now - impulse.at;
        const cosine = values.reduce((sum, value, index) => sum + value * impulse!.vector[index], 0)
          / (magnitude * Math.hypot(...impulse.vector));
        if (delay >= 60 && delay <= 650 && cosine < -.55) {
          impulse = null;
          cooldownUntil = now + 1700;
          return true;
        }
        if (delay < 60) return false;
      }
      impulse = { vector: values, at: now };
      return false;
    },
  };
}

/** Pointer-based double tap works with touch-action:none and rejects a preceding drag/pinch. */
export function createBlankDoubleTap() {
  let previous: { x: number; y: number; at: number; pointerType: string } | null = null;
  return {
    reset() { previous = null; },
    tap(x: number, y: number, now: number, pointerType: string) {
      const match = previous && previous.pointerType === pointerType && now - previous.at <= 330
        && now >= previous.at && Math.hypot(x - previous.x, y - previous.y) <= 26;
      previous = match ? null : { x, y, at: now, pointerType };
      return !!match;
    },
  };
}
