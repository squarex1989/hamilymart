import { getProduct, type Rotation } from '../data/catalog';
import { getPlacements, getRoomFloorPlacementScore } from './assembly';
import type { AssemblyState, Placement } from './assembly';

/** Hole inserts may turn to clear a leg or basin, keeping the current turn when it fits. */
export function getInteractionPlacements(state: AssemblyState, productId: string, rotation: Rotation, itemId?: string): Placement[] {
  const floor = getProduct(productId).attachment === 'room-floor';
  if (!floor && getProduct(productId).attachment !== 'platform-hole') return getPlacements(state, productId, rotation, itemId);
  const targets = new Map<string, Placement>();
  const choices: Placement[] = [];
  for (const offset of [0, 90, 180, 270]) {
    const turn = ((rotation + offset) % 360) as Rotation;
    choices.push(...getPlacements(state, productId, turn, itemId));
  }
  if (floor) choices.sort((a,b)=>getRoomFloorPlacementScore(state,b)-getRoomFloorPlacementScore(state,a));
  for (const candidate of choices) {
    const key = `${candidate.parentId}:${candidate.x}:${candidate.y}:${candidate.z}`;
    if (!targets.has(key)) targets.set(key, candidate);
  }
  return [...targets.values()];
}
