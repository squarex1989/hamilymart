const PROFILES = [
  { fps: 30, dpr: 1.5 },
  { fps: 60, dpr: 1.5 },
  { fps: 60, dpr: 2 },
] as const;

/** One recoverable controller. Observe raw RAF before pacing; CPU time is only
 * submission headroom, never a claim about completed GPU frames. */
export class InteractionQuality {
  private level = 1;
  private elapsed = 0;
  private frames = 0;
  private delayed = 0;
  private cpuTotal = 0;
  private cpuPeak = 0;
  private renders = 0;
  private healthyWindows = 0;
  private slowWindows = 0;
  private cooldownUntil = 0;
  private pausedUntil = 0;
  private skipNextRaf = true;
  get fps() { return PROFILES[this.level].fps; }
  get dpr() { return PROFILES[this.level].dpr; }

  recordRender(milliseconds: number, now: number) {
    if (now < this.pausedUntil || !Number.isFinite(now)
      || !(milliseconds >= 0) || !Number.isFinite(milliseconds)) return;
    this.cpuTotal += milliseconds;
    this.cpuPeak = Math.max(this.cpuPeak, milliseconds);
    this.renders++;
  }
  observeRaf(milliseconds: number, now: number): boolean {
    if (!Number.isFinite(now) || !(milliseconds > 0) || milliseconds > 250) {
      this.reset(); return false;
    }
    if (now < this.pausedUntil) { this.skipNextRaf = true; return false; }
    // The first interval after a pause can include hidden time, upload or resize.
    if (this.skipNextRaf) { this.skipNextRaf = false; return false; }
    this.elapsed += milliseconds;
    this.frames++;
    if (milliseconds > 24) this.delayed++;
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
      this.healthyWindows = 0;
      this.slowWindows++;
      if (this.slowWindows >= 2) {
        // Remove extra pixels first; keep at least 30 FPS and DPR 1.5.
        this.level = Math.max(0, this.level - 1);
        this.slowWindows = 0;
        this.cooldownUntil = now + 5000;
      }
    } else {
      this.slowWindows = 0;
      if (healthy && now >= this.cooldownUntil) {
        this.healthyWindows++;
        if (this.healthyWindows >= 2) {
          this.level = Math.min(PROFILES.length - 1, this.level + 1);
          this.healthyWindows = 0;
        }
      } else this.healthyWindows = 0;
    }
    this.clearWindow();
    return previousLevel !== this.level;
  }
  private clearWindow() {
    this.elapsed = this.frames = this.delayed = this.cpuTotal = this.cpuPeak = this.renders = 0;
  }
  /** Call after a first upload/resize, or on entering idle/background. All times
   * must share the performance.now()/RAF clock. No timers or GPU reads are used. */
  pauseSampling(now: number, durationMs = 250) {
    this.reset();
    if (Number.isFinite(now)) this.pausedUntil = Math.max(this.pausedUntil, now + Math.max(0, durationMs));
  }
  /** Discard partial observations, retaining quality and a wall-clock cooldown. */
  reset() {
    this.clearWindow();
    this.healthyWindows = this.slowWindows = 0;
    this.skipNextRaf = true;
  }
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
