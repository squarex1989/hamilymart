export type PreviewFrame = 'interactive' | 'still' | 'skip';

/** No timers: the owned render loop controls visibility/disposal and the final crisp frame. */
export class PreviewQuality {
  private changedAt = 0;
  private stillPainted = false;
  invalidate(now: number) {
    this.changedAt = now;
    this.stillPainted = false;
  }
  nextFrame(now: number, moving: boolean): PreviewFrame {
    if (moving) this.invalidate(now);
    if (now - this.changedAt < 250) return 'interactive';
    if (this.stillPainted) return 'skip';
    this.stillPainted = true;
    return 'still';
  }
}
