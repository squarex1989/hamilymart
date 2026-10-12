/* Browser-only fault injection. Never installs hooks in the application bundle.
 * node minitool/scripts/diagnose-recovery.cjs mini
 * HAMILY_RECOVERY_DIST=/absolute/dist selects the website build.
 */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const label = process.argv[2] || 'mini';
assert(/^[\w-]+$/.test(label));
const source = path.resolve(process.env.HAMILY_RECOVERY_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(__dirname, '../../../artifacts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamily-recovery-'));
fs.cpSync(source, root, { recursive: true });
const config = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
async function instrument(page, blockWebGL = false) {
  await page.addInitScript(({ blockWebGL }) => {
    const saved = window.__recoveryStorage = new Map();
    window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: { getStorage: async ({ key }) => ({ data: saved.get(key) || null }), setStorage: async ({ key, data }) => { saved.set(key, data); } } };
    const probe = window.__recovery = { blockWebGL, contexts: [], cameras: new Map(), draws: 0, gridDraws: 0, scope: null, events: [], fallbackSeen: false, slow: { enabled: false, frames: 0, previousReal: null, virtualTime: 0 } };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => {
      const slow = probe.slow;
      if (slow.enabled) {
        if (slow.previousReal !== time) {
          slow.virtualTime = slow.previousReal === null ? time : slow.virtualTime + 110;
          slow.previousReal = time; slow.frames++;
        }
        callback(slow.virtualTime);
      } else callback(time);
    });
    const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
    const inverseGrid = [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, -150, .8 - 150 * c, 150 + .8 * c, 1];
    const viewFromGrid = matrix => Array.from({ length: 16 }, (_, index) => {
      const column = Math.floor(index / 4), row = index % 4;
      return [0, 1, 2, 3].reduce((sum, k) => sum + matrix[k * 4 + row] * inverseGrid[column * 4 + k], 0);
    });
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (probe.blockWebGL && ['webgl', 'webgl2', 'experimental-webgl'].includes(args[0])) return null;
      const gl = getContext.apply(this, args);
      if (!gl || !['webgl', 'webgl2'].includes(args[0]) || probe.contexts.some(context => context.gl === gl)) return gl;
      const context = { gl, canvas: this, id: probe.contexts.length + 1, programs: new Map(), locations: new Map(), current: null };
      probe.contexts.push(context);
      this.addEventListener('webglcontextlost', event => { probe.events.push({ type: event.type, contextId: context.id, at: performance.now() }); });
      this.addEventListener('webglcontextrestored', event => { probe.events.push({ type: event.type, contextId: context.id, at: performance.now() }); });
      const program = key => { if (!context.programs.has(key)) context.programs.set(key, {}); return context.programs.get(key); };
      const useProgram = gl.useProgram.bind(gl);
      gl.useProgram = value => { context.current = value; return useProgram(value); };
      const location = gl.getUniformLocation.bind(gl);
      gl.getUniformLocation = (key, name) => { const value = location(key, name); if (value) context.locations.set(value, { key, name }); return value; };
      const matrix = gl.uniformMatrix4fv.bind(gl);
      gl.uniformMatrix4fv = (where, transpose, values, ...rest) => {
        const uniform = context.locations.get(where);
        if (uniform && ['modelViewMatrix', 'projectionMatrix'].includes(uniform.name)) program(uniform.key)[uniform.name] = Array.from(values).slice(rest[0] || 0, (rest[0] || 0) + 16);
        return matrix(where, transpose, values, ...rest);
      };
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) if (gl[name]) {
        const draw = gl[name].bind(gl);
        gl[name] = (...parameters) => {
          if (this.isConnected && this.closest('.scene-canvas')) {
            probe.draws++;
            if (name === 'drawArrays' && parameters[0] === 1 && parameters[1] === 0 && parameters[2] === 180) {
              const values = program(context.current);
              if (values.modelViewMatrix?.length === 16 && values.projectionMatrix?.length === 16) {
                probe.gridDraws++;
                const camera = { at: performance.now(), contextId: context.id, view: viewFromGrid(values.modelViewMatrix), projection: values.projectionMatrix };
                const old = probe.cameras.get(this);
                camera.changedAt = !old || camera.view.some((value, index) => Math.abs(value - old.view[index]) > 1e-6) || camera.projection.some((value, index) => Math.abs(value - old.projection[index]) > 1e-6) ? camera.at : old.changedAt;
                probe.cameras.set(this, camera);
                if (probe.scope) {
                  probe.scope.validDraws++;
                  const previous = probe.scope.samples.at(-1);
                  if (!previous || previous.contextId !== camera.contextId || camera.view.some((value, index) => value !== previous.view[index]) || camera.projection.some((value, index) => value !== previous.projection[index])) probe.scope.samples.push(camera);
                }
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
      const observe = () => { if (document.querySelector('.scene-fallback,#fallback-component')) probe.fallbackSeen = true; };
      new MutationObserver(observe).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      observe();
    });
  }, { blockWebGL });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const probe = window.__recovery, canvas = document.querySelector('.scene-canvas canvas'), box = canvas?.getBoundingClientRect();
    const design = JSON.parse(window.__recoveryStorage.get('hamilymart.assembly.v2') || localStorage.getItem('hamilymart.assembly.v2') || 'null');
    return { at: performance.now(), camera: canvas ? probe.cameras.get(canvas) || null : null, design, draws: probe.draws, gridDraws: probe.gridDraws,
      canvas: canvas ? { connected: canvas.isConnected, visible: getComputedStyle(canvas).display !== 'none' && box.width > 0 && box.height > 0, width: canvas.width, height: canvas.height, cssWidth: box.width, cssHeight: box.height, count: document.querySelectorAll('.scene-canvas canvas').length } : null,
      fallbackSeen: probe.fallbackSeen, fallbackPresent: !!document.querySelector('.scene-fallback,#fallback-component'), error: document.querySelector('.scene-error')?.textContent || null, errorSelectCount: document.querySelectorAll('.scene-error select').length, events: probe.events, slowFrames: probe.slow.frames };
  });
}
async function healthy(page, afterGridDraws = -1) {
  await page.waitForFunction(after => {
    const probe = window.__recovery, canvas = document.querySelector('.scene-canvas canvas'), camera = canvas && probe.cameras.get(canvas);
    return camera && probe.gridDraws > after && !document.querySelector('.scene-error,.scene-fallback,.scene-loading') && performance.now() - camera.changedAt > 450;
  }, afterGridDraws, { timeout: 30000 });
  const value = await snapshot(page);
  assert(value.canvas?.visible && value.canvas.count === 1, 'A single visible real WebGL canvas must remain');
  assert.equal(value.fallbackSeen, false, 'DOM fallback was briefly shown');
  return value;
}
async function customView(page) {
  const before = await healthy(page), box = await page.locator('.scene-canvas canvas').boundingBox();
  await page.mouse.move(box.x + 8, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 95, { steps: 10 }); await page.mouse.up();
  await page.mouse.move(box.x + 8, box.y + 80); await page.mouse.wheel(0, -120);
  await page.waitForTimeout(1200);
  const after = await healthy(page, before.gridDraws);
  assert(difference(before.camera.view, after.camera.view) > .001, 'Input must establish a non-default camera');
  return after;
}
async function beginScope(page) { await page.evaluate(() => { window.__recovery.scope = { validDraws: 0, samples: [] }; }); }
async function verifyRecovery(page, before, expectedDesign) {
  const after = await healthy(page, before.gridDraws);
  const scope = await page.evaluate(() => { const value = window.__recovery.scope; window.__recovery.scope = null; return value; });
  const samples = [after.camera, ...scope.samples];
  const viewDelta = Math.max(...samples.map(camera => difference(before.camera.view, camera.view)));
  const projectionDelta = Math.max(...samples.map(camera => difference(before.camera.projection, camera.projection)));
  assert(scope.validDraws > 0, 'Recovery must submit new actual camera draws');
  assert(viewDelta <= .0001 && projectionDelta <= .0001, `Recovery changed camera: view=${viewDelta}, projection=${projectionDelta}`);
  assert.deepEqual(after.design, expectedDesign, 'Recovery must preserve the complete edited design');
  return { before, after, viewDelta, projectionDelta, freshCameraDraws: scope.validDraws, cameraSamples: scope.samples };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const bundleAsset = fs.existsSync(path.join(root, 'app.js')) ? 'app.js' : path.join('assets', fs.readdirSync(path.join(root, 'assets')).find(file => /^index-.*\.js$/.test(file)));
  const report = { status: 'running', label, recordedAt: new Date().toISOString(), config, bundleAsset, bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, bundleAsset))).digest('hex'),
    purpose: 'Local Chrome fault-injection regression, not Xiaohongshu-container or real-device acceptance.',
    method: 'Capture CPU-supplied modelView/projection uniforms only on the fixed 180-vertex ground grid; recover camera view using inverse Rx(PI/2),T(150,150,-0.8). No GPU readback. Each recovery requires fresh draws and compares all transient camera samples. Model failure uses one intercepted SHB resource; context loss uses WEBGL_lose_context; no-WebGL intercepts canvas.getContext; slow-frame injection advances only RAF timestamps by 110ms per real browser frame without busy waiting or changing timers/performance.now.', scenarios: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true }); report.chromeVersion = browser.version();
    const run = async (name, action, blockWebGL = false) => {
      const result = { name, status: 'running', pageErrors: [], consoleErrors: [] }; report.scenarios.push(result);
      const page = await browser.newPage(config);
      page.on('pageerror', error => result.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
      try {
        await instrument(page, blockWebGL);
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
        await action(page, result);
        assert.equal(result.pageErrors.length, 0, result.pageErrors.join('\n'));
        result.status = 'passed';
      } catch (error) { result.status = 'failed'; result.failure = error.stack || String(error); result.failureState = await snapshot(page).catch(() => null); }
      finally {
        result.screenshot = path.join(output, `recovery-diagnostic-${label}-${name}.png`);
        await page.screenshot({ path: result.screenshot }).catch(() => {});
        await page.close();
        console.log(JSON.stringify({ name, status: result.status, failure: result.failure, viewDelta: result.recovery?.viewDelta, projectionDelta: result.recovery?.projectionDelta }));
      }
    };
    await run('resource-retry', async (page, result) => {
      await healthy(page);
      await page.getByRole('button', { name: '增加平台', exact: true }).click(); await page.waitForTimeout(700); await healthy(page);
      await page.locator('.mobile-dock-header').getByRole('button', { name: '返回', exact: true }).click();
      const before = await customView(page);
      result.requests = []; let blocked = false;
      await page.route(/\/models\/SHB\.(?:js|glb)(?:\?|$)/, async route => {
        if (!blocked) { blocked = true; result.requests.push({ url: route.request().url(), outcome: 'injected-abort' }); await route.abort('failed'); }
        else { result.requests.push({ url: route.request().url(), outcome: 'allowed-retry' }); await route.continue(); }
      });
      page.on('response', response => { if (/\/models\/SHB\.(?:js|glb)(?:\?|$)/.test(response.url())) result.requests.push({ url: response.url(), status: response.status() }); });
      await beginScope(page);
      await page.locator('.mobile-product').filter({ has: page.locator('strong', { hasText: '方糖小屋' }) }).click();
      await page.locator('.scene-error').waitFor({ state: 'visible', timeout: 20000 });
      result.failedState = await snapshot(page);
      assert(blocked, 'Resource fault must actually trigger');
      assert(result.failedState.design.items.some(item => item.productId === 'cube-house'), 'The attempted addition must persist in the design');
      assert(result.failedState.canvas?.visible && !result.failedState.fallbackSeen && !result.failedState.fallbackPresent, 'Resource failure must retain the canvas without DOM fallback');
      await page.getByRole('button', { name: '重新加载3D', exact: true }).click();
      result.recovery = await verifyRecovery(page, before, result.failedState.design);
      assert(result.requests.some(request => request.status === 200), 'Previously failed model must load successfully on retry');
    });
    await run('context-restored', async (page, result) => {
      const before = await customView(page); await beginScope(page);
      const supported = await page.evaluate(() => {
        const canvas = document.querySelector('.scene-canvas canvas');
        const context = window.__recovery.contexts.find(value => value.canvas === canvas);
        window.__contextLossExtension = context.gl.getExtension('WEBGL_lose_context');
        if (!window.__contextLossExtension) return false;
        window.__contextLossExtension.loseContext(); return true;
      });
      assert(supported, 'Chrome must expose WEBGL_lose_context for the real loss test');
      await page.waitForFunction(() => window.__recovery.events.some(event => event.type === 'webglcontextlost'));
      await page.locator('.scene-error').waitFor({ state: 'visible' });
      result.lostState = await snapshot(page);
      assert(result.lostState.canvas?.visible && !result.lostState.fallbackSeen, 'Context loss must retain the canvas and design');
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__contextLossExtension.restoreContext());
      await page.waitForFunction(() => window.__recovery.events.some(event => event.type === 'webglcontextrestored'));
      result.recovery = await verifyRecovery(page, before, before.design);
      assert.equal(result.recovery.before.canvas.count, result.recovery.after.canvas.count);
    });
    await run('no-webgl-retry', async (page, result) => {
      await page.locator('.scene-error').waitFor({ state: 'visible', timeout: 20000 });
      result.failedState = await snapshot(page);
      assert(result.failedState.error && /3D|WebGL/.test(result.failedState.error), 'No-WebGL failure must have an explicit 3D error');
      assert(!result.failedState.fallbackSeen && !result.failedState.fallbackPresent && result.failedState.errorSelectCount === 0, 'Error UI must not offer a simplified component list');
      assert.equal(await page.getByRole('button', { name: '重新加载3D', exact: true }).isVisible(), true);
      await page.evaluate(() => { window.__recovery.blockWebGL = false; });
      await page.getByRole('button', { name: '重新加载3D', exact: true }).click();
      result.recoveredState = await healthy(page, result.failedState.gridDraws);
      assert.deepEqual(result.recoveredState.design, result.failedState.design);
    }, true);
    await run('complex-slow-frames', async (page, result) => {
      await healthy(page);
      // A real valid multi-platform assembly, created through ordinary UI actions.
      for (let i = 0; i < 2; i++) {
        await page.getByRole('button', { name: '增加平台', exact: true }).click(); await page.waitForTimeout(700); await healthy(page);
        await page.locator('.mobile-dock-header').getByRole('button', { name: '返回', exact: true }).click();
        for (const product of ['礼物盒小屋', '帽子小屋']) {
          const previous = await snapshot(page);
          await page.locator('.mobile-product').filter({ has: page.locator('strong', { hasText: product }) }).click(); await page.waitForTimeout(700); await healthy(page);
          const added = await snapshot(page);
          assert.equal(added.design.items.length, previous.design.items.length + 1, `Complex scene must really add ${product}`);
          await page.locator('.mobile-dock-header').getByRole('button', { name: '返回', exact: true }).click();
        }
      }
      result.complexState = await healthy(page);
      assert(result.complexState.design.extension && result.complexState.design.thirdPlatform && result.complexState.design.items.length >= 7);
      const box = await page.locator('.scene-canvas canvas').boundingBox();
      await page.mouse.move(box.x + 8, box.y + 80); await page.mouse.down();
      try {
        await page.evaluate(() => { window.__recovery.slow.enabled = true; });
        await page.waitForFunction(() => window.__recovery.slow.frames >= 220, null, { timeout: 15000 });
        result.afterSlowFrames = await snapshot(page);
        assert(result.afterSlowFrames.gridDraws - result.complexState.gridDraws >= 120, 'Sustained virtual slow cadence must keep submitting real 3D draws');
        assert(result.afterSlowFrames.canvas?.visible && !result.afterSlowFrames.error && !result.afterSlowFrames.fallbackSeen, 'Slow or complex scenes must never switch to a DOM fallback or stop in an error');
        assert.deepEqual(result.afterSlowFrames.design, result.complexState.design);
      } finally { await page.mouse.up(); }
      // This page is closed immediately; the synthetic RAF clock is not reused.
    });
    report.status = report.scenarios.every(scenario => scenario.status === 'passed') ? 'passed' : 'failed';
    if (report.status === 'failed') process.exitCode = 1;
  } catch (error) { report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1; }
  finally {
    const reportPath = path.join(output, `recovery-diagnostic-${label}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, reportPath, scenarios: report.scenarios.map(({ name, status, failure }) => ({ name, status, failure })), failure: report.failure }, null, 2));
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
