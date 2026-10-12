import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetPixelRatio } from '../src/lib/render-budget';

test('interaction preserves its density floor without exceeding native phone density', () => {
  for (const cap of [.6, 1, 1.5, 2, 3]) {
    const ratio = budgetPixelRatio(390, 418, 3, false, 4096, cap);
    assert.equal(ratio, Math.max(1.5, Math.min(2, cap)));
  }
  assert.equal(budgetPixelRatio(390, 418, 1, false), 1);
  assert.equal(budgetPixelRatio(390, 418, 1.25, false), 1.25);
});

test('portrait still frames use DPR 3 within the 3MP budget independently of interaction pixels', () => {
  for (const cap of [1.5, 2]) {
    assert.equal(budgetPixelRatio(390, 844, 3, true, 4096, cap), 3);
    assert.equal(budgetPixelRatio(390, 844, 3, false, 4096, cap), cap);
  }
});

test('large canvases and limited GPUs retain hard edge and allocation limits at every density', () => {
  for (const [w, h, dpr, edge] of [[390, 844, 3, 4096], [1920, 1080, 2, 4096], [4000, 3000, 4, 2048], [9000, 100, 3, 1024]]) {
    for (const still of [false, true]) for (const cap of [1.5, 2]) {
      const ratio = budgetPixelRatio(w, h, dpr, still, edge, cap);
      assert(ratio <= dpr);
      assert(ratio <= (still ? 3 : cap));
      assert(w * h * ratio * ratio <= (still ? 3e6 : 2e6) + 1);
      assert(Math.max(w, h) * ratio <= edge + .001);
    }
  }
});

test('resizing back to phone dimensions restores sharp pixels without any persistent budget state', () => {
  assert(budgetPixelRatio(4000, 3000, 3, false, 2048) < 1.5);
  assert.equal(budgetPixelRatio(390, 418, 3, false, 2048), 1.5);
  assert.equal(budgetPixelRatio(390, 418, 3, true, 2048), 3);
});
