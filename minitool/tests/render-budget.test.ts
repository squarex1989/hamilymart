import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetPixelRatio, FrameBudget, SCENE_GEOMETRY_BUDGET } from '../src/lib/render-budget';

test('drawing buffer obeys density and pixel ceilings after every resize and at every tier', () => {
  for (const [w, h, dpr] of [[390, 844, 3], [1920, 1080, 2], [4000, 3000, 4], [320, 480, 1]]) {
    for (const low of [false, true]) for (const cap of [1.5, 1, .75, .6]) {
      const ratio = budgetPixelRatio(w, h, dpr, low, false, 4096, cap);
      assert(ratio <= Math.min(low ? 1 : 2, cap));
      assert(w * h * ratio * ratio <= (low ? 1e6 : 2e6) + 1);
      assert(w * ratio <= 4096 && h * ratio <= 4096);
    }
  }
});

test('settled high-resolution frames remain independent of even the lowest interaction tier', () => {
  assert.equal(budgetPixelRatio(390, 844, 3, true, false, 4096, .6), .6);
  const still = budgetPixelRatio(390, 844, 3, true, true, 4096, .6);
  assert(still > 2 && still <= 3);
  assert(390 * 844 * still * still <= 2e6 + 1);
  assert.equal(still, budgetPixelRatio(390, 844, 3, false, true, 4096, 2));
  for (const [w, h] of [[800, 200], [4000, 3000], [1, 10000]]) {
    const ratio = budgetPixelRatio(w, h, 4, true, true, 1024, .6);
    assert(ratio <= 3);
    assert(w * h * ratio * ratio <= 2e6 + 1);
    assert(w * ratio <= 1024 && h * ratio <= 1024);
  }
});

test('sustained poor frames lower resolution and cadence but never leave 3D, even after thousands of samples', () => {
  const budget = new FrameBudget();
  assert.deepEqual([budget.fpsCap, budget.dprCap, budget.reducedResolution], [Infinity, 2, false]);
  for (const [milliseconds, fps, dpr] of [[55, 30, 1], [75, 20, .75], [100, 15, .6]]) {
    for (let i = 0; i < 59; i++) assert.equal(budget.sample(milliseconds), 'keep');
    assert.equal(budget.sample(milliseconds), 'reduce-quality');
    assert.deepEqual([budget.fpsCap, budget.dprCap, budget.reducedResolution], [fps, dpr, true]);
  }
  for (let i = 0; i < 10_000; i++) assert.equal(budget.sample(150 + i % 300), 'keep');
  assert.deepEqual([budget.fpsCap, budget.dprCap], [15, .6]);
  budget.reset();
  assert.deepEqual([budget.fpsCap, budget.dprCap], [15, .6], 'pause reset retains the safe rendering tier');
});

test('stable frames, pause resets and invalid samples do not trigger a downgrade', () => {
  const budget = new FrameBudget();
  for (let i = 0; i < 120; i++) assert.equal(budget.sample(34), 'keep');
  for (let i = 0; i < 30; i++) budget.sample(80);
  budget.reset();
  for (let i = 0; i < 30; i++) assert.equal(budget.sample(80), 'keep');
  assert.equal(budget.reducedResolution, false);
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.equal(budget.sample(invalid), 'keep');
    for (let i = 0; i < 30; i++) assert.equal(budget.sample(80), 'keep');
  }
  assert.equal(budget.reducedResolution, false);
});

test('our own lower frame-rate caps are not mistaken for more slow rendering', () => {
  const budget = new FrameBudget();
  for (let i = 0; i < 60; i++) budget.sample(55);
  for (let i = 0; i < 600; i++) assert.equal(budget.sample(1000 / 30), 'keep');
  assert.equal(budget.fpsCap, 30);
  for (let i = 0; i < 60; i++) budget.sample(75);
  for (let i = 0; i < 600; i++) assert.equal(budget.sample(1000 / 20), 'keep');
  assert.equal(budget.fpsCap, 20);
});

test('complex scenes only constrain interactive rendering, with no geometry mutation or stop action', () => {
  const { triangles, calls } = SCENE_GEOMETRY_BUDGET;
  const budget = new FrameBudget();
  assert.equal(budget.constrainGeometry(triangles, calls), 'keep');
  assert.equal(budget.constrainGeometry(triangles + 1, calls), 'reduce-quality');
  assert.deepEqual([budget.fpsCap, budget.dprCap], [30, 1]);
  assert.equal(budget.constrainGeometry(triangles + 1, calls), 'keep');
  assert.equal(budget.constrainGeometry(10, calls * 2 + 1), 'reduce-quality');
  assert.deepEqual([budget.fpsCap, budget.dprCap], [20, .75]);
  assert.equal(budget.constrainGeometry(triangles * 1000, calls * 1000), 'keep');
  assert.equal(budget.constrainGeometry(0, 0), 'keep');
  assert.deepEqual([budget.fpsCap, budget.dprCap], [20, .75]);
  for (let i = 0; i < 60; i++) budget.sample(100);
  assert.equal(budget.constrainGeometry(triangles * 1000, calls * 1000), 'keep');
  assert.deepEqual([budget.fpsCap, budget.dprCap], [15, .6]);
});
