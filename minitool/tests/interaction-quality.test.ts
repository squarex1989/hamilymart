import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, InteractionQuality } from '../src/lib/interaction-quality';
import { budgetPixelRatio } from '../src/lib/render-budget';

function run(quality: InteractionQuality, seconds: number, rafMs = 1000 / 60, cpuMs = 3) {
  const pacer = new FramePacer();
  for (let time = 0; time < seconds * 1000; time += rafMs) {
    if (pacer.shouldDraw(time, quality.fps)) quality.recordRender(cpuMs);
    quality.observeRaf(rafMs);
  }
}
test('start conservatively, prove smooth 60 FPS before increasing interactive pixels', () => {
  const quality = new InteractionQuality();
  assert.equal(quality.fps, 30); assert.equal(quality.dpr, 1.5);
  run(quality, .5);
  assert.equal(quality.fps, 30);
  run(quality, .6);
  assert.equal(quality.fps, 60); assert.equal(quality.dpr, 1.5);
  run(quality, 2.1);
  assert.equal(quality.fps, 60); assert.equal(quality.dpr, 2);
});
test('30 Hz RAF, costly submissions and paused observations never qualify as headroom', () => {
  for (const [raf, cpu] of [[1000 / 30, 3], [1000 / 60, 18]]) {
    const quality = new InteractionQuality(); run(quality, 8, raf, cpu);
    assert.equal(quality.fps, 30); assert(quality.dpr <= 1.5);
  }
  const quality = new InteractionQuality();
  run(quality, .7); quality.reset(); run(quality, .7);
  assert.equal(quality.fps, 30);
  quality.observeRaf(3000); run(quality, .7);
  assert.equal(quality.fps, 30);
});
test('sustained load backs off resolution then frame rate, with recovery hysteresis', () => {
  const quality = new InteractionQuality(); run(quality, 3.2);
  assert.equal(quality.dpr, 2);
  run(quality, 1.1, 1000 / 30);
  assert.equal(quality.fps, 60); assert.equal(quality.dpr, 1.5);
  run(quality, 1.1, 1000 / 30);
  assert.equal(quality.fps, 30); assert.equal(quality.dpr, 1.5);
  run(quality, 1.1, 50, 30);
  assert.equal(quality.dpr, 1);
  run(quality, 4);
  assert.equal(quality.dpr, 1);
  run(quality, 5);
  assert.equal(quality.fps, 60);
});
test('jitter does not progressively delay capped frames; missed frames do not cause catch-up bursts', () => {
  const pacer = new FramePacer();
  let draws = 0;
  for (let i = 0; i <= 600; i++) if (pacer.shouldDraw(i * 1000 / 60 + (i % 3) * .7, 30)) draws++;
  assert(draws >= 299 && draws <= 302, `${draws} frames in 10 seconds`);
  assert.equal(pacer.shouldDraw(15000, 30), true);
  assert.equal(pacer.shouldDraw(15001, 30), false);
  assert.equal(pacer.shouldDraw(15002, 60), true);
  pacer.reset(); assert.equal(pacer.shouldDraw(15003, 30), true);
});
test('adaptive sharp tier and still frames both retain device, edge and total-pixel limits', () => {
  for (const [w, h, dpr] of [[390,418,3], [1920,1080,2], [7000,150,3], [320,480,1]]) {
    for (const still of [true, false]) {
      const ratio = budgetPixelRatio(w,h,dpr,false,still,2048,2);
      assert(ratio <= dpr); assert(ratio <= (still ? 3 : 2));
      assert(w*h*ratio*ratio <= 2_000_001); assert(Math.max(w,h)*ratio <= 2048.001);
    }
  }
});
