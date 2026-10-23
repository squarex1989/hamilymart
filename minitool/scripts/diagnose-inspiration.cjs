/* Bounded local Chrome integration checks for the inspiration workflow.
 * Native storage is isolated in Node and survives page reloads. No clipboard,
 * real user storage, GPU readback, or Xiaohongshu account is used.
 * HAMILY_PLAYWRIGHT=/absolute/playwright node minitool/scripts/diagnose-inspiration.cjs current
 * Optional HAMILY_INSPIRATION_DIST and HAMILY_INSPIRATION_OUTPUT override paths.
 */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const label = process.argv[2] || 'current';
assert(/^[\w-]+$/.test(label), 'Use a simple diagnostic label');
const source = path.resolve(process.env.HAMILY_INSPIRATION_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(process.env.HAMILY_INSPIRATION_OUTPUT || path.join(__dirname, '../../../artifacts'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamily-inspiration-'));
const manifestPath = path.resolve(__dirname, '../generated/build-files.json');
const manifest = source === path.resolve(__dirname, '../dist') && fs.existsSync(manifestPath)
  ? new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).map(entry => entry.file)) : null;
fs.cpSync(source, root, { recursive: true, filter: file => fs.statSync(file).isDirectory() || !manifest || manifest.has(path.relative(source, file)) });
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'");
  res.end(fs.readFileSync(file));
});
const ASSEMBLY = 'hamilymart.assembly.v2', STYLE = 'hamilymart.catalog-style.v1';
const saved = new Map();
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const platforms = state => [state, state.extension, state.thirdPlatform, state.fourthPlatform].filter(Boolean);
function snapshot() {
  return { state: JSON.parse(saved.get(ASSEMBLY) || 'null'), hint: JSON.parse(saved.get(STYLE) || 'null') };
}
function shape(state) {
  const byId = new Map(state.items.map(item => [item.id, item]));
  const descriptor = item => [item.productId, item.x, item.y, item.z, item.rotation];
  return JSON.stringify([platforms(state).map(platform => platform.baseInsert), state.items.map(item => JSON.stringify([
    ...descriptor(item), byId.has(item.parentId) ? descriptor(byId.get(item.parentId)) : item.parentId,
  ])).sort()]);
}
async function waitSaved(page, predicate = value => !!value.state && !!value.hint) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = snapshot();
    if (predicate(value) && await page.evaluate(() => window.__inspirationPendingWrites === 0)) {
      await page.waitForTimeout(60);
      const settled = snapshot();
      if (predicate(settled) && await page.evaluate(() => window.__inspirationPendingWrites === 0)) return settled;
    }
    await page.waitForTimeout(40);
  }
  throw new Error('Timed out waiting for complete native assembly and palette writes');
}
async function ready(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    const button = [...document.querySelectorAll('.canvas-bottom-actions button')].find(item => item.textContent === '给点灵感');
    return canvas && canvas.width > 0 && button && !button.disabled && !document.querySelector('.scene-loading, .scene-error, .scene-fallback');
  }, null, { timeout: 20000 });
  return waitSaved(page);
}
function assertPreserved(before, after, count) {
  assert.equal(platforms(after.state).length, count, 'Inspiration changed platform count');
  assert.equal(after.state.legHeight, before.state.legHeight, 'Inspiration changed leg height');
  assert.deepEqual(after.state.bedding, before.state.bedding, 'Inspiration changed bedding');
  assert.equal(after.hint.styleId, before.hint.styleId, 'Inspiration changed the catalog palette');
  platforms(before.state).forEach((platform, index) => {
    // A newly added pool may inherit the active pool accent. Existing board,
    // cover, and leg colors must remain exactly as they were.
    const { B01: _beforePool, ...beforeColors } = platform.baseColors;
    const { B01: _afterPool, ...afterColors } = platforms(after.state)[index].baseColors;
    assert.deepEqual(afterColors, beforeColors, 'Inspiration changed a platform color');
  });
  const allowed = after.hint.styleId === 'woodland' ? new Set(['wood', 'peachwood', 'darkwood'])
    : new Set(['white', 'sky', 'yellow', 'butter', 'cream', 'gray']);
  const colors = [...platforms(after.state).map(platform => platform.baseColors), ...after.state.items.map(item => item.colors)];
  for (const [key,color] of colors.flatMap(map => Object.entries(map))) {
    if (key === 'PCW-glass' || key === 'PCR-glass') assert.equal(color,'sky','Pokemon glass remains blue in every palette');
    else assert(allowed.has(color), `Unexpected ${color} in ${after.hint.styleId} palette`);
  }
}
async function changeStyle(page, target) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await waitSaved(page);
    if (before.hint.styleId === target) return before;
    await page.getByRole('button', { name: '换个配色', exact: true }).click();
    await waitSaved(page, value => value.hint?.styleId !== before.hint.styleId);
  }
  throw new Error(`Could not reach ${target} palette through the visible style button`);
}
async function toolbarCheck(page, width, count) {
  await page.setViewportSize({ width, height: 844 });
  const result = await page.evaluate(() => {
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const bar = document.querySelector('.canvas-bottom-actions');
    return {
      viewportWidth: innerWidth, bar: box(bar),
      buttons: [...bar.querySelectorAll(':scope > button')].map(button => ({
        ...box(button), label: button.getAttribute('aria-label') || button.textContent,
        disabled: button.disabled, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth,
        visible: getComputedStyle(button).visibility !== 'hidden' && getComputedStyle(button).display !== 'none',
      })),
    };
  });
  assert.deepEqual(result.buttons.map(button => button.label), ['增加平台', '给点灵感', '换个配色', '垫料与笼子', '清空当前设计']);
  assert.equal(result.buttons[0].disabled, count === 4);
  assert.equal(result.buttons[1].disabled, false);
  assert(result.bar.left >= 0 && result.bar.right <= width, 'Bottom toolbar escapes the viewport');
  assert(result.bar.height <= 54, 'Toolbar unexpectedly grew into the main model area');
  for (const [index, button] of result.buttons.entries()) {
    assert(button.visible && button.width > 0 && button.height >= 40, 'Toolbar action is not visible/tappable');
    assert(button.scrollWidth <= button.clientWidth, `Clipped action label: ${button.label}`);
    assert(button.left >= result.bar.left && button.right <= result.bar.right, `Action outside toolbar: ${button.label}`);
    assert.equal(button.top, result.buttons[0].top, 'Toolbar controls wrapped onto another row');
    if (index) assert(button.left >= result.buttons[index - 1].right - .1, 'Toolbar controls overlap');
  }
  return { platformCount: count, ...result };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = {
    status: 'running', label, recordedAt: new Date().toISOString(),
    purpose: 'Local Chrome inspiration UI and native-storage integration regression; not Xiaohongshu container or phone acceptance.',
    storageMethod: 'Isolated Node Map exposed through the public-shaped xhs.miniTool storage API; the same backend survives page.reload(). No clipboard access.',
    bundleSha256: hash(fs.readFileSync(path.join(root, 'app.js'))),
    toolbarChecks: [], layoutChecks: [], reloadChecks: [], errors: [], screenshots: {},
  };
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.chromeVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.exposeBinding('__inspirationRead', (_source, { key }) => ({ data: saved.get(key) || null }));
    await context.exposeBinding('__inspirationWrite', (_source, { key, data }) => { saved.set(key, data); });
    await context.addInitScript(() => {
      window.__inspirationPendingWrites = 0;
      window.xhs = {
        launchOptions: { miniToolEnv: { buildVersion: 9460000 } },
        miniTool: {
          getStorage: options => window.__inspirationRead(options),
          setStorage: async options => {
            window.__inspirationPendingWrites++;
            try { return await window.__inspirationWrite(options); }
            finally { window.__inspirationPendingWrites--; }
          },
        },
      };
      addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
      });
    });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) report.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    const initial = await ready(page);
    // Seed independent support and bedding heights, then hydrate through the
    // real native draft loader. All subsequent layout changes use visible UI.
    saved.set(ASSEMBLY, JSON.stringify({ ...initial.state, legHeight: 300, bedding: { mode: 'thick', depth: 200 } }));
    saved.delete(STYLE);
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    for (const count of [1, 2, 3, 4]) {
      if (count > 1) {
        await page.getByRole('button', { name: '增加平台', exact: true }).click();
        await waitSaved(page, value => value.state && platforms(value.state).length === count);
      }
      const targetStyle = count === 2 ? 'sky' : 'woodland';
      const before = await changeStyle(page, targetStyle);
      for (const width of [320, 390]) report.toolbarChecks.push(await toolbarCheck(page, width, count));
      await page.getByRole('button', { name: '给点灵感', exact: true }).click();
      const first = await waitSaved(page, value => value.state && value.hint && shape(value.state) !== shape(before.state));
      assertPreserved(before, first, count);
      const firstName = await page.locator('.canvas-notice > span').textContent();
      assert(firstName && !firstName.includes('保存'), 'Inspiration must toast the chosen layout name');
      assert.equal(await page.locator('.mobile-product-rail').isVisible(), true, 'Inspiration must return to component selection');
      await page.getByRole('button', { name: '后退一步', exact: true }).click();
      const undone = await waitSaved(page, value => value.hint?.configurationCode === before.hint.configurationCode);
      assert.deepEqual(undone, before, 'One undo must restore the exact configuration and palette hint');
      await page.getByRole('button', { name: '前进一步', exact: true }).click();
      const redone = await waitSaved(page, value => value.hint?.configurationCode === first.hint.configurationCode);
      assert.deepEqual(redone, first, 'One redo must restore the exact inspired design');
      await page.getByRole('button', { name: '给点灵感', exact: true }).click();
      const second = await waitSaved(page, value => value.state && value.hint && shape(value.state) !== shape(first.state));
      assertPreserved(first, second, count);
      const secondName = await page.locator('.canvas-notice > span').textContent();
      assert.notEqual(secondName, firstName, 'Consecutive inspiration clicks repeated the same layout');
      const thumbnailUrls = await page.locator('.mobile-product-picture img').evaluateAll(images => images.map(image => image.getAttribute('src')));
      assert(thumbnailUrls.length > 0 && thumbnailUrls.every(src => src?.includes(`/thumbnails/${targetStyle}/`)), 'Catalog thumbnails lost the current palette');
      const check = {
        platformCount: count, styleId: targetStyle, legHeight: second.state.legHeight, bedding: second.state.bedding,
        firstName, secondName, beforeConfigurationSha256: hash(before.hint.configurationCode),
        firstConfigurationSha256: hash(first.hint.configurationCode), secondConfigurationSha256: hash(second.hint.configurationCode),
        undoRedoExact: true, distinctConsecutiveLayouts: true, thumbnailCount: thumbnailUrls.length,
      };
      report.layoutChecks.push(check);
      await page.reload({ waitUntil: 'load' });
      const reloaded = await ready(page);
      assert.deepEqual(reloaded, second, 'Reload must retain the exact design and scheme with persistent native storage');
      report.reloadChecks.push({ platformCount: count, styleId: reloaded.hint.styleId, exactStateAndHint: true, configurationSha256: hash(reloaded.hint.configurationCode) });
      console.log(JSON.stringify({ platformCount: count, style: targetStyle, firstName, secondName, passed: true }));
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await ready(page);
    report.screenshots.toolbar320 = path.join(output, `inspiration-diagnostic-${label}-320.png`);
    await page.screenshot({ path: report.screenshots.toolbar320 });
    assert.equal(report.errors.length, 0, `Browser errors: ${report.errors.join('; ')}`);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.stack || String(error);
    if (page) {
      report.screenshots.failure = path.join(output, `inspiration-diagnostic-${label}-failure.png`);
      await page.screenshot({ path: report.screenshots.failure }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, `inspiration-diagnostic-${label}.json`), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    console.log(JSON.stringify({ status: report.status, report: path.join(output, `inspiration-diagnostic-${label}.json`) }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
