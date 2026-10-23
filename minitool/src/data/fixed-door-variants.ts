/** Fixed front walls. Existing right-hand IDs and serialized catalog indices stay stable. */
export const FIXED_DOOR_PAIRS = [
  { right: 'milk-house-right', left: 'milk-house-left', body: 'MCRB', leftBody: 'MCLB', roof: 'MCRR', leftRoof: 'MCLR', axis: 0, span: 200 },
  { right: 'milk-house-double', left: 'milk-house-double-left', body: 'MCDB', leftBody: 'MCDLB', roof: 'MCDR', leftRoof: 'MCDR', axis: 1, span: 200 },
  { right: 'milk-house-double-2x3', left: 'milk-house-double-2x3-left', body: 'MC23B', leftBody: 'MC23LB', roof: 'MC23R', leftRoof: 'MC23R', axis: 1, span: 300 },
  { right: 'milk-house-aite', left: 'milk-house-aite-left', body: 'MCATB', leftBody: 'MCATLB', roof: 'MCATR', leftRoof: 'MCATR', axis: 0, span: 300 },
] as const;
export const fixedDoorPair = (id: string) => FIXED_DOOR_PAIRS.find(p => p.right === id || p.left === id);
export const supportsLegacyDoor = (id: string) => FIXED_DOOR_PAIRS.some(p => p.right === id);
