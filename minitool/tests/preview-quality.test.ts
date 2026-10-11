import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewQuality } from '../src/lib/preview-quality';
import { budgetPixelRatio } from '../src/lib/render-budget';

test('native phone pixels are restored at rest even after interaction resolution was reduced', () => {
  for (const reduced of [false, true]) {
    assert.equal(budgetPixelRatio(402, 429, 3, reduced, true), 3);
    assert(budgetPixelRatio(402, 429, 3, reduced) <= 1.5);
  }
  for (const [w,h,dpr] of [[1920,1080,2],[4000,3000,4],[9000,100,3],[320,480,1]]) {
    const ratio=budgetPixelRatio(w,h,dpr,false,true,2048);
    assert(w*h*ratio*ratio<=2_000_001);assert(Math.max(w,h)*ratio<=2048.001);assert(ratio<=dpr);
  }
});
test('damping and animations postpone the final crisp frame, then idle does not redraw', () => {
  const quality = new PreviewQuality();
  quality.invalidate(0);
  assert.equal(quality.nextFrame(200, true), 'interactive');
  quality.invalidate(350); // camera is still damping after the pointer ends
  assert.equal(quality.nextFrame(590, false), 'interactive');
  assert.equal(quality.nextFrame(600, false), 'still');
  assert.equal(quality.nextFrame(630, false), 'skip');
  assert.equal(quality.nextFrame(20000, false), 'skip');
  assert.equal(quality.nextFrame(20010, true), 'interactive');
  assert.equal(quality.nextFrame(20260, false), 'still');
});
test('model changes, resize or visibility invalidation always repaint the settled preview', () => {
  const quality = new PreviewQuality();
  assert.equal(quality.nextFrame(500, false), 'still');
  quality.invalidate(1000);
  assert.equal(quality.nextFrame(1100, false), 'interactive');
  assert.equal(quality.nextFrame(1250, false), 'still');
  assert.equal(quality.nextFrame(1500, false), 'skip');
});
