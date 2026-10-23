/** Authored magnetic placements. Coordinates use the 10 cm leg datum. */
export interface InspirationPlacement {
  key: string;
  productId: string;
  parentKey?: string;
  platform: 0 | 1 | 2 | 3;
  position: readonly [number, number, number];
  rotation: 0 | 90 | 180 | 270;
}
export interface InspirationLayout {
  id: string;
  name: string;
  platformCount: 1 | 2 | 3 | 4;
  /** At most one pool per layout; a villa uses the pool on its own platform. */
  poolPlatforms: readonly (0 | 1 | 2 | 3)[];
  openCovers?: readonly { platform: 0 | 1 | 2 | 3; coverId: "H01" | "H02" | "H03" | "H04" | "H05" }[];
  items: readonly InspirationPlacement[];
}

/** Each platform count has five layouts, audited against real model footprints and doors. */
export const INSPIRATION_LAYOUTS: readonly InspirationLayout[] = [
  {
    id: "1A", name: "双层小别墅", platformCount: 1,
    poolPlatforms: [0], openCovers: [],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [50, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "1B", name: "转角叠叠屋", platformCount: 1,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [100, 200, 110], rotation: 0 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 200], rotation: 0, parentKey: "p1-corner" },
      { key: "p1-seesaw", productId: "seesaw", platform: 0, position: [150, 100, 110], rotation: 270 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 150, 110], rotation: 90 },
    ],
  },
  {
    id: "1C", name: "奶糖小庭院", platformCount: 1,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-double", productId: "milk-house-double", platform: 0, position: [100, 200, 110], rotation: 270 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 210], rotation: 270, parentKey: "p1-double" },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [141.5, 166, 210], rotation: 0, parentKey: "p1-double" },
      { key: "p1-stairs", productId: "stairs-left-1", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "1D", name: "方糖探险站", platformCount: 1,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [150, 50, 110], rotation: 0 },
      { key: "p1-straight", productId: "pipe-st1", platform: 0, position: [50, 150, 110], rotation: 90 },
      { key: "p1-side", productId: "pipe-st2", platform: 0, position: [150, 250, 110], rotation: 0 },
      { key: "p1-elbow", productId: "pipe-lt2n", platform: 0, position: [50, 250, 110], rotation: 90 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 150, 110], rotation: 90 },
    ],
  },
  {
    id: "1E", name: "宝可梦迎宾屋", platformCount: 1,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-center", productId: "pokemon-center", platform: 0, position: [150, 200, 110], rotation: 0 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [150, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "2A", name: "错层生活街", platformCount: 2,
    poolPlatforms: [1], openCovers: [],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [100, 200, 110], rotation: 0 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 200], rotation: 0, parentKey: "p1-corner" },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [290, 90, 110], rotation: 0 },
      { key: "p2-villa", productId: "villa", platform: 1, position: [450, 190, 110], rotation: 0 },
      { key: "p2-planter", productId: "planter", platform: 1, position: [580.5, 264, 200], rotation: 0, parentKey: "p2-villa" },
      { key: "p1-seesaw", productId: "seesaw", platform: 0, position: [150, 100, 110], rotation: 270 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 250, 110], rotation: 180 },
    ],
  },
  {
    id: "2B", name: "庭院度假村", platformCount: 2,
    poolPlatforms: [0], openCovers: [{"platform": 1, "coverId": "H05"}],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p2-cube", productId: "cube-house", platform: 1, position: [550, 250, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 110, 110], rotation: 270 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "2C", name: "宝可梦穿梭站", platformCount: 2,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-center", productId: "pokemon-center", platform: 0, position: [150, 200, 110], rotation: 0 },
      { key: "p2-straight", productId: "pipe-lt2n", platform: 1, position: [350, 250, 110], rotation: 90 },
      { key: "p2-tee", productId: "pipe-tt1", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-side", productId: "pipe-st2", platform: 1, position: [550, 150, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 50, 110], rotation: 0 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [150, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "2D", name: "奶糖天桥街", platformCount: 2,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-left", productId: "milk-house-right", platform: 0, position: [100, 250, 110], rotation: 0 },
      { key: "p2-right", productId: "milk-house-right", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p1-bridge", productId: "sag-bridge", platform: 0, position: [250, 250, 210], rotation: 0, parentKey: "p1-left" },
      { key: "p1-stairs", productId: "stairs-right-1", platform: 0, position: [50, 150, 110], rotation: 90 },
      { key: "p2-stairs", productId: "stairs-left-1", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 90, 110], rotation: 180 },
      { key: "p2-down", productId: "pipe-down", platform: 1, position: [450, 250, 110], rotation: 180 },
    ],
  },
  {
    id: "2E", name: "水岸探索", platformCount: 2,
    poolPlatforms: [0], openCovers: [],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [250, 50, 110], rotation: 0 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 190, 110], rotation: 90 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [90, 210, 110], rotation: 90 },
      { key: "p2-straight-left", productId: "pipe-st1", platform: 1, position: [350, 250, 110], rotation: 0 },
      { key: "p2-straight-middle", productId: "pipe-st1", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2n", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 150, 110], rotation: 0 },
      { key: "p2-down", productId: "pipe-down", platform: 1, position: [550, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "3A", name: "宝可梦度假街", platformCount: 3,
    poolPlatforms: [0], openCovers: [{"platform": 1, "coverId": "H05"}],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 110, 110], rotation: 270 },
      { key: "p3-center", productId: "pokemon-center", platform: 2, position: [750, 200, 110], rotation: 0 },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [750, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "3B", name: "中央花园街", platformCount: 3,
    poolPlatforms: [0], openCovers: [],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p2-planter-left", productId: "planter", platform: 1, position: [510, 110, 110], rotation: 0 },
      { key: "p2-planter-right", productId: "planter", platform: 1, position: [510, 210, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [410, 210, 110], rotation: 0 },
      { key: "p3-corner", productId: "l-house", platform: 2, position: [800, 200, 110], rotation: 270 },
      { key: "p3-cube", productId: "cube-house", platform: 2, position: [850, 250, 200], rotation: 270, parentKey: "p3-corner" },
      { key: "p3-seesaw", productId: "seesaw", platform: 2, position: [750, 100, 110], rotation: 270 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "3C", name: "三分区冒险城", platformCount: 3,
    poolPlatforms: [2], openCovers: [{"platform": 1, "coverId": "H05"}],
    items: [
      { key: "p1-corner", productId: "milk-house-double", platform: 0, position: [100, 200, 110], rotation: 270 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 210], rotation: 270, parentKey: "p1-corner" },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [450, 150, 110], rotation: 90 },
      { key: "p2-tee", productId: "pipe-tt2", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2n", platform: 1, position: [350, 250, 110], rotation: 90 },
      { key: "p2-side", productId: "pipe-st2", platform: 1, position: [350, 150, 110], rotation: 270 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [840, 168, 110], rotation: 270 },
      { key: "p3-planter", productId: "planter", platform: 2, position: [610, 210, 110], rotation: 0 },
      { key: "p1-stairs", productId: "stairs-left-1", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [850, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "3D", name: "奶糖花园镇", platformCount: 3,
    poolPlatforms: [1], openCovers: [{"platform": 1, "coverId": "H05"}],
    items: [
      { key: "p1-milk", productId: "milk-house-left", platform: 0, position: [100, 250, 110], rotation: 0 },
      { key: "p1-stairs", productId: "stairs-left-1", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [290, 90, 110], rotation: 180 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [500, 250, 110], rotation: 0 },
      { key: "p2-planter", productId: "planter", platform: 1, position: [390, 210, 110], rotation: 180 },
      { key: "p3-milk", productId: "milk-house-right", platform: 2, position: [700, 250, 110], rotation: 0 },
      { key: "p3-stairs", productId: "stairs-right-1", platform: 2, position: [650, 150, 110], rotation: 90 },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [850, 250, 110], rotation: 180 },
    ],
  },
  {
    id: "3E", name: "环游管道城", platformCount: 3,
    poolPlatforms: [2], openCovers: [{"platform": 1, "coverId": "H05"}],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 50, 110], rotation: 0 },
      { key: "p1-straight", productId: "pipe-st1", platform: 0, position: [150, 250, 110], rotation: 0 },
      { key: "p1-side", productId: "pipe-st2", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-elbow", productId: "pipe-lt2n", platform: 0, position: [50, 250, 110], rotation: 90 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 90, 110], rotation: 180 },
      { key: "p2-tee", productId: "pipe-tt1", platform: 1, position: [350, 250, 110], rotation: 0 },
      { key: "p2-top-tee", productId: "pipe-tt2", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2", platform: 1, position: [450, 50, 110], rotation: 270 },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [450, 150, 110], rotation: 270 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [840, 168, 110], rotation: 270 },
      { key: "p3-planter", productId: "planter", platform: 2, position: [610, 210, 110], rotation: 0 },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [850, 50, 110], rotation: 90 },
    ],
  },
  {
    id: "4A", name: "宝可梦迎宾街", platformCount: 4,
    poolPlatforms: [3], openCovers: [],
    items: [
      { key: "p1-center", productId: "pokemon-center", platform: 0, position: [150, 200, 110], rotation: 0 },
      { key: "p2-left", productId: "milk-house-right", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p3-right", productId: "milk-house-right", platform: 2, position: [700, 250, 110], rotation: 0 },
      { key: "p2-bridge", productId: "sag-bridge", platform: 1, position: [550, 250, 210], rotation: 0, parentKey: "p2-left" },
      { key: "p2-stairs", productId: "stairs-right-1", platform: 1, position: [350, 150, 110], rotation: 90 },
      { key: "p3-stairs", productId: "stairs-left-1", platform: 2, position: [850, 250, 110], rotation: 0 },
      { key: "p3-bowl", productId: "food-bowl", platform: 2, position: [810, 90, 110], rotation: 180 },
      { key: "p4-hat", productId: "roof-cottage", platform: 3, position: [1140, 168, 110], rotation: 270 },
      { key: "p4-planter", productId: "planter", platform: 3, position: [990, 210, 110], rotation: 90 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [150, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "4B", name: "奶糖连桥镇", platformCount: 4,
    poolPlatforms: [3], openCovers: [],
    items: [
      { key: "p1-left", productId: "milk-house-right", platform: 0, position: [100, 250, 110], rotation: 0 },
      { key: "p2-right", productId: "milk-house-right", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p1-bridge", productId: "sag-bridge", platform: 0, position: [250, 250, 210], rotation: 0, parentKey: "p1-left" },
      { key: "p1-stairs", productId: "stairs-right-1", platform: 0, position: [50, 150, 110], rotation: 90 },
      { key: "p2-stairs", productId: "stairs-left-1", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 90, 110], rotation: 180 },
      { key: "p3-center", productId: "pokemon-center", platform: 2, position: [750, 200, 110], rotation: 0 },
      { key: "p4-villa", productId: "villa", platform: 3, position: [1050, 190, 110], rotation: 0 },
      { key: "p4-hat", productId: "roof-cottage", platform: 3, position: [978, 239, 200], rotation: 0, parentKey: "p4-villa" },
      { key: "p4-planter", productId: "planter", platform: 3, position: [1180.5, 264, 200], rotation: 0, parentKey: "p4-villa" },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [750, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "4C", name: "层层游乐街", platformCount: 4,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-corner", productId: "milk-house-double", platform: 0, position: [100, 200, 110], rotation: 270 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 210], rotation: 270, parentKey: "p1-corner" },
      { key: "p1-stairs", productId: "stairs-left-1", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p2-double", productId: "milk-house-double", platform: 1, position: [400, 200, 110], rotation: 270 },
      { key: "p2-stairs", productId: "stairs-straight-1", platform: 1, position: [550, 150, 110], rotation: 90 },
      { key: "p3-milk", productId: "milk-house-left", platform: 2, position: [700, 250, 110], rotation: 0 },
      { key: "p3-stairs", productId: "stairs-left-1", platform: 2, position: [850, 250, 110], rotation: 0 },
      { key: "p3-bowl", productId: "food-bowl", platform: 2, position: [890, 90, 110], rotation: 0 },
      { key: "p4-center", productId: "pokemon-center", platform: 3, position: [1050, 200, 110], rotation: 0 },
      { key: "p4-down", productId: "pipe-down", platform: 3, position: [1050, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "4D", name: "云端奶糖巷", platformCount: 4,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-milk", productId: "milk-house-left", platform: 0, position: [100, 250, 110], rotation: 0 },
      { key: "p1-stairs", productId: "stairs-left-1", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-down", productId: "pipe-down", platform: 0, position: [250, 50, 110], rotation: 90 },
      { key: "p2-milk", productId: "milk-house-left", platform: 1, position: [450, 200, 110], rotation: 90 },
      { key: "p2-stairs", productId: "stairs-right-1", platform: 1, position: [350, 150, 110], rotation: 0 },
      { key: "p3-double", productId: "milk-house-double", platform: 2, position: [700, 200, 110], rotation: 270 },
      { key: "p3-stairs", productId: "stairs-left-1", platform: 2, position: [850, 150, 110], rotation: 0 },
      { key: "p4-center", productId: "pokemon-center", platform: 3, position: [1050, 200, 110], rotation: 0 },
    ],
  },
  {
    id: "4E", name: "环游宝可梦城", platformCount: 4,
    poolPlatforms: [], openCovers: [],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 50, 110], rotation: 0 },
      { key: "p1-straight", productId: "pipe-st1", platform: 0, position: [150, 250, 110], rotation: 0 },
      { key: "p1-side", productId: "pipe-st2", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-elbow", productId: "pipe-lt2n", platform: 0, position: [50, 250, 110], rotation: 90 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 90, 110], rotation: 180 },
      { key: "p2-tee", productId: "pipe-tt1", platform: 1, position: [350, 250, 110], rotation: 0 },
      { key: "p2-top-tee", productId: "pipe-tt2", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2", platform: 1, position: [450, 50, 110], rotation: 270 },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [450, 150, 110], rotation: 270 },
      { key: "p3-center", productId: "pokemon-center", platform: 2, position: [750, 200, 110], rotation: 0 },
      { key: "p4-double", productId: "milk-house-double", platform: 3, position: [1000, 200, 110], rotation: 270 },
      { key: "p4-stairs", productId: "stairs-left-1", platform: 3, position: [1150, 250, 110], rotation: 0 },
      { key: "p3-down", productId: "pipe-down", platform: 2, position: [750, 250, 110], rotation: 0 },
    ],
  },
];
