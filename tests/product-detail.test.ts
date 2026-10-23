import test from 'node:test';
import assert from 'node:assert/strict';
import { VISIBLE_PRODUCTS, getDefaultColors, getProduct } from '../src/data/catalog';
import { PRODUCT_INTROS } from '../src/data/product-details';
import { getProductDetail } from '../src/lib/product-detail';
import { createInitialState } from '../src/lib/assembly';

test('every selectable component has a short, specific introduction', () => {
  for (const id of ['base', 'cover', ...VISIBLE_PRODUCTS.map(p => p.id)]) {
    const text = PRODUCT_INTROS[id];
    assert.ok(text, id);
    assert.ok(text.length >= 20 && text.length <= 50, `${id}: ${text.length}`);
    assert.doesNotMatch(text, /无毒|不怕啃咬|绝对安全/);
  }
});
test('isolated details preserve colors and do not alter the design or include neighbors', () => {
  const state = createInitialState();
  const product = getProduct('pokemon-center');
  state.items = [{ id: 'selected', productId: product.id, parentId: 'base', x: 0, y: 0, z: 0, rotation: 180, colors: { ...getDefaultColors(product.id), PCW: 'rose', 'PCW-glass': 'sky' } }];
  const snapshot = JSON.stringify(state);
  const detail = getProductDetail(state, 'selected')!;
  assert.deepEqual(detail.parts, product.parts);
  assert.equal(detail.colors.PCW, 'rose');
  assert.equal(detail.colors['PCW-glass'], 'sky');
  detail.colors.PCW = 'white';
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(getProductDetail(state, null), null);
});
test('platform detail respects removed covers and selected leg height; pool and cover remain isolated', () => {
  const state = createInitialState();
  state.legHeight = 300; state.baseInsert = 'pool'; state.removedCovers = ['H02'];
  const detail = getProductDetail(state, 'base')!;
  assert.ok(detail.parts.some(p => p.id === 'Y01'));
  assert.ok(!detail.parts.some(p => ['H02', 'B01'].includes(p.id)));
  assert.deepEqual(getProductDetail(state, 'cover:base:H02')!.parts.map(p => p.id), ['H02']);
  assert.deepEqual(getProductDetail(state, 'pool:base')!.parts.map(p => p.id), ['B01']);
});

test('Pokemon glass stays blue in legacy colors and is never offered as an editable region', async () => {
  const { resolveLinkedProductColors, getEditableProductColorParts, setProductColor } = await import('../src/data/catalog');
  const { getProductStyleColors, COLOR_STYLES } = await import('../src/lib/color-styles');
  const legacy = { PCW: 'cream', PCR: 'red', 'PCW-glass': 'wood', 'PCR-glass': 'red' } as const;
  const resolved = resolveLinkedProductColors(legacy);
  assert.equal(resolved['PCW-glass'], 'sky'); assert.equal(resolved['PCR-glass'], 'sky');
  assert.equal(setProductColor(legacy, 'PCW-glass', 'black')['PCW-glass'], 'sky');
  assert.ok(!getEditableProductColorParts('pokemon-center').some(p => p.id.endsWith('-glass')));
  COLOR_STYLES.forEach((_, i) => {
    const colors = getProductStyleColors('pokemon-center', i);
    assert.equal(colors['PCW-glass'], 'sky'); assert.equal(colors['PCR-glass'], 'sky');
  });
});
