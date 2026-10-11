const PROFILES = [
  { fps: 30, dpr: 1 },
  { fps: 30, dpr: 1.5 },
  { fps: 60, dpr: 1.5 },
  { fps: 60, dpr: 2 },
] as const;

/** Promote only from observed RAF cadence and CPU submission headroom.
 * No GPU readback, device lists or idle-frame performance guesses. */
export class InteractionQuality {
  private level = 1;
  private elapsed = 0;
  private frames = 0;
  private delayed = 0;
  private cpuTotal = 0;
  private cpuPeak = 0;
  private renders = 0;
  private healthyWindows = 0;
  private cooldown = 0;
  get fps() { return PROFILES[this.level].fps; }
  get dpr() { return PROFILES[this.level].dpr; }

  recordRender(milliseconds: number) {
    this.cpuTotal += milliseconds;
    this.cpuPeak = Math.max(this.cpuPeak, milliseconds);
    this.renders++;
  }
  observeRaf(milliseconds: number): boolean {
    if (!(milliseconds > 0) || milliseconds > 250) { this.reset(); return false; }
    this.elapsed += milliseconds;
    this.frames++;
    if (milliseconds > 24) this.delayed++;
    this.cooldown = Math.max(0, this.cooldown - milliseconds);
    if (this.elapsed < 1000 || this.renders < 12) return false;
    const cadence = this.elapsed / this.frames;
    const delayedRatio = this.delayed / this.frames;
    const cpu = this.cpuTotal / this.renders;
    const healthy = cadence <= 18.5 && delayedRatio <= .08 && cpu < 8 && this.cpuPeak < 16;
    const slow = this.fps === 60
      ? cadence > 21 || delayedRatio > .22 || cpu > 12
      : cadence > 36 || cpu > 24;
    const previousLevel = this.level;
    if (slow) {
      this.level = Math.max(0, this.level - 1);
      this.healthyWindows = 0;
      this.cooldown = 5000;
    } else if (healthy && !this.cooldown) {
      this.healthyWindows++;
      // Prove the 60 FPS tier before increasing its pixel count.
      if (this.healthyWindows >= (this.level === 1 ? 1 : 2)) {
        this.level = Math.min(PROFILES.length - 1, this.level + 1);
        this.healthyWindows = 0;
      }
    } else this.healthyWindows = 0;
    this.clearWindow();
    return previousLevel !== this.level;
  }
  private clearWindow() {
    this.elapsed = this.frames = this.delayed = this.cpuTotal = this.cpuPeak = this.renders = 0;
  }
  /** A new scene, idle time or hidden tab is not a performance measurement. */
  reset() { this.clearWindow(); this.healthyWindows = 0; }
}

/** Retain the target phase: small RAF jitter must not turn 30 FPS into 20. */
export class FramePacer {
  private deadline = 0;
  private fps = 0;
  shouldDraw(now: number, fps: number): boolean {
    const period = 1000 / fps;
    if (this.fps !== fps || !this.deadline) {
      this.fps = fps; this.deadline = now + period; return true;
    }
    if (now + 1 < this.deadline) return false;
    this.deadline += Math.max(1, Math.floor((now + 1 - this.deadline) / period) + 1) * period;
    return true;
  }
  reset() { this.deadline = this.fps = 0; }
}
