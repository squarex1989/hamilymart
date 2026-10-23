/* Local offline UI check; the xhs-shaped storage is isolated from real user data. */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist');
const output = path.resolve(__dirname, '../../../artifacts');
const ASSEMBLY = 'hamilymart.assembly.v2';
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const saved = new Map([[ASSEMBLY, JSON.stringify(seed)], ['hamilymart.onboarding.v1','true']]);
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'");
  res.end(fs.readFileSync(file));
});
const state = () => JSON.parse(saved.get(ASSEMBLY));
async function ready(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    return canvas && canvas.width > 0 && !document.querySelector('.scene-loading, .scene-error, .scene-fallback') && [...document.querySelectorAll('.canvas-bottom-actions button')].some(b => b.textContent === '给点灵感' && !b.disabled);
  }, null, { timeout: 30000 });
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = { status: 'running', scope: 'Local Chrome offline UI integration; not Xiaohongshu simulator or phone acceptance', errors: [], checks: [], screenshots: {} };
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.exposeBinding('__trayRead', (_source, { key }) => ({ data: saved.get(key) || null }));
    await context.exposeBinding('__trayWrite', (_source, { key, data }) => { saved.set(key, data); });
    await context.addInitScript(() => {
      window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: { getStorage: options => window.__trayRead(options), setStorage: options => window.__trayWrite(options) } };
      addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('--safe-area-inset-top', '44px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', '34px');
      });
    });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) report.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await ready(page);
    await page.getByRole('button', { name: '小屋', exact: true }).click();
    const cards=page.locator('.mobile-product');
    const names=await cards.allTextContents();
    assert.equal(names.filter(n=>n.includes('奶糖')&&n.includes('开门')).length,8);
    const card=cards.filter({hasText:'奶糖小屋（左开门）'});assert.equal(await card.count(),1);await card.click();
    await page.waitForFunction(()=>document.querySelector('.mobile-dock-header strong')?.textContent==='奶糖小屋（左开门）');
    await page.getByRole('button',{name:'详情',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'奶糖小屋（左开门）',exact:true});await dialog.waitFor();
    await page.waitForFunction(()=>document.querySelector('.product-detail-canvas canvas')?.width>0&&!document.querySelector('.product-detail-status'));
    assert.equal(await dialog.locator('.scene-dimension-label:not([hidden])').count(),3);
    await page.screenshot({path:path.join(output,'fixed-door-platform64-ui.png')});
    report.checks.push('8 fixed-door milk variants; left house placement and standalone 3D dimensions load offline');
    await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await page.waitForTimeout(700);const placed=state();assert(placed.items.some(i=>i.productId==='milk-house-left'));
    await page.reload({waitUntil:'load'});await ready(page);assert.deepEqual(state(),placed);
    report.checks.push('native-shaped draft storage reload preserves fixed left-door house');
    assert.equal(report.errors.length, 0, report.errors.join('; '));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(output, 'fixed-door-platform64-ui-failure.png') }).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(output, 'fixed-door-platform64-ui-validation.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
