/* Local rendering diagnosis only; not Xiaohongshu container or real-device acceptance. */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.env.HAMILY_RENDER_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(__dirname, '../generated');
const DEVICE_DPR = 3;
const STILL_PIXEL_LIMIT = 3_000_000;
const INTERACTION_DPR_LIMIT = 2; // Starts at 1.5; sustained frame headroom may promote to 2.
const DPR_TOLERANCE = .025; // Canvas backing dimensions are rounded to whole pixels.
const STILL_OBSERVATION_MS = 850;
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'");
  res.end(fs.readFileSync(file));
});

async function snapshot(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    const observed = window.__hamilyContexts.find(entry => entry.canvas === canvas);
    if (!canvas || !observed) return { drawCalls: 0, canvasVisible: false, fallback: !!document.querySelector('.scene-fallback') };
    const gl = observed.context;
    const box = canvas.getBoundingClientRect();
    const attributes = gl.getContextAttributes();
    // SAMPLES describes the currently bound draw framebuffer. Explicitly inspect
    // the default buffer, then restore the previous binding without disturbing Three.
    const bindingTarget = observed.type === 'webgl2' ? gl.DRAW_FRAMEBUFFER : gl.FRAMEBUFFER;
    const bindingParameter = observed.type === 'webgl2' ? gl.DRAW_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING;
    const previousFramebuffer = gl.getParameter(bindingParameter);
    if (previousFramebuffer !== null) gl.bindFramebuffer(bindingTarget, null);
    const samples = gl.getParameter(gl.SAMPLES);
    const sampleBuffers = gl.getParameter(gl.SAMPLE_BUFFERS);
    if (previousFramebuffer !== null) gl.bindFramebuffer(bindingTarget, previousFramebuffer);
    return {
      capturedAt: performance.now(),
      devicePixelRatio,
      drawCalls: observed.drawCalls,
      firstSharpAfterRelease: observed.firstSharpAfterRelease,
      globalDrawCalls: window.__hamilyDraws,
      lastDraw: observed.lastDraw,
      canvasVisible: getComputedStyle(canvas).display !== 'none' && box.width > 0 && box.height > 0,
      fallback: !!document.querySelector('.scene-fallback'),
      loading: !!document.querySelector('.scene-loading'),
      headerText: document.querySelector('.site-header')?.textContent,
      priceInScene: !!document.querySelector('.studio .canvas-price'),
      canvas: {
        width: canvas.width, height: canvas.height,
        cssWidth: box.width, cssHeight: box.height,
        cssClientWidth: canvas.clientWidth, cssClientHeight: canvas.clientHeight,
        effectiveDprX: canvas.width / box.width, effectiveDprY: canvas.height / box.height,
        pixelCount: canvas.width * canvas.height,
      },
      context: {
        type: observed.type,
        requestedAttributes: observed.requestedAttributes,
        actualAttributes: attributes,
        defaultFramebufferSamples: samples,
        defaultFramebufferSampleBuffers: sampleBuffers,
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight,
        contextLost: gl.isContextLost(),
      },
    };
  });
}

function expectedStillDpr(state) {
  return Math.min(state.devicePixelRatio, 3, Math.sqrt(STILL_PIXEL_LIMIT / (state.canvas.cssWidth * state.canvas.cssHeight)));
}
function assertStillResolution(state) {
  assert.equal(state.canvasVisible, true, 'Scene canvas must be visible');
  assert.equal(state.fallback, false, 'Scene unexpectedly entered fallback mode');
  const expected = expectedStillDpr(state);
  assert(Math.abs(state.canvas.effectiveDprX - expected) <= DPR_TOLERANCE, `Still DPR X ${state.canvas.effectiveDprX} != ${expected}`);
  assert(Math.abs(state.canvas.effectiveDprY - expected) <= DPR_TOLERANCE, `Still DPR Y ${state.canvas.effectiveDprY} != ${expected}`);
  assert(state.canvas.pixelCount <= STILL_PIXEL_LIMIT, 'Still render exceeds 3M pixels');
  assert.equal(state.lastDraw?.width, state.canvas.width, 'Backing-store resize must be followed by an actual draw');
  assert.equal(state.lastDraw?.height, state.canvas.height, 'Backing-store resize must be followed by an actual draw');
}
async function waitForStillResolution(page) {
  await page.waitForFunction(({ pixelLimit, tolerance }) => {
    const canvas = document.querySelector('.scene-canvas canvas');
    const observed = window.__hamilyContexts.find(entry => entry.canvas === canvas);
    if (!canvas || !observed || !observed.lastDraw || document.querySelector('.scene-loading')) return false;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const expected = Math.min(devicePixelRatio, 3, Math.sqrt(pixelLimit / (box.width * box.height)));
    return Math.abs(canvas.width / box.width - expected) <= tolerance
      && Math.abs(canvas.height / box.height - expected) <= tolerance
      && observed.lastDraw.width === canvas.width && observed.lastDraw.height === canvas.height
      && canvas.width * canvas.height <= pixelLimit
      // The high-resolution draw itself must have settled, not just the CSS dimensions.
      && performance.now() - observed.lastDraw.at >= 350;
  }, { pixelLimit: STILL_PIXEL_LIMIT, tolerance: DPR_TOLERANCE }, { timeout: 15000 });
  const state = await snapshot(page);
  assertStillResolution(state);
  return state;
}
async function assertIdleDraws(page) {
  const before = await waitForStillResolution(page);
  await page.waitForTimeout(STILL_OBSERVATION_MS);
  const after = await snapshot(page);
  assertStillResolution(after);
  assert.equal(after.drawCalls, before.drawCalls, 'An unchanged settled scene must not keep drawing');
  return { observationMs: STILL_OBSERVATION_MS, beforeDrawCalls: before.drawCalls, afterDrawCalls: after.drawCalls, delta: after.drawCalls - before.drawCalls };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  const errors = [], modelLoads = [];
  const report = {
    purpose: 'Local Chrome rendering diagnosis with an iPhone-like viewport; not Xiaohongshu container or real-device acceptance',
    requestedViewport: { width: 390, height: 844, deviceScaleFactor: DEVICE_DPR, isMobile: true, hasTouch: true },
    limits: { stillDpr: 3, stillPixels: STILL_PIXEL_LIMIT, initialInteractionDpr: 1.5, interactionDpr: INTERACTION_DPR_LIMIT, interactionPolicy: 'Starts at DPR 1.5; sustained frame headroom may promote to DPR 2', idleObservationMs: STILL_OBSERVATION_MS },
    status: 'running', modelLoads, screenshots: {}, errors,
  };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DEVICE_DPR, isMobile: true, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
    page.on('response', response => { if (/\/models\/.*\.js(?:\?|$)/.test(response.url())) modelLoads.push({ url: response.url().split('/').pop(), status: response.status() }); });
    await page.addInitScript(() => {
      const saved = new Map();
      window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: { getStorage: async ({ key }) => ({ data: saved.get(key) || null }), setStorage: async ({ key, data }) => { saved.set(key, data); } } };
      window.__hamilyDraws = 0;
      window.__hamilyContexts = [];
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const context = original.apply(this, args);
        if (context && (args[0] === 'webgl2' || args[0] === 'webgl') && !window.__hamilyContexts.some(entry => entry.context === context)) {
          const observed = { context, canvas: this, type: args[0], requestedAttributes: args[1] || null, drawCalls: 0, lastDraw: null };
          window.__hamilyContexts.push(observed);
          for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) if (context[method]) {
            const draw = context[method].bind(context);
            context[method] = (...parameters) => {
              window.__hamilyDraws++;
              observed.drawCalls++;
              if (window.__hamilyReleasedAt && !observed.firstSharpAfterRelease
                && observed.canvas.width / observed.canvas.clientWidth >= Math.min(devicePixelRatio, 3) - .025) {
                observed.firstSharpAfterRelease = performance.now();
              }
              observed.lastDraw = { width: observed.canvas.width, height: observed.canvas.height, at: performance.now() };
              return draw(...parameters);
            };
          }
        }
        return context;
      };
      addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    // The loader disappears only after all initial model builds complete. A later
    // still-quality draw is required, rather than expecting a continuous render loop.
    await page.waitForFunction(() => !document.querySelector('.scene-loading') && window.__hamilyDraws > 0, null, { timeout: 30000 });
    assert(modelLoads.length >= 15, 'Expected the complete starter model set');
    assert(modelLoads.every(load => load.status === 200), 'A local model script failed to load');
    report.initial = await waitForStillResolution(page);
    assert.equal(report.initial.devicePixelRatio, DEVICE_DPR);
    assert.equal(report.initial.priceInScene, true);
    assert.equal(report.initial.context.actualAttributes?.antialias, true, 'Actual WebGL context did not enable antialiasing');
    assert(report.initial.context.defaultFramebufferSamples > 0, 'Default framebuffer has no multisample antialiasing');
    assert.equal(errors.length, 0, errors.join('\n'));
    report.initialIdle = await assertIdleDraws(page);
    report.screenshots.initialStill = path.join(output, 'render-diagnostic-mobile-dpr3.png');
    await page.screenshot({ path: report.screenshots.initialStill });

    report.layoutChecks = [];
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await waitForStillResolution(page);
      const layout = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        return { width: innerWidth, brand: box('.brand'), importButton: box('.header-import'), price: box('.canvas-price'), studio: box('.studio') };
      });
      assert(layout.brand.left >= 56);
      assert(layout.importButton.right <= width - 104 + .5);
      assert(layout.brand.right <= layout.importButton.left + .5);
      assert(layout.price.top >= layout.studio.top);
      assert(layout.price.right <= layout.studio.right);
      report.layoutChecks.push(layout);
    }

    const beforeDrag = await waitForStillResolution(page);
    const canvasBox = await page.locator('.scene-canvas').boundingBox();
    assert(canvasBox && canvasBox.width > 0 && canvasBox.height > 0);
    // Start in blank space below the price row, avoiding component picking. Move
    // repeatedly across several actual frames, so idle promotion cannot mask drag DPR.
    const start = { x: canvasBox.x + 12, y: canvasBox.y + Math.min(90, canvasBox.height * .25) };
    const dragSamples = [];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      for (let step = 1; step <= 10; step++) {
        await page.mouse.move(start.x + step * 6, start.y + step * 3);
        await page.waitForTimeout(65);
        dragSamples.push(await snapshot(page));
      }
      report.interaction = { before: beforeDrag, samples: dragSamples };
      assert(dragSamples.every(state => state.canvas.effectiveDprX <= INTERACTION_DPR_LIMIT + DPR_TOLERANCE
        && state.canvas.effectiveDprY <= INTERACTION_DPR_LIMIT + DPR_TOLERANCE), 'DPR exceeded the adaptive interaction ceiling of 2 during the drag');
      assert(dragSamples.at(-1).drawCalls > beforeDrag.drawCalls, 'Dragging did not cause real WebGL draws');
      assert(dragSamples.some(state => state.canvas.effectiveDprX < beforeDrag.canvas.effectiveDprX - .1), 'Drag resolution did not decrease from native still quality');
    } finally {
      await page.mouse.up();
    }
    const pointerReleasedAt = await page.evaluate(() => window.__hamilyReleasedAt = performance.now());
    report.restored = await waitForStillResolution(page);
    report.restoration = {
      pointerReleasedAt,
      highResolutionDrawAt: report.restored.firstSharpAfterRelease,
      finalSettledDrawAfterReleaseMs: report.restored.lastDraw.at - pointerReleasedAt,
      highResolutionDrawAfterReleaseMs: report.restored.firstSharpAfterRelease - pointerReleasedAt,
      effectiveDprX: report.restored.canvas.effectiveDprX,
      effectiveDprY: report.restored.canvas.effectiveDprY,
    };
    assert(report.restoration.highResolutionDrawAfterReleaseMs >= 0 && report.restoration.highResolutionDrawAfterReleaseMs < 700, 'A released gesture must regain high resolution during its inertia tail');
    report.restoredIdle = await assertIdleDraws(page);
    report.screenshots.restoredStill = path.join(output, 'render-diagnostic-mobile-dpr3-after-interaction.png');
    await page.screenshot({ path: report.screenshots.restoredStill });

    // Keep the existing blank-area explode/restore and price-dialog regression checks.
    await page.mouse.dblclick(canvasBox.x + 12, canvasBox.y + 80);
    await page.getByRole('button', { name: '恢复组装', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '恢复组装', exact: true }).click();
    await page.getByRole('button', { name: '恢复组装', exact: true }).waitFor({ state: 'hidden' });
    await waitForStillResolution(page);
    report.orbitAndExplode = 'passed';
    await page.locator('.canvas-price').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.scene-fallback').count(), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    report.priceDialog = 'passed';

    // Inspect the actual mobile controls for the no-leg business regression.
    // This browser has an isolated in-memory storage mock, not a user's saved design.
    await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '垫料高度', exact: true }).click();
    await page.locator('.bedding-option').filter({ hasText: '不铺垫料' }).click();
    await waitForStillResolution(page);
    const selectionBox = await page.locator('.scene-canvas').boundingBox();
    report.platformSelectionAttempts = [];
    // Visible plate to the right of the pool in the restored orbit view. The
    // earlier lower-edge coordinates fell below the plate, then hit the pool.
    for (const [x, y] of [[.68, .59], [.74, .56], [.64, .6], [.7, .54], [.61, .62]]) {
      if (await page.locator('.mobile-leg-options').isVisible()) break;
      await page.mouse.click(selectionBox.x + selectionBox.width * x, selectionBox.y + selectionBox.height * y);
      await page.locator('.mobile-leg-options').waitFor({ state: 'visible', timeout: 350 }).catch(() => {});
      report.platformSelectionAttempts.push({ x, y, selectedTitle: await page.locator('.mobile-dock-header > strong').textContent() });
    }
    assert.equal(await page.locator('.mobile-leg-options').isVisible(), true, 'Could not select the base platform for the leg-control check');
    report.noLegs = [];
    for (const bedding of ['none', 'thick-20cm']) {
      if (bedding === 'thick-20cm') {
        await page.getByRole('button', { name: '垫料高度', exact: true }).click();
        await page.locator('.bedding-option').filter({ hasText: '厚铺' }).filter({ hasText: '20 cm' }).click();
      }
      const legOptions = page.locator('.mobile-leg-options');
      const noLegs = legOptions.getByRole('button', { name: '无腿', exact: true });
      assert.equal(await noLegs.isEnabled(), true, `No-leg control disabled with bedding ${bedding}`);
      await legOptions.getByRole('button', { name: '10 cm', exact: true }).click();
      await noLegs.click();
      assert.equal(await noLegs.getAttribute('aria-pressed'), 'true', `No-leg choice was not applied with bedding ${bedding}`);
      report.noLegs.push({ bedding, enabled: true, selected: true });
    }
    // Exercise cached annotation layout after selection, model changes, and resize.
    const dimensionsToggle = page.getByRole('button', { name: '显示尺寸', exact: true });
    await dimensionsToggle.click();
    assert.equal(await dimensionsToggle.getAttribute('aria-pressed'), 'true');
    report.annotationChecks = [];
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await waitForStillResolution(page);
      const annotations = await page.evaluate(() => {
        const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
        const toolbar = document.querySelector('.scene-item-toolbar');
        return {
          width: innerWidth, canvas: box(document.querySelector('.scene-canvas')), price: box(document.querySelector('.canvas-price')),
          toolbar: { ...box(toolbar), hidden: toolbar.hidden, title: toolbar.querySelector('.scene-item-title').textContent },
          labels: [...document.querySelectorAll('.scene-dimension-label')].map(label => ({ ...box(label), hidden: label.hidden, text: label.textContent, leftStyle: label.style.left, topStyle: label.style.top })),
        };
      });
      assert.equal(annotations.toolbar.hidden, false, 'Selected platform toolbar unexpectedly hidden');
      assert.equal(annotations.toolbar.title, '基础平台');
      assert(annotations.toolbar.left >= annotations.canvas.left && annotations.toolbar.right <= annotations.canvas.right, 'Toolbar escaped horizontal canvas bounds');
      assert(annotations.toolbar.top >= annotations.price.bottom, 'Toolbar overlaps the top price row');
      assert(annotations.toolbar.bottom <= annotations.canvas.bottom, 'Toolbar escaped vertical canvas bounds');
      assert.equal(annotations.labels.length, 3, 'Expected length, width, and height labels');
      assert(annotations.labels.some(label => !label.hidden), 'All enabled dimension labels are unexpectedly hidden');
      assert(annotations.labels.every(label => /^[长宽高] [\d.]+ cm$/.test(label.text) && !/NaN|Infinity/.test(`${label.leftStyle} ${label.topStyle}`)), 'Dimension labels have invalid values or positions');
      report.annotationChecks.push(annotations);
    }
    report.screenshots.annotations = path.join(output, 'render-diagnostic-annotations.png');
    await page.screenshot({ path: report.screenshots.annotations });
    await dimensionsToggle.click();
    await waitForStillResolution(page);
    assert.equal(await dimensionsToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.scene-dimension-label:not([hidden])').count(), 0, 'Dimension labels remained visible after switching them off');
    report.dimensionToggle = 'passed';
    const accessoryCanvas = await page.locator('.scene-canvas').boundingBox();
    report.accessorySelectionAttempts = [];
    for (const [x, y] of [[.48, .28], [.5, .23], [.44, .3], [.69, .43]]) {
      if (await page.getByRole('button', { name: '旋转已选配件', exact: true }).isVisible()) break;
      await page.mouse.click(accessoryCanvas.x + accessoryCanvas.width * x, accessoryCanvas.y + accessoryCanvas.height * y);
      await page.getByRole('button', { name: '旋转已选配件', exact: true }).waitFor({ state: 'visible', timeout: 350 }).catch(() => {});
      report.accessorySelectionAttempts.push({ x, y, selectedTitle: await page.locator('.scene-item-title').textContent() });
    }
    assert.equal(await page.getByRole('button', { name: '旋转已选配件', exact: true }).isVisible(), true, 'Could not select an accessory to check the full toolbar');
    report.accessoryToolbarChecks = [];
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await waitForStillResolution(page);
      const toolbarState = await page.evaluate(() => {
        const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; };
        const toolbar = document.querySelector('.scene-item-toolbar');
        return { width: innerWidth, canvas: box(document.querySelector('.scene-canvas')), price: box(document.querySelector('.canvas-price')),
          toolbar: { ...box(toolbar), hidden: toolbar.hidden, title: toolbar.querySelector('.scene-item-title').textContent },
          buttons: [...toolbar.querySelectorAll('button')].map(button => ({ ...box(button), label: button.getAttribute('aria-label'), disabled: button.disabled })),
        };
      });
      assert.equal(toolbarState.toolbar.hidden, false);
      assert.equal(toolbarState.buttons.length, 2, 'Expected both rotate and remove actions');
      assert(toolbarState.buttons.every(button => !button.disabled && button.right > button.left && button.bottom > button.top));
      assert(toolbarState.toolbar.left >= toolbarState.canvas.left && toolbarState.toolbar.right <= toolbarState.canvas.right, 'Accessory toolbar escaped horizontal bounds');
      assert(toolbarState.toolbar.top >= toolbarState.price.bottom && toolbarState.toolbar.bottom <= toolbarState.canvas.bottom, 'Accessory toolbar overlaps the price row or escapes vertical bounds');
      report.accessoryToolbarChecks.push(toolbarState);
    }
    report.screenshots.accessoryToolbar = path.join(output, 'render-diagnostic-accessory-toolbar.png');
    await page.screenshot({ path: report.screenshots.accessoryToolbar });
    assert.equal(errors.length, 0, errors.join('\n'));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
    if (page) {
      try { report.failureState = await snapshot(page); } catch (_) { /* Keep the primary diagnostic failure. */ }
      try {
        report.screenshots.failure = path.join(output, 'render-diagnostic-failure.png');
        await page.screenshot({ path: report.screenshots.failure });
      } catch (_) { /* A closed or crashed page may not permit a screenshot. */ }
    }
    throw error;
  } finally {
    const reportPath = path.join(output, 'render-diagnostic.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, purpose: report.purpose, reportPath, screenshots: report.screenshots,
      initialCanvas: report.initial?.canvas, actualContextAttributes: report.initial?.context.actualAttributes,
      defaultFramebufferSamples: report.initial?.context.defaultFramebufferSamples,
      initialIdle: report.initialIdle, restoration: report.restoration, restoredIdle: report.restoredIdle,
      orbitAndExplode: report.orbitAndExplode, priceDialog: report.priceDialog, noLegs: report.noLegs, dimensionToggle: report.dimensionToggle,
      annotationWidths: report.annotationChecks?.map(check => check.width), accessoryToolbarWidths: report.accessoryToolbarChecks?.map(check => check.width), failure: report.failure, errors }, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
