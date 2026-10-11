import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VISIBLE_PRODUCTS, getBaseParts } from '../src/data/catalog';
import { COLOR_STYLES, getBaseStyleColors, getProductStyleColors } from '../src/lib/color-styles';
import { getModelMaterialColor } from '../src/lib/model-colors';
import modelIndex from '../src/data/model-index.json';

const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
test('all five catalog image sets use current geometry and the same material colors as the live scene', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/thumbnails/style-manifest.json', import.meta.url), 'utf8'));
  for (const [index, style] of COLOR_STYLES.entries()) {
    for (const product of VISIBLE_PRODUCTS) {
      const record = manifest[style.id]?.[product.id];
      assert.ok(record, `${style.id}/${product.id} must have a rendered image`);
      const parts = product.id === 'pool' ? getBaseParts(100, true).filter(part => part.id === 'B01') : product.parts;
      const colors = product.id === 'pool' ? getBaseStyleColors(index) : getProductStyleColors(product.id, index);
      const expected = Object.fromEntries(parts.flatMap(part => modelIndex[part.id as keyof typeof modelIndex].components.map(component =>
        [component.id, getModelMaterialColor(part, component.id, component.colorKey, colors)])));
      assert.deepEqual(record.materialColors, expected, `${style.id}/${product.id}: outdated palette`);
      for (const part of parts) assert.equal(record.modelSha256[part.id], hash(readFileSync(new URL(`../public/models/${part.id}.glb`, import.meta.url))), `${style.id}/${product.id}: outdated geometry`);
      const png = readFileSync(new URL(`../public/thumbnails/${style.id}/${product.id}.png`, import.meta.url));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [480, 400]);
      assert.equal(hash(png), record.pngSha256);
    }
  }
  assert.equal(new Set(COLOR_STYLES.map(style => JSON.stringify(VISIBLE_PRODUCTS.map(product => manifest[style.id][product.id].pngSha256)))).size, 5, 'the five catalog palettes must render distinct image sets');
});
