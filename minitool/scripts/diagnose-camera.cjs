/* Local camera-preservation regression. Instrumentation is browser-injected only.
 * Captures submitted uniforms; never reads camera state back from the GPU.
 * Usage: node minitool/scripts/diagnose-camera.cjs mini
 * Optional HAMILY_CAMERA_DIST=/absolute/dist or HAMILY_CAMERA_URL=http://...
 */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const label = process.argv[2] || 'mini';
assert(/^[\w-]+$/.test(label));
const output = path.resolve(process.env.HAMILY_CAMERA_OUTPUT || path.join(__dirname, '../../../artifacts'));
const source = path.resolve(process.env.HAMILY_CAMERA_DIST || path.join(__dirname, '../dist'));
const snapshotRoot = process.env.HAMILY_CAMERA_URL ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'hamily-camera-'));
if (snapshotRoot) fs.cpSync(source, snapshotRoot, { recursive: true });
const config = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: process.env.HAMILY_REDUCED_MOTION === '1' ? 'reduce' : 'no-preference', epsilon: .0001 };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(snapshotRoot, relative);
  if (!file.startsWith(snapshotRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const maxDifference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));

async function installInstrumentation(page) {
  await page.addInitScript(() => {
    const saved = window.__cameraStorage = new Map();
    window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: { getStorage: async ({ key }) => ({ data: saved.get(key) || null }), setStorage: async ({ key, data }) => { saved.set(key, data); } } };
    // Isolated test clipboard only: no interaction with the operating-system clipboard.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__cameraClipboard = text; } } });
    const probe = window.__cameraProbe = { contexts: [], scope: null, camera: null, stableCamera: null, cameraChangedAt: 0, lastDrawAt: 0, draws: 0, gridDraws: 0 };
    // Both runtimes keep this GridHelper fixed: 44 divisions => 180 line
    // vertices, rotation.x=PI/2, position=(150,150,-0.8). A static grid's
    // modelViewMatrix equals camera view * this known model matrix. The
    // independent viewMatrix uniform is optimized out of these actual shaders.
    const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
    const inverseGridModel = [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, -150, .8 - 150 * c, 150 + .8 * c, 1];
    const recoverView = modelView => Array.from({ length: 16 }, (_, index) => {
      const column = Math.floor(index / 4), row = index % 4;
      return [0, 1, 2, 3].reduce((sum, k) => sum + modelView[k * 4 + row] * inverseGridModel[column * 4 + k], 0);
    });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const gl = originalGetContext.apply(this, args);
      if (!gl || !['webgl', 'webgl2'].includes(args[0]) || probe.contexts.some(item => item.gl === gl)) return gl;
      const context = { gl, canvas: this, programs: new Map(), locations: new Map(), currentProgram: null, observedNames: new Set() };
      probe.contexts.push(context);
      const programRecord = program => {
        if (!context.programs.has(program)) context.programs.set(program, { id: context.programs.size + 1, uniforms: {} });
        return context.programs.get(program);
      };
      const useProgram = gl.useProgram.bind(gl);
      gl.useProgram = program => { context.currentProgram = program; if (program) programRecord(program); return useProgram(program); };
      const getUniformLocation = gl.getUniformLocation.bind(gl);
      gl.getUniformLocation = (program, name) => {
        const location = getUniformLocation(program, name);
        if (location) { context.locations.set(location, { program, name }); context.observedNames.add(name); }
        return location;
      };
      const uniformMatrix4fv = gl.uniformMatrix4fv.bind(gl);
      gl.uniformMatrix4fv = (location, transpose, value, ...rest) => {
        const entry = context.locations.get(location);
        if (entry && ['viewMatrix', 'modelViewMatrix', 'projectionMatrix'].includes(entry.name)) {
          const offset = rest[0] || 0;
          programRecord(entry.program).uniforms[entry.name] = Array.from(value).slice(offset, offset + 16);
        }
        return uniformMatrix4fv(location, transpose, value, ...rest);
      };
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) if (gl[method]) {
        const draw = gl[method].bind(gl);
        gl[method] = (...parameters) => {
          if (this.closest('.scene-canvas')) {
            const now = performance.now();
            probe.draws++; probe.lastDrawAt = now;
            const program = context.programs.get(context.currentProgram);
            const uniforms = program?.uniforms;
            const fixedGridDraw = method === 'drawArrays' && parameters[0] === 1 && parameters[1] === 0 && parameters[2] === 180;
            if (fixedGridDraw && uniforms?.modelViewMatrix?.length === 16 && uniforms?.projectionMatrix?.length === 16) {
              probe.gridDraws++;
              const camera = { at: now, programId: program.id, source: 'fixed-ground-grid-modelViewMatrix', view: recoverView(uniforms.modelViewMatrix), projection: uniforms.projectionMatrix, gridModelView: uniforms.modelViewMatrix };
              const previous = probe.camera;
              const changed = !previous || camera.view.some((value, index) => value !== previous.view[index]) || camera.projection.some((value, index) => value !== previous.projection[index]);
              // The website continuously renders and OrbitControls can produce
              // floating-point noise each frame. Keep exact trace samples, but
              // only meaningful matrix motion restarts the settle timer.
              const stable = probe.stableCamera;
              if (!stable || camera.view.some((value, index) => Math.abs(value - stable.view[index]) > 1e-6) || camera.projection.some((value, index) => Math.abs(value - stable.projection[index]) > 1e-6)) {
                probe.cameraChangedAt = now;
                probe.stableCamera = camera;
              }
              probe.camera = camera;
              if (probe.scope) {
                probe.scope.validDraws++;
                if (changed || !probe.scope.samples.length) probe.scope.samples.push(camera);
              }
            }
          }
          return draw(...parameters);
        };
      }
      return gl;
    };
    addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
    });
  });
}
async function state(page) {
  return page.evaluate(() => JSON.parse(window.__cameraStorage.get('hamilymart.assembly.v2') || localStorage.getItem('hamilymart.assembly.v2') || 'null'));
}
async function settle(page, minimumMs = 700) {
  await page.waitForTimeout(minimumMs);
  await page.waitForFunction(() => {
    const probe = window.__cameraProbe;
    return !!probe.camera && !document.querySelector('.scene-loading') && !document.querySelector('.scene-fallback') && performance.now() - probe.cameraChangedAt >= 450;
  }, null, { timeout: 20000 });
}
async function camera(page) {
  return page.evaluate(() => {
    const probe = window.__cameraProbe;
    const box = document.querySelector('.scene-canvas canvas').getBoundingClientRect();
    return { ...probe.camera, draws: probe.draws, canvas: { left: box.left, top: box.top, width: box.width, height: box.height } };
  });
}
async function measure(page, report, name, action, options = {}) {
  await settle(page, 50);
  const before = await camera(page), stateBefore = await state(page);
  await page.evaluate(() => { window.__cameraProbe.scope = { samples: [], validDraws: 0 }; });
  await action();
  await settle(page, options.waitMs || 700);
  const after = await camera(page), stateAfter = await state(page);
  const captured = await page.evaluate(() => { const value = window.__cameraProbe.scope; window.__cameraProbe.scope = null; return value; });
  const samples = captured.samples;
  const maxViewDelta = Math.max(...[after, ...samples].map(sample => maxDifference(before.view, sample.view)));
  const maxProjectionDelta = Math.max(...[after, ...samples].map(sample => maxDifference(before.projection, sample.projection)));
  const changedState = JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);
  const viewPreserved = maxViewDelta <= config.epsilon, projectionPreserved = maxProjectionDelta <= config.epsilon;
  const passed = captured.validDraws > 0 && (options.allowReset || viewPreserved && (options.allowProjection || projectionPreserved))
    && (!options.requireStateChange || changedState)
    && (!options.requireProjectionChange || !projectionPreserved);
  const check = { name, policy: options.allowReset ? 'reset-allowed' : options.allowProjection ? 'view-preserved-projection-may-change' : 'view-and-projection-preserved', passed, viewPreserved, projectionPreserved, maxViewDelta, maxProjectionDelta, changedState, before, after, freshCameraDraws: captured.validDraws, cameraSamples: samples.length, samples };
  report.checks.push(check);
  console.log(JSON.stringify({ name, passed, maxViewDelta, maxProjectionDelta, changedState }));
  return check;
}
async function clear(page) {
  await page.getByRole('button', { name: '清空当前设计', exact: true }).click();
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
}
async function getCode(page) {
  await page.locator('.header-price').click();
  const reveal = page.getByRole('button', { name: '展示可复制清单', exact: true });
  let text;
  if (await reveal.count()) {
    await reveal.click();
    text = await page.getByRole('textbox', { name: '可手动复制的清单和搭配编号', exact: true }).inputValue();
  } else {
    await page.evaluate(() => { window.__cameraClipboard = null; });
    await page.getByRole('button', { name: '复制搭配编号', exact: true }).click();
    await page.waitForFunction(() => typeof window.__cameraClipboard === 'string');
    text = await page.evaluate(() => window.__cameraClipboard);
  }
  const code = text.match(/HM[123]\.[A-Za-z0-9_-]+\.[A-Fa-f0-9]{8}/)?.[0];
  assert(code, 'Exported order text must contain a complete design code');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  return code;
}
async function selectBase(page, report) {
  const view = await camera(page), current = await state(page);
  const z = (current.legHeight || current.bedding.depth) + 7;
  const multiply = (matrix, vector) => [0, 1, 2, 3].map(row => [0, 1, 2, 3].reduce((sum, column) => sum + matrix[column * 4 + row] * vector[column], 0));
  report.baseSelectionAttempts = [];
  for (const [x, y] of [[15, 150], [150, 15], [285, 150], [150, 285], [30, 30], [270, 270]]) {
    const projected = multiply(view.projection, multiply(view.view, [x, y, z, 1]));
    const sx = view.canvas.left + (projected[0] / projected[3] + 1) * view.canvas.width / 2;
    const sy = view.canvas.top + (1 - projected[1] / projected[3]) * view.canvas.height / 2;
    if (sx < view.canvas.left + 5 || sy < view.canvas.top + 60 || sx > view.canvas.left + view.canvas.width - 5 || sy > view.canvas.top + view.canvas.height - 70) continue;
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(100);
    const selectedTitle = await page.locator('.scene-item-title').textContent();
    report.baseSelectionAttempts.push({ world: [x, y, z], screen: [sx, sy], selectedTitle });
    if (await page.locator('.mobile-leg-options').isVisible()) return;
  }
  throw new Error('Could not select the base platform using camera-projected board points');
}
async function back(page) { await page.locator('.mobile-dock-header').getByRole('button', { name: '返回', exact: true }).click(); }
function projectPoint(view, world) {
  const multiply = (matrix, vector) => [0, 1, 2, 3].map(row => [0, 1, 2, 3].reduce((sum, column) => sum + matrix[column * 4 + row] * vector[column], 0));
  const projected = multiply(view.projection, multiply(view.view, [...world, 1]));
  return [view.canvas.left + (projected[0] / projected[3] + 1) * view.canvas.width / 2, view.canvas.top + (1 - projected[1] / projected[3]) * view.canvas.height / 2];
}
async function reproduceTightHatSelection(page, report) {
  const assembly = await state(page), hat = assembly.items.find(item => item.productId === 'roof-cottage');
  assert(hat, 'Default imported assembly must contain the hat cottage');
  const elevation = assembly.legHeight === 0 ? assembly.bedding.depth - 100 : assembly.legHeight - 100;
  const angle = hat.rotation * Math.PI / 180;
  const world = ([x, y, z]) => [hat.x + x * Math.cos(angle) - y * Math.sin(angle), hat.y + x * Math.sin(angle) + y * Math.cos(angle), hat.z + z + elevation];
  // Source G03 bounds relative to its catalog origin (78,239,200).
  const corners = [-76, 86].flatMap(x => [-59.4, 59].flatMap(y => [0, 173.334].map(z => world([x, y, z]))));
  const beforeZoom = await camera(page);
  let zoomed, projectedTop;
  for (let step = 0; step < 4; step++) {
    const box = await page.locator('.scene-canvas canvas').boundingBox();
    await page.mouse.move(box.x + 8, box.y + 80);
    await page.mouse.wheel(0, step === 0 ? -500 : -250);
    await settle(page, 1000);
    zoomed = await camera(page);
    projectedTop = Math.min(...corners.map(point => projectPoint(zoomed, point)[1]));
    if (projectedTop - zoomed.canvas.top < 70) break;
  }
  report.zoomReproduction = { beforeZoom, zoomed, viewDeltaFromZoom: maxDifference(beforeZoom.view, zoomed.view), projectedHatTop: projectedTop, headroomPx: projectedTop - zoomed.canvas.top, attempts: [] };
  assert(report.zoomReproduction.viewDeltaFromZoom > .001, 'Native wheel must actually zoom before the original selection reproduction');
  assert(report.zoomReproduction.headroomPx < 70, 'Zoom must leave too little space for the full toolbar above the hat');
  report.screenshots.beforeTightSelection = path.join(output, `camera-diagnostic-${label}-zoom-before-selection.png`);
  await page.screenshot({ path: report.screenshots.beforeTightSelection });
  await measure(page, report, 'select-zoomed-hat-with-insufficient-top-space', async () => {
    for (const local of [[5, 0, 55], [5, -30, 55], [35, 20, 45], [-35, 0, 40], [5, 0, 105], [5, 30, 30]]) {
      const [x, y] = projectPoint(zoomed, world(local));
      if (x < zoomed.canvas.left + 5 || x > zoomed.canvas.left + zoomed.canvas.width - 5 || y < zoomed.canvas.top + 65 || y > zoomed.canvas.top + zoomed.canvas.height - 65) continue;
      await page.mouse.click(x, y);
      await page.waitForTimeout(100);
      const selectedTitle = await page.locator('.scene-item-title').textContent();
      report.zoomReproduction.attempts.push({ local, x, y, selectedTitle });
      if (selectedTitle === '帽子小屋') return;
    }
    throw new Error('Could not select the enlarged hat cottage in the remaining visible canvas');
  });
  report.zoomReproduction.toolbar = await page.evaluate(() => {
    const toolbar = document.querySelector('.scene-item-toolbar').getBoundingClientRect(), canvas = document.querySelector('.scene-canvas').getBoundingClientRect();
    return { left: toolbar.left, right: toolbar.right, top: toolbar.top, bottom: toolbar.bottom, height: toolbar.height, insideCanvas: toolbar.left >= canvas.left && toolbar.right <= canvas.right && toolbar.top >= canvas.top && toolbar.bottom <= canvas.bottom };
  });
  assert(report.zoomReproduction.toolbar.insideCanvas, 'Enlarged-hat toolbar must clamp inside the canvas');
  await measure(page, report, 'toggle-dimensions-with-zoomed-selection', async () => {
    const toggle = page.getByRole('button', { name: '显示尺寸', exact: true });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  if (snapshotRoot) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = process.env.HAMILY_CAMERA_URL || `http://127.0.0.1:${server.address().port}/`;
  const report = {
    status: 'running', label, recordedAt: new Date().toISOString(), config,
    purpose: 'Local real-browser regression of submitted camera matrices. Not Xiaohongshu container or real-device acceptance.',
    method: 'getUniformLocation records names; uniformMatrix4fv copies CPU-supplied matrices. The actual shaders optimize out viewMatrix, so identify the fixed GridHelper drawArrays(LINES,0,180) and recover view = submitted modelViewMatrix * inverse(gridModel). Both runtimes use grid rotation.x=PI/2 and position=(150,150,-0.8); record its submitted projectionMatrix too. Every check requires new valid grid draws and compares all matrices throughout the operation, including transient changes, with Float32 tolerance 0.0001. No getUniform/getParameter/readPixels/finish or GPU readback. Runtime is unmodified.',
    checks: [], errors: [], screenshots: {},
  };
  if (snapshotRoot) {
    report.entrySha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotRoot, 'index.html'))).digest('hex');
    const bundlePath = fs.existsSync(path.join(snapshotRoot, 'app.js')) ? 'app.js'
      : path.join('assets', fs.readdirSync(path.join(snapshotRoot, 'assets')).find(file => /^index-.*\.js$/.test(file)));
    report.bundleAsset = bundlePath;
    report.bundleSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotRoot, bundlePath))).digest('hex');
  }
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.chromeVersion = browser.version();
    const { epsilon, ...browserContextOptions } = config;
    page = await browser.newPage(browserContextOptions);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) report.errors.push(message.text()); });
    await installInstrumentation(page);
    await page.goto(url, { waitUntil: 'load' });
    await settle(page, 1000);
    report.uniformPrograms = await page.evaluate(() => window.__cameraProbe.contexts.map(context => ({ names: [...context.observedNames], programs: [...context.programs.values()].map(program => ({ id: program.id, capturedMatrices: Object.keys(program.uniforms) })) })));
    report.originalCode = await getCode(page);
    if (!process.env.HAMILY_CAMERA_TIGHT_ONLY) {
    await measure(page, report, 'setup-clear-reset-allowed', () => clear(page), { allowReset: true, requireStateChange: true });
    assert.equal((await state(page)).items.length, 0);
    const defaultCamera = await camera(page);
    const box = await page.locator('.scene-canvas canvas').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 52, box.y + 98, { steps: 10 });
    await page.mouse.up();
    await page.mouse.move(box.x + 10, box.y + 80);
    await page.mouse.wheel(0, -140);
    await settle(page, 1000);
    report.customCamera = await camera(page);
    report.userOrbitZoomDelta = maxDifference(defaultCamera.view, report.customCamera.view);
    assert(report.userOrbitZoomDelta > .001, 'Real orbit and wheel input must establish a non-default camera');

    await measure(page, report, 'select-base', () => selectBase(page, report));
    await measure(page, report, 'change-color', async () => {
      await page.locator('.mobile-color-rail').getByRole('button', { name: '蓝色', exact: true }).click();
      assert.equal(await page.locator('.mobile-color-rail').getByRole('button', { name: '蓝色', exact: true }).getAttribute('aria-pressed'), 'true');
    }, { requireStateChange: true });
    await measure(page, report, 'change-leg-height', async () => {
      await page.locator('.mobile-leg-options').getByRole('button', { name: '20 cm', exact: true }).click();
      assert.equal((await state(page)).legHeight, 200);
    }, { requireStateChange: true });
    await measure(page, report, 'change-bedding', async () => {
      await page.getByRole('button', { name: '垫料高度', exact: true }).click();
      await page.locator('.bedding-option').filter({ hasText: '厚铺' }).filter({ hasText: '20 cm' }).click();
      assert.equal((await state(page)).bedding.depth, 200);
    }, { requireStateChange: true });
    await measure(page, report, 'change-leg-height-to-none', async () => {
      await page.locator('.mobile-leg-options').getByRole('button', { name: '无腿', exact: true }).click();
      assert.equal((await state(page)).legHeight, 0);
    }, { requireStateChange: true });
    await measure(page, report, 'change-style', () => page.getByRole('button', { name: '换个配色', exact: true }).click(), { requireStateChange: true });
    await measure(page, report, 'deselect-base', async () => {
      await back(page);
      await page.locator('.mobile-product-rail').waitFor({ state: 'visible' });
    });
    await measure(page, report, 'add-platform', async () => {
      await page.getByRole('button', { name: '增加平台', exact: true }).click();
      assert.equal(await page.locator('.mobile-dock-header > strong').textContent(), '第二平台');
      assert((await state(page)).extension);
    }, { requireStateChange: true });
    await measure(page, report, 'remove-second-platform', async () => {
      await page.getByRole('button', { name: '移除已选配件', exact: true }).click();
      assert.equal((await state(page)).extension, null);
    }, { requireStateChange: true });
    await measure(page, report, 're-add-second-platform', async () => {
      await page.getByRole('button', { name: '增加平台', exact: true }).click();
      assert((await state(page)).extension);
    }, { requireStateChange: true });
    await measure(page, report, 'deselect-second-platform', () => back(page));
    await measure(page, report, 'add-accessory', async () => {
      await page.locator('.mobile-product').filter({ has: page.locator('strong', { hasText: '方糖小屋' }) }).click();
      assert.equal((await state(page)).items.length, 1);
      assert.equal(await page.locator('.mobile-dock-header > strong').textContent(), '方糖小屋');
    }, { requireStateChange: true });
    await measure(page, report, 'rotate-accessory', () => page.getByRole('button', { name: '旋转已选配件', exact: true }).click(), { requireStateChange: true });
    report.toolbar = await page.evaluate(() => {
      const toolbar = document.querySelector('.scene-item-toolbar').getBoundingClientRect(), canvas = document.querySelector('.scene-canvas').getBoundingClientRect();
      return { left: toolbar.left, right: toolbar.right, top: toolbar.top, bottom: toolbar.bottom, insideCanvas: toolbar.left >= canvas.left && toolbar.right <= canvas.right && toolbar.top >= canvas.top && toolbar.bottom <= canvas.bottom };
    });
    assert(report.toolbar.insideCanvas, 'Accessory toolbar must stay inside the viewport without moving the camera');
    await measure(page, report, 'remove-accessory', async () => {
      await page.getByRole('button', { name: '移除已选配件', exact: true }).click();
      assert.equal((await state(page)).items.length, 0);
    }, { requireStateChange: true });
    await measure(page, report, 'undo-removal', async () => {
      await page.getByRole('button', { name: '后退一步', exact: true }).click();
      assert.equal((await state(page)).items.length, 1);
    }, { requireStateChange: true });
    await measure(page, report, 'redo-removal', async () => {
      await page.getByRole('button', { name: '前进一步', exact: true }).click();
      assert.equal((await state(page)).items.length, 0);
    }, { requireStateChange: true });
    await measure(page, report, 'explode', async () => {
      const canvas = await page.locator('.scene-canvas canvas').boundingBox();
      await page.mouse.dblclick(canvas.x + 5, canvas.y + 80);
      await page.getByRole('button', { name: '恢复组装', exact: true }).waitFor({ state: 'visible' });
    }, { waitMs: 1800 });
    await measure(page, report, 'restore-assembly', async () => {
      await page.getByRole('button', { name: '恢复组装', exact: true }).click();
      await page.getByRole('button', { name: '恢复组装', exact: true }).waitFor({ state: 'hidden' });
    }, { waitMs: 1500 });
    await measure(page, report, 'resize-wider', () => page.setViewportSize({ width: 520, height: 844 }), { allowProjection: true, requireProjectionChange: true });
    await measure(page, report, 'resize-restore-width', () => page.setViewportSize(config.viewport), { allowProjection: true, requireProjectionChange: true });
    await measure(page, report, 'final-clear-reset-allowed', () => clear(page), { allowReset: true, requireStateChange: true });
    await measure(page, report, 'import-reset-allowed', async () => {
      await page.locator('.header-import').click();
      await page.locator('#restore-code').fill(report.originalCode);
      await page.getByRole('button', { name: '应用搭配', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }, { allowReset: true, requireStateChange: true, waitMs: 1200 });
    report.importedCode = await getCode(page);
    report.importCodeIdentical = report.importedCode === report.originalCode;
    assert(report.importCodeIdentical, 'Import must preserve the exact configuration code');
    }
    await reproduceTightHatSelection(page, report);
    report.screenshots.final = path.join(output, `camera-diagnostic-${label}.png`);
    await page.screenshot({ path: report.screenshots.final });
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    const failures = report.checks.filter(check => !check.passed);
    assert.equal(failures.length, 0, `Camera preservation failed: ${failures.map(check => check.name).join(', ')}`);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
    if (page) {
      report.instrumentation = await page.evaluate(() => ({ camera: window.__cameraProbe?.camera, draws: window.__cameraProbe?.draws, contexts: window.__cameraProbe?.contexts.map(context => ({ names: [...context.observedNames], programs: [...context.programs.values()].map(program => ({ id: program.id, capturedMatrices: Object.keys(program.uniforms) })) })) })).catch(() => null);
      report.screenshots.failure = path.join(output, `camera-diagnostic-${label}-failure.png`);
      await page.screenshot({ path: report.screenshots.failure }).catch(() => {});
    }
  } finally {
    const reportPath = path.join(output, `camera-diagnostic-${label}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, reportPath, checks: report.checks.map(({ name, passed, maxViewDelta, maxProjectionDelta }) => ({ name, passed, maxViewDelta, maxProjectionDelta })), importCodeIdentical: report.importCodeIdentical, failure: report.failure, errors: report.errors }, null, 2));
    await browser?.close();
    if (snapshotRoot) { await new Promise(resolve => server.close(resolve)); fs.rmSync(snapshotRoot, { recursive: true, force: true }); }
  }
})();
