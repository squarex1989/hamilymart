import { hasReversiblePanel } from '../data/reversible-panels';
import { getBaseParts, getProduct, resolveLinkedProductColors } from '../data/catalog';
import type { ColorMap, ProductPart } from '../data/catalog';
import { getPlatforms } from './assembly';
import type { AssemblyState } from './assembly';
import { productIntroduction } from '../data/product-details';
import type { DoorSide } from './aite-panel';

export interface ProductDetail { id: string; title: string; parts: ProductPart[]; colors: ColorMap; introduction: string; doorSide?: DoorSide }
export function getProductDetail(state: AssemblyState, selectedId: string | null): ProductDetail | null {
  if (!selectedId) return null;
  const item = state.items.find(item => item.id === selectedId);
  if (item) {
    const product = getProduct(item.productId);
    return { id: product.id, title: product.name, parts: product.parts, colors: resolveLinkedProductColors(item.colors), introduction: productIntroduction(product.id),
      ...(hasReversiblePanel(product.id) ? { doorSide: item.doorSide ?? 'right' } : {}) };
  }
  const [kind, parent, cover] = selectedId.split(':');
  const platform = getPlatforms(state).find(p => p.id === (parent || selectedId));
  if (!platform) return null;
  const id = kind === 'cover' ? 'cover' : kind === 'pool' ? 'pool' : 'base';
  const parts = id === 'cover' ? getBaseParts(0).filter(p => p.id === cover)
    : id === 'pool' ? getBaseParts(0, 'pool').filter(p => p.id === 'B01')
    : getBaseParts(platform.legHeight, platform.baseInsert, platform.removedCovers).filter(p => p.id !== 'B01');
  return { id, title: id === 'cover' ? `连通孔 ${Number(cover.slice(-1))}` : id === 'pool' ? '圆形泳池' : '基础平台',
    parts, colors: resolveLinkedProductColors(platform.baseColors), introduction: productIntroduction(id) };
}
