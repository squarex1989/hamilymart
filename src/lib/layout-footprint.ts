import { getPlatforms, getVisualItemBounds } from './assembly';
import type { AssemblyState } from './assembly';

/** Keep loose components in the scene envelope after their supporting platform is removed. */
export function getLayoutFootprint(state: AssemblyState) {
  const rectangles = getPlatforms(state).map(p => [p.x, p.y, p.x + 300, p.y + 300]);
  const items = new Map(state.items.map(item => [item.id, item]));
  for (const item of state.items) {
    let parent = item.parentId;
    const visited = new Set<string>();
    while (items.has(parent) && !visited.has(parent)) { visited.add(parent); parent = items.get(parent)!.parentId; }
    if (parent !== 'ground') continue;
    for (const b of getVisualItemBounds(item)) rectangles.push([b[0], b[1], b[3], b[4]]);
  }
  if (!rectangles.length) rectangles.push([0, 0, 300, 300]);
  return {
    minX: Math.min(...rectangles.map(b => b[0])), minY: Math.min(...rectangles.map(b => b[1])),
    maxX: Math.max(...rectangles.map(b => b[2])), maxY: Math.max(...rectangles.map(b => b[3])),
  };
}
