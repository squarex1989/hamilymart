import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Color, SRGBColorSpace } from 'three';
// Exercise the real library's background path: this used to throw on the first frame.
// @ts-expect-error Three does not publish types for this internal renderer function.
import { WebGLBackground } from 'three/src/renderers/webgl/WebGLBackground.js';
import { WebXRManager } from '../build/disabled-xr';

test('ordinary Three rendering works with XR disabled for transparent and colored backgrounds', () => {
  let clears = 0;
  const xr = new WebXRManager();
  const renderer = {
    xr, outputColorSpace: SRGBColorSpace, autoClear: true,
    autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    getRenderTarget: () => null,
    clear: () => { clears++; },
  };
  const state = { buffers: {
    color: { setClear() {}, setMask() {} },
    depth: { setTest() {}, setMask() {} },
  } };
  const background = WebGLBackground(renderer, {}, {}, state, {}, true, true);
  const scene = new Scene();
  assert.doesNotThrow(() => background.render(scene));
  scene.background = new Color('#DDE0E2');
  assert.doesNotThrow(() => background.render(scene));
  assert.equal(clears, 2);
  assert.equal(xr.enabled, false);
  assert.equal(xr.isPresenting, false);
  assert.equal(xr.getEnvironmentBlendMode(), undefined);
});
