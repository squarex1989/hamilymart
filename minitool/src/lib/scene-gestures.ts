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
