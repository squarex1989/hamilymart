/** Pixel ceilings protect allocation size; geometry counts never force a tier. */
export function budgetPixelRatio(width: number, height: number, deviceRatio: number,
  still = false, maxBufferSize = 4096, interactionDpr = 1.5) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const pixelLimit = still ? 3_000_000 : 2_000_000;
  const ratioLimit = still ? 3 : Math.max(1.5, Math.min(2, interactionDpr));
  // Performance adaptation cannot request DPR < 1.5. Native device density,
  // total pixels and the actual GPU edge limit remain hard allocation ceilings.
  return Math.min(ratioLimit, Math.max(.1, deviceRatio || 1),
    Math.sqrt(pixelLimit / (w * h)), maxBufferSize / w, maxBufferSize / h);
}
