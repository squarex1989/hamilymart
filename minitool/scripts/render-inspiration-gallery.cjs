/* Render the 15 authored layouts with an isolated native-storage fixture.
 * This is visual QA output, not a product route or an automated aesthetic test.
 * HAMILY_PLAYWRIGHT=/absolute/playwright node minitool/scripts/render-inspiration-gallery.cjs
 * Optional HAMILY_GALLERY_DIST, HAMILY_GALLERY_OUTPUT, HAMILY_GALLERY_STYLE and HAMILY_GALLERY_BEDDING (mm).
 */
require('tsx/cjs');
const { INSPIRATION_LAYOUTS } = require('../../src/data/inspiration-layouts.ts');
const { createInitialState, addPlatform } = require('../../src/lib/assembly.ts');
const { applyInspirationLayout } = require('../../src/lib/inspiration.ts');
const { applyColorStyle, COLOR_STYLES } = require('../../src/lib/color-styles.ts');
const { createCatalogStyleHint } = require('../../src/lib/catalog-style.ts');
const { encodeConfig } = require('../../src/lib/config-code.ts');
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const source = path.resolve(process.env.HAMILY_GALLERY_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(process.env.HAMILY_GALLERY_OUTPUT || path.join(__dirname, '../../../artifacts/inspiration-gallery'));
const beddingDepth = Number(process.env.HAMILY_GALLERY_BEDDING || 0);
assert([0, 50, 100, 200, 300].includes(beddingDepth), "Unsupported bedding height");
const legHeight = Math.max(100, beddingDepth);
const styleIndex = Number(process.env.HAMILY_GALLERY_STYLE || 0);
assert(Number.isInteger(styleIndex) && COLOR_STYLES[styleIndex], 'Unknown gallery palette');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamily-inspiration-gallery-'));
const manifestPath = path.resolve(__dirname, '../generated/build-files.json');
const manifest = source === path.resolve(__dirname, '../dist') && fs.existsSync(manifestPath)
  ? new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).map(entry => entry.file)) : null;
fs.cpSync(source, root, { recursive: true, filter: file => fs.statSync(file).isDirectory() || !manifest || manifest.has(path.relative(source, file)) });
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const ASSEMBLY = 'hamilymart.assembly.v2', STYLE = 'hamilymart.catalog-style.v1';
const saved = new Map();
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function fixture(layout) {
  let state = { ...createInitialState(), legHeight, bedding: { mode: beddingDepth === 0 ? 'none' : beddingDepth === 50 ? 'thin' : 'thick', depth: beddingDepth } };
  for (let count = 1; count < layout.platformCount; count++) {
    const added = addPlatform(state); assert(added.ok); state = added.state;
  }
  const applied = applyInspirationLayout(applyColorStyle(state, styleIndex), styleIndex, layout.id);
  assert(applied.ok, `${layout.id}: ${applied.reason}`);
  const code = encodeConfig(applied.state);
  return { state: applied.state, hint: createCatalogStyleHint(styleIndex, code) };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = {
    status: 'running', recordedAt: new Date().toISOString(),
    purpose: 'Local Chrome screenshots of every authored layout, freshly hydrated at the default camera framing. Human visual review required.',
    palette: COLOR_STYLES[styleIndex].name, legHeight, beddingDepth,
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'app.js'))).digest('hex'),
    viewport: { width: 1280, height: 960, deviceScaleFactor: 1.5 }, layouts: [], errors: [],
  };
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.chromeVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1.5 });
    await context.exposeBinding('__galleryRead', (_source, { key }) => ({ data: saved.get(key) || null }));
    await context.exposeBinding('__galleryWrite', (_source, { key, data }) => { saved.set(key, data); });
    await context.addInitScript(() => {
      window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: {
        getStorage: options => window.__galleryRead(options), setStorage: options => window.__galleryWrite(options),
      } };
    });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const [index, layout] of INSPIRATION_LAYOUTS.entries()) {
      const data = fixture(layout);
      saved.set(ASSEMBLY, JSON.stringify(data.state));
      saved.set(STYLE, JSON.stringify(data.hint));
      if (index) await page.reload({ waitUntil: 'load' });
      else await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('.canvas-bottom-actions button')].find(node => node.textContent === '给点灵感');
        const canvas = document.querySelector('.scene-canvas canvas');
        return button && !button.disabled && canvas && canvas.width > 0 && !document.querySelector('.scene-loading, .scene-error, .scene-fallback');
      }, null, { timeout: 20000 });
      await page.waitForTimeout(700);
      assert.equal(JSON.parse(saved.get(STYLE)).configurationCode, data.hint.configurationCode, 'Hydration unexpectedly changed the authored layout');
      const image = `${layout.id}.png`;
      await page.locator('.studio').screenshot({ path: path.join(output, image) });
      report.layouts.push({ id: layout.id, name: layout.name, platformCount: layout.platformCount, itemCount: layout.items.length, pools: layout.poolPlatforms.length, openCovers: layout.openCovers ?? [], image });
      console.log(JSON.stringify({ id: layout.id, name: layout.name, screenshot: image }));
    }
    assert.equal(report.layouts.length, 15);
    assert.equal(report.errors.length, 0, `Browser errors: ${report.errors.join('; ')}`);
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HamilyMart 官方搭配视觉校验</title><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#f7f7f3;color:#315d47;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}h1{font-size:24px;margin:0 0 8px}p{font-size:13px;color:#6a7d6c;margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}figure{margin:0;background:white;border:1px solid #d5ddd1;border-radius:10px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{font-size:14px;padding:10px 12px;font-weight:600}figcaption small{display:block;color:#82937f;font-size:11px;margin-top:4px;font-weight:400}
      </style><h1>15 套官方搭配 · 视觉校验</h1><p>${escapeHtml(COLOR_STYLES[styleIndex].name)}配色 · ${legHeight / 10} cm 支撑腿 · ${beddingDepth / 10} cm 垫料 · 各排依次为 1 / 2 / 3 平台</p><div class="grid">${report.layouts.map(layout => `<figure><a href="${layout.image}"><img src="${layout.image}" alt="${escapeHtml(layout.name)}"></a><figcaption>${layout.id} · ${escapeHtml(layout.name)}<small>${layout.platformCount} 平台 · ${layout.itemCount} 组件${layout.pools ? ` · ${layout.pools} 泳池` : ''}${layout.openCovers.length ? ' · 1 个留洞' : ''}</small></figcaption></figure>`).join('')}</div></html>`;
    fs.writeFileSync(path.join(output, 'index.html'), html);
    const contact = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    await contact.goto(pathToFileURL(path.join(output, 'index.html')).href);
    await contact.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await contact.screenshot({ path: path.join(output, 'contact-sheet.png'), fullPage: true });
    report.contactSheet = path.join(output, 'contact-sheet.png');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    console.log(JSON.stringify({ status: report.status, gallery: path.join(output, 'index.html'), report: path.join(output, 'report.json') }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
