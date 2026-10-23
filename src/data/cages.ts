export interface CageSize { presetId: string | null; width: number; depth: number; height: number }
export const CAGE_PRESETS = [
  ['carno-tv-73', '卡诺大电视 · 73', 73.5, 48, 53],
  ['carno-cheese-80', '卡诺芝士笼 · 80', 80, 50, 50],
  ['carno-cheese-100', '卡诺芝士笼 · 100', 100, 50, 50],
  ['buca-cube-80', '布卡星魔方笼 · 80', 80, 44.7, 50.6],
  ['buca-cube-100', '布卡星魔方笼 · 100', 100, 50, 52.5],
  ['buca-cube-120', '布卡星魔方笼 · 120', 120, 60, 62.5],
  ['buca-bag-50', '布卡星小书包 · 50', 50, 32, 32],
  ['buca-bag-65', '布卡星大书包 · 65', 65, 37, 37],
  ['buca-bag-70', '布卡星大书包 · 70', 70, 42.5, 47],
  ['buca-star-70', '布卡星星空 · 70', 70, 42.5, 44.5],
  ['niteangel-stack-80', '艾特叠叠乐 · 80', 80, 45, 50],
  ['tafit-crystal-62', '它适水晶笼 · 62', 59, 37, 35],
  ['tafit-crystal-66', '它适水晶笼 · 66', 62, 39.5, 37.5],
  ['tafit-crystal-75', '它适水晶笼 · 75', 71, 42.5, 40.6],
  ['tafit-crystal-88', '它适水晶笼 · 88', 88.6, 50, 44],
  ['tafit-bubble-62', '它适泡泡城堡 · 62', 59.5, 40, 35.5],
].map(([id, name, width, depth, height]) => ({ id: id as string, name: name as string, width: width as number, depth: depth as number, height: height as number }));
export function normalizeCage(value: unknown): CageSize | null {
  if (value == null) return null;
  const cage = value as CageSize;
  if (![cage.width, cage.depth, cage.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 500)) throw new Error('笼子内径需大于 0 且不超过 500 cm');
  const preset = CAGE_PRESETS.find(p => p.id === cage.presetId && p.width === cage.width && p.depth === cage.depth && p.height === cage.height);
  return { presetId: preset?.id ?? null, width: cage.width, depth: cage.depth, height: cage.height };
}

export const DEFAULT_CAGE: CageSize = { presetId: "buca-cube-120", width: 120, depth: 60, height: 62.5 };
