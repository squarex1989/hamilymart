import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, InteractionQuality } from '../src/lib/interaction-quality';

function driver() {
  const quality = new InteractionQuality(), pacer = new FramePacer();
  let now = 0;
  return {
    quality,
    get now() { return now; },
    advance(ms: number) { now += ms; },
    run(ms: number, rafMs = 1000 / 60, cpuMs = 3) {
      const end = now + ms;
      while (now + rafMs <= end + .001) {
        now += rafMs;
        // Same order as the runtime: raw RAF before the renderer's own cap.
        quality.observeRaf(rafMs, now);
        if (pacer.shouldDraw(now, quality.fps)) quality.recordRender(cpuMs, now);
      }
    },
  };
}

test('start at 60 FPS/DPR 1.5 and require sustained headroom before DPR 2', () => {
  const d = driver();
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5]);
  d.run(1100);
  assert.equal(d.quality.dpr, 1.5);
  d.run(1100);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 2]);
});

test('sustained load first lowers pixels, then cadence, and never crosses the quality floor', () => {
  const d = driver(); d.run(2200);
  d.run(1100, 1000 / 30);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 2], 'one slow window is not sustained load');
  d.run(1100, 1000 / 30);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5]);
  d.run(2200, 1000 / 30);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [30, 1.5]);
  d.run(60000, 100, 80);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [30, 1.5]);
});

test('a slow scene recovers through 60 FPS before restoring DPR 2', () => {
  const d = driver(); d.run(2200, 1000 / 30);
  assert.equal(d.quality.fps, 30);
  d.run(4500);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [30, 1.5], 'healthy frames cannot bypass cooldown');
  d.run(2700);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5]);
  d.run(2200);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 2]);
});

test('cooldown advances during idle, and capped 30 FPS does not corrupt raw RAF observations', () => {
  const d = driver(); d.run(2200, 1000 / 30);
  d.quality.pauseSampling(d.now);
  d.advance(20000);
  d.run(2200);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5], 'no extra five seconds of dragging after idle');
  d.run(2200);
  assert.equal(d.quality.dpr, 2);
});

test('upload/resize windows and their boundary interval are excluded from measurements', () => {
  const d = driver();
  d.quality.pauseSampling(d.now, 3500);
  d.run(3400, 100, 90);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5]);
  d.advance(200);
  assert.equal(d.quality.observeRaf(200, d.now), false, 'first post-pause interval includes excluded work');
  d.run(1100);
  assert.equal(d.quality.dpr, 1.5, 'the paused interval cannot count as a healthy window either');
  d.run(1100);
  assert.equal(d.quality.dpr, 2);
});

test('frequent short interactions preserve 60 FPS without treating idle and upload gaps as slowness', () => {
  const d = driver();
  for (let i = 0; i < 25; i++) {
    d.run(350);
    d.quality.pauseSampling(d.now);
    d.advance(700);
    d.quality.observeRaf(700, d.now);
  }
  assert.deepEqual([d.quality.fps, d.quality.dpr], [60, 1.5]);
  d.run(2200);
  assert.equal(d.quality.dpr, 2);
});

test('repeated expensive CPU submissions reduce cadence even with fast RAF, while isolated stalls do not', () => {
  const d = driver(); d.run(2200, 1000 / 60, 18);
  assert.deepEqual([d.quality.fps, d.quality.dpr], [30, 1.5]);
  const healthy = driver();
  healthy.run(600);
  healthy.quality.observeRaf(1500, healthy.now + 1500);
  healthy.advance(1500);
  healthy.run(1500);
  assert.equal(healthy.quality.fps, 60);
  for (const invalid of [0, -1, NaN, Infinity]) healthy.quality.observeRaf(invalid, healthy.now);
  healthy.run(2200);
  assert.equal(healthy.quality.dpr, 2);
});

test('alternating healthy and slow windows cannot repeatedly toggle the quality tier', () => {
  const quality = new InteractionQuality();
  let now = 0;
  quality.observeRaf(10, now); // Skip only the initial boundary interval.
  for (let window = 0; window < 20; window++) {
    const step = window % 2 ? 10 : 100;
    for (let sample = 0; sample < 1000 / step; sample++) {
      now += step;
      quality.recordRender(3, now);
      quality.observeRaf(step, now);
    }
  }
  assert.deepEqual([quality.fps, quality.dpr], [60, 1.5]);
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
