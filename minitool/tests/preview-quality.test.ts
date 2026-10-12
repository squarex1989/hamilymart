import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewQuality } from '../src/lib/preview-quality';

test('active gestures remain interactive, then residual inertia becomes sharp within 400ms of release', () => {
  const quality = new PreviewQuality();
  for (let now = 0; now <= 1000; now += 50) {
    quality.cameraChanged(now);
    assert.equal(quality.nextFrame(now, true), 'interactive');
  }
  quality.gestureEnded(1000);
  for (let now = 1050; now < 1400; now += 50) {
    quality.cameraChanged(now);
    assert.equal(quality.nextFrame(now, false), 'interactive');
  }
  quality.cameraChanged(1400);
  assert.equal(quality.nextFrame(1400, false), 'still');
});

test('sharp tail frames keep painting every residual camera change and stop only after the last change', () => {
  const quality = new PreviewQuality();
  quality.gestureEnded(1000);
  for (let now = 1400; now <= 3000; now += 50) {
    quality.cameraChanged(now);
    assert.equal(quality.nextFrame(now, false), 'still', `camera motion at ${now} cannot be frozen`);
    assert.equal(quality.nextFrame(now + 10, false), 'skip');
  }
  assert.equal(quality.nextFrame(50000, false), 'skip');
  quality.cameraChanged(50001);
  assert.equal(quality.nextFrame(50001, false), 'still', 'late residual changes cannot be lost');
  assert.equal(quality.nextFrame(50020, false), 'skip');
});

test('a new gesture during the sharp tail immediately uses interactive pixels and gets a fresh release deadline', () => {
  const quality = new PreviewQuality();
  quality.gestureEnded(1000);
  assert.equal(quality.nextFrame(1400, false), 'still');
  assert.equal(quality.nextFrame(1410, true), 'interactive');
  quality.gestureEnded(1500);
  quality.cameraChanged(1899);
  assert.equal(quality.nextFrame(1899, false), 'interactive');
  assert.equal(quality.nextFrame(1900, false), 'still');
  assert.equal(quality.nextFrame(2000, false), 'skip');
});

test('hard edits, resize, visibility and scripted camera moves repaint a settled preview', () => {
  const quality = new PreviewQuality();
  assert.equal(quality.nextFrame(500, false), 'still');
  assert.equal(quality.nextFrame(600, false), 'skip');
  quality.invalidate(1000);
  assert.equal(quality.nextFrame(1100, false), 'interactive');
  assert.equal(quality.nextFrame(1250, false), 'still');
  assert.equal(quality.nextFrame(1500, false), 'skip');
});

test('model loading and non-camera animation can remain active as long as necessary', () => {
  const quality = new PreviewQuality();
  for (let now = 0; now <= 5000; now += 100) assert.equal(quality.nextFrame(now, true), 'interactive');
  assert.equal(quality.nextFrame(5200, false), 'interactive');
  assert.equal(quality.nextFrame(5250, false), 'still');
  assert.equal(quality.nextFrame(5300, false), 'skip');
});
