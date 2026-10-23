import type { Vec3 } from "./catalog";

export interface HouseDoorway { center: Vec3; normal: Vec3; depth: number }
/** Source wall cutouts, in source millimetres. Pokemon retains a 20 mm minimum landing; rear placements leave more front space. */
export const HOUSE_DOORWAYS: Record<string, readonly HouseDoorway[]> = {
  villa: [{ center: [145,181.1,110], normal: [0,-1,0], depth: 50 }, { center: [198,240,110], normal: [1,0,0], depth: 50 }],
  "roof-cottage": [{ center: [162,239,200], normal: [1,0,0], depth: 50 }],
  "l-house": [{ center: [50,2,0], normal: [0,-1,0], depth: 50 }, { center: [198,150,0], normal: [1,0,0], depth: 50 }],
  "cube-house": [{ center: [98,50,0], normal: [1,0,0], depth: 50 }],
  "milk-house-left": [{ center: [50,2,0], normal: [0,-1,0], depth: 50 }],
  "milk-house-right": [{ center: [150,2,0], normal: [0,-1,0], depth: 50 }],
  "milk-house-double": [{ center: [198,150,0], normal: [1,0,0], depth: 50 }],
  "milk-house-double-2x3": [{ center: [198, 250, 0], normal: [1,0,0], depth: 50 }],
  "milk-house-aite": [{ center: [250, 0, 0], normal: [0,-1,0], depth: 50 }],
  "pokemon-center": [{ center: [150,2,0], normal: [0,-1,0], depth: 20 }],
};
