/** Source-space 180° turn of the removable front plate; exterior walls stay put. */
export const REVERSIBLE_PANELS: Record<string, { partId: string; translation: [number, number, number]; mirrorAxis: 0 | 1; span: number }> = {
  'milk-house-right': { partId: 'MCRP', translation: [200, 15.8, 0], mirrorAxis: 0, span: 200 },
  'milk-house-double': { partId: 'MCDP', translation: [384.2, 200, 0], mirrorAxis: 1, span: 200 },
  'milk-house-double-2x3': { partId: 'MC23P', translation: [384.2, 300, 0], mirrorAxis: 1, span: 300 },
  'milk-house-aite': { partId: 'MCATP', translation: [300, 11.8, 0], mirrorAxis: 0, span: 300 },
};
export const PANEL_COLOR_LEADERS: Record<string, string> = { MCRP: 'MCRB', MCDP: 'MCDB', MC23P: 'MC23B' };
/** Retained for historical model transforms; current houses have fixed walls. */
export function hasReversiblePanel(_productId: string): boolean { return false; }
