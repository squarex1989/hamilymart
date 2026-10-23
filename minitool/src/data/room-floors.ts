import type { Bounds, Vec3 } from './catalog';

export interface RoomFloor {
  id: string;
  /** Actual room XY, floor level and lid underside; roof locating tabs do not reduce this height. */
  bounds: Bounds;
  entry: Vec3;
  /** Doorways between this room and the outside. */
  depth: number;
  obstacles?: Bounds[];
}
export const HOUSE_ROOM_FLOORS: Record<string, readonly RoomFloor[]> = {
  'milk-house-double': [
    { id:'inner', bounds:[5.2,5.2,0,98.4,194.8,96.6], entry:[100,50,0], depth:2 },
    { id:'entry', bounds:[101.6,5.2,0,194.8,194.8,96.6], entry:[198,150,0], depth:1 },
  ],
  'milk-house-double-2x3': [
    { id:'inner', bounds:[5.2,5.2,0,98.4,294.8,96.6], entry:[100,150,0], depth:2 },
    { id:'entry', bounds:[101.6,5.2,0,194.8,294.8,96.6], entry:[198,250,0], depth:1 },
  ],
  'milk-house-aite': [
    { id:'inner', bounds:[3.2,3.2,0,148.4,182.8,96.6], entry:[150,93,0], depth:2,
      obstacles:[[0,69.7,0,16.3,82.3,12.5],[0,169.7,0,16.3,182.3,12.5]] },
    { id:'entry', bounds:[151.6,3.2,0,296.8,182.8,96.6], entry:[250,0,0], depth:1,
      obstacles:[[283.7,69.7,0,300,82.3,12.5],[283.7,169.7,0,300,182.3,12.5]] },
  ],
};
