export type PreviewFrame = 'interactive' | 'still' | 'skip';

/** No timers: the render loop owns the final sharp frame and visibility. */
export class PreviewQuality {
  private sharpAfter = 250;
  private dirty = true;
  private stillPainted = false;

  /** Hard invalidation: an edit, resize, active gesture or scripted camera move. */
  invalidate(now: number) {
    this.sharpAfter = now + 250;
    this.dirty = true;
    this.stillPainted = false;
  }
  /** Residual OrbitControls damping changes pixels without restarting the wait. */
  cameraChanged(_now: number) { this.dirty = true; }
  /** Bound low-resolution inertia after release instead of waiting for epsilon. */
  gestureEnded(now: number) {
    this.sharpAfter = now + 400;
    this.dirty = true;
    this.stillPainted = false;
  }
  nextFrame(now: number, activelyMoving: boolean): PreviewFrame {
    if (activelyMoving) this.invalidate(now);
    if (now < this.sharpAfter) {
      this.dirty = false;
      return 'interactive';
    }
    // A high-resolution tail frame is not necessarily the final frame: every
    // later camera change is painted until damping really stops.
    if (this.stillPainted && !this.dirty) return 'skip';
    this.stillPainted = true;
    this.dirty = false;
    return 'still';
  }
}
