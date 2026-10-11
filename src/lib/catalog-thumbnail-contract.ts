import { COLORS, getBaseParts, getProduct } from '../data/catalog';
import modelIndex from '../data/model-index.json';
import { getBaseStyleColors, getProductStyleColors } from './color-styles';
import { getModelMaterialColor } from './model-colors';

/** Shared input manifest for rendering and validating the exported PNGs. */
export function getThumbnailDefinition(productId: string, styleIndex: number) {
  const parts = productId === 'pool'
    ? getBaseParts(100, true).filter(part => part.id === 'B01')
    : getProduct(productId).parts;
  const colors = productId === 'pool' ? getBaseStyleColors(styleIndex) : getProductStyleColors(productId, styleIndex);
  const materialColors = Object.fromEntries(parts.flatMap(part =>
    modelIndex[part.id as keyof typeof modelIndex].components.map(component =>
      [component.id, getModelMaterialColor(part, component.id, component.colorKey, colors)])));
  const materialHexColors = Object.fromEntries(Object.entries(materialColors).map(([part, id]) =>
    [part, COLORS.find(color => color.id === id)!.hex]));
  return { parts, colors, materialColors, materialHexColors };
}
