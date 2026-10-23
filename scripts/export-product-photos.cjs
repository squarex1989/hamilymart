/* High-resolution authoring export; never included in the website or mini-tool bundle. */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const url = process.env.HAMILY_PHOTO_URL || 'http://localhost:5197/dev/product-photo-studio.html';
const output = path.resolve(process.env.HAMILY_PHOTO_OUTPUT || path.join(__dirname, '../../artifacts/HamilyMart商品图片_20261021'));
const assets = path.resolve(__dirname, '../../bambu-output/product-photos-20261021/models');
const only = new Set((process.env.HAMILY_PHOTO_ONLY || '').split(',').filter(Boolean));
const requestedModes = new Set((process.env.HAMILY_PHOTO_MODES || '').split(',').filter(Boolean));
const modes = [['preview', '01_组装预览'], ['dimensions', '02_长宽高标注'], ['exploded', '03_爆炸图'], ['exploded-reverse', '04_仰视爆炸图']];
const reportPath = path.join(output, '图片清单.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  await page.route('**/models/*.glb*', route => { const name = path.basename(new URL(route.request().url()).pathname); return route.fulfill({ path: path.join(assets, name), contentType: 'model/gltf-binary' }); });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  let report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : {
    resolution: [2400, 2400], format: 'PNG', background: 'white', palette: '圣诞礼物',
    dimensionConvention: '网站同款模型外包立方体长宽高，单位cm；不计垫料、笼子与爆炸间距。',
    structuralNote: '沿用小工具组装分组；宝可梦四件屋顶保持组装、整顶间隔44mm，其他间隔22mm；平台圆盖桌腿、帽子小屋、礼物盒装饰、楼梯、管道与底座、草丛插片及二层平台支柱保持各自组合。仅分开展示小工具允许分开的组件，整体单件不人为切开。',
    products: {},
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.productPhotoStudio, null, { timeout: 30000 });
    const definitions = await page.evaluate(() => window.productPhotoStudio.definitions);
    for (const [index, definition] of definitions.entries()) {
      if (only.size && !only.has(definition.id)) continue;
      const folder = `${String(index + 1).padStart(2, '0')}_${definition.name}${definition.kind === 'set' ? '_整套' : ''}`;
      fs.mkdirSync(path.join(output, folder), { recursive: true });
      const product = { ...definition, folder, images: { ...(report.products[definition.id]?.images || {}) } };
      for (const [mode, label] of modes) {
        if (requestedModes.size && !requestedModes.has(mode)) continue;
        const result = await page.evaluate(async ({ id, mode }) => window.productPhotoStudio.render(id, mode), { id: definition.id, mode });
        assert.equal(result.width, 2400); assert.equal(result.height, 2400);
        const png = Buffer.from(result.png.split(',')[1], 'base64');
        assert.equal(png.readUInt32BE(16), 2400); assert.equal(png.readUInt32BE(20), 2400);
        const relative = path.join(folder, `${definition.name}_${label}.png`);
        fs.writeFileSync(path.join(output, relative), png);
        delete result.png;
        product.images[mode] = { ...result, file: relative, bytes: png.length, sha256: hash(png) };
        console.log(JSON.stringify({ index: index + 1, product: definition.name, mode, bytes: png.length, pieces: result.pieces }));
      }
      report.products[definition.id] = product;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    }
    assert.equal(errors.length, 0, errors.join('; '));
    report.browserErrors = errors; report.exportedAt = new Date().toISOString(); report.expectedProductGroups = definitions.length;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, groups: Object.keys(report.products).length, expected: definitions.length, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
