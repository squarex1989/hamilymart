import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { DimensionLayoutCache, OverlayElement, projectToViewport, ToolbarMetrics } from '../src/lib/scene-overlay-layout';
import { dimensionSegments } from '../src/lib/scene-annotations';

function trackedElement() {
  let hidden = true, text = '', left = '', top = '';
  const counts = { hidden: 0, text: 0, position: 0, measurements: 0 };
  const element = {
    get hidden() { return hidden; }, set hidden(value: boolean) { hidden = value; counts.hidden++; },
    get textContent() { return text; }, set textContent(value: string) { text = value; counts.text++; },
    get offsetWidth() { counts.measurements++; return 180; },
    get offsetHeight() { counts.measurements++; return 52; },
    style: {
      get left() { return left; }, set left(value: string) { left = value; counts.position++; },
      get top() { return top; }, set top(value: string) { top = value; counts.position++; },
    },
  } as HTMLElement;
  return { element, counts };
}

test('unchanged overlay frames perform no DOM writes or layout measurement', () => {
  const { element, counts } = trackedElement();
  const overlay = new OverlayElement(element);
  const metrics = new ToolbarMetrics();
  for (let frame = 0; frame < 120; frame++) {
    overlay.show(true);
    metrics.measure(element, 402, 429, '圆形泳池', false, true);
    overlay.text('宽 30 cm');
    overlay.position(200, 80);
  }
  assert.deepEqual(counts, { hidden: 1, text: 1, position: 2, measurements: 2 });
  assert.equal(metrics.width, 180);
  assert.equal(metrics.height, 52);
  // A lifecycle handler can hide the toolbar without making the presenter stale.
  element.hidden = true;
  overlay.show(true);
  assert.equal(element.hidden, false);
  overlay.position(210, 80);
  assert.equal(counts.position, 3);
});

test('toolbar metrics refresh for changed controls, label, viewport, or selection bounds', () => {
  const { element, counts } = trackedElement();
  const metrics = new ToolbarMetrics();
  metrics.measure(element, 402, 429, '房子', false, true);
  metrics.measure(element, 402, 429, '房子', true, true);
  metrics.measure(element, 402, 429, '房子', true, false);
  metrics.measure(element, 402, 429, '平台小圆盖', true, false);
  metrics.measure(element, 800, 429, '平台小圆盖', true, false);
  metrics.measure(element, 800, 600, '平台小圆盖', true, false);
  assert.equal(counts.measurements, 12);
  metrics.invalidate();
  metrics.measure(element, 800, 600, '平台小圆盖', true, false);
  assert.equal(counts.measurements, 14);
});

test('dimension geometry stays cached during orbit within a quadrant, then follows the correct facing edges', () => {
  const bounds = new Box3(new Vector3(0, 0, 100), new Vector3(300, 300, 340));
  const cache = new DimensionLayoutCache();
  const position = new Vector3(800, -600, 900);
  assert.equal(cache.update(bounds, position), true);
  const segments = cache.segments, midpoints = cache.midpoints;
  for (let frame = 0; frame < 120; frame++) {
    position.set(900 + frame, -700 + frame, 500 + frame);
    assert.equal(cache.update(bounds, position), false);
    assert.equal(cache.segments, segments);
    assert.equal(cache.midpoints, midpoints);
  }
  for (const [x, y] of [[-800, -600], [-800, 600], [800, 600], [800, -600]]) {
    position.set(x, y, 900);
    assert.equal(cache.update(bounds, position), true);
    assert.deepEqual(cache.segments, dimensionSegments(bounds, position));
    cache.segments.forEach(([start, end], i) => assert.deepEqual(cache.midpoints[i], start.clone().lerp(end, .5)));
  }
  bounds.max.z += 100;
  assert.equal(cache.update(bounds, position), true);
  assert.equal(cache.segments[2][1].z, 440);
  cache.invalidate();
  assert.equal(cache.update(bounds, position), true);
});

test('overlay projection follows CSS viewport resizing and leaves the world point unchanged', () => {
  const camera = new PerspectiveCamera(34, 402 / 429, 10, 4500);
  camera.position.set(600, -600, 600);
  camera.up.set(0, 0, 1);
  camera.lookAt(150, 150, 150);
  camera.updateMatrixWorld();
  const point = new Vector3(150, 150, 150), original = point.clone(), out = new Vector3();
  assert.equal(projectToViewport(point, camera, 402, 429, out), out);
  assert(Math.abs(out.x - 201) < 1e-6 && Math.abs(out.y - 214.5) < 1e-6);
  const expected = point.clone().project(camera);
  projectToViewport(point, camera, 804, 858, out);
  assert(Math.abs(out.x - (expected.x + 1) * 402) < 1e-6);
  assert(Math.abs(out.y - (1 - expected.y) * 429) < 1e-6);
  assert.equal(out.z, expected.z);
  assert.deepEqual(point, original);
});
