/** Authored magnetic placements. Coordinates are assembly mm at the 10cm-leg datum;
 * the renderer applies the user's current leg/bedding elevation independently.
 * Pools occupy platform inserts, not AssemblyItem entries. */
export interface InspirationPlacement {
  key: string;
  productId: string;
  parentKey?: string;
  platform: 0 | 1 | 2;
  position: readonly [number, number, number];
  rotation: 0 | 90 | 180 | 270;
}
export interface InspirationLayout {
  id: string;
  name: string;
  platformCount: 1 | 2 | 3;
  poolPlatforms: readonly (0 | 1 | 2)[];
  /** At most one unobstructed opening across the design. */
  openCovers?: readonly { platform: 0 | 1 | 2; coverId: "H01" | "H02" | "H03" | "H04" | "H05" }[];
  items: readonly InspirationPlacement[];
}

/** Audited footprints and 60 × 50 mm entrance landings. Pipe zones stay connected. */
export const INSPIRATION_LAYOUTS: readonly InspirationLayout[] = [
  {
    id: "1A", name: "双层小别墅", platformCount: 1,
    poolPlatforms: [],
    openCovers: [],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
    ],
  },
  {
    id: "1B", name: "转角叠叠屋", platformCount: 1,
    poolPlatforms: [],
    openCovers: [],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [200, 200, 110], rotation: 270 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [250, 250, 195.6], rotation: 180, parentKey: "p1-corner" },
      { key: "p1-seesaw", productId: "seesaw", platform: 0, position: [150, 100, 110], rotation: 270 },
    ],
  },
  {
    id: "1C", name: "帽子小庭院", platformCount: 1,
    poolPlatforms: [],
    openCovers: [{"platform":0,"coverId":"H05"}],
    items: [
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [240, 222, 110], rotation: 270 },
      { key: "p1-seesaw", productId: "seesaw", platform: 0, position: [50, 100, 110], rotation: 270 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [190, 90, 110], rotation: 180 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [90, 210, 110], rotation: 270 },
    ],
  },
  {
    id: "1D", name: "方糖探险站", platformCount: 1,
    poolPlatforms: [],
    openCovers: [],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [250, 150, 110], rotation: 270 },
      { key: "p1-straight", productId: "pipe-st1", platform: 0, position: [50, 150, 110], rotation: 90 },
      { key: "p1-side", productId: "pipe-st2", platform: 0, position: [150, 250, 110], rotation: 0 },
      { key: "p1-elbow", productId: "pipe-lt2n", platform: 0, position: [50, 250, 110], rotation: 90 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [110, 110, 110], rotation: 180 },
    ],
  },
  {
    id: "1E", name: "口袋度假屋", platformCount: 1,
    poolPlatforms: [0],
    openCovers: [],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 110], rotation: 0 },
      { key: "p1-seesaw", productId: "seesaw", platform: 0, position: [250, 100, 110], rotation: 270 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [190, 210, 110], rotation: 90 },
    ],
  },
  {
    id: "2A", name: "错层生活街", platformCount: 2,
    poolPlatforms: [],
    openCovers: [],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [200, 200, 110], rotation: 270 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [250, 250, 195.6], rotation: 180, parentKey: "p1-corner" },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [90, 110, 110], rotation: 270 },
      { key: "p2-villa", productId: "villa", platform: 1, position: [450, 190, 110], rotation: 0 },
      { key: "p2-planter", productId: "planter", platform: 1, position: [580.5, 264, 200], rotation: 0, parentKey: "p2-villa" },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 50, 110], rotation: 0 },
    ],
  },
  {
    id: "2B", name: "庭院度假村", platformCount: 2,
    poolPlatforms: [1],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p2-cube", productId: "cube-house", platform: 1, position: [550, 250, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 110, 110], rotation: 270 },
    ],
  },
  {
    id: "2C", name: "双区穿梭站", platformCount: 2,
    poolPlatforms: [],
    openCovers: [{"platform":0,"coverId":"H05"}],
    items: [
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [60, 222, 110], rotation: 270 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [210, 210, 110], rotation: 270 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 110, 110], rotation: 270 },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [350, 250, 110], rotation: 0 },
      { key: "p2-tee", productId: "pipe-tt1", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-side", productId: "pipe-st2", platform: 1, position: [550, 150, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 50, 110], rotation: 0 },
    ],
  },
  {
    id: "2D", name: "转角小院", platformCount: 2,
    poolPlatforms: [],
    openCovers: [{"platform":0,"coverId":"H04"}],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [100, 200, 110], rotation: 0 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [190, 110, 110], rotation: 0 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [290, 90, 110], rotation: 90 },
      { key: "p2-hat", productId: "roof-cottage", platform: 1, position: [432, 140, 110], rotation: 0 },
      { key: "p2-cube", productId: "cube-house", platform: 1, position: [550, 250, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 250, 110], rotation: 0 },
    ],
  },
  {
    id: "2E", name: "水岸探索", platformCount: 2,
    poolPlatforms: [0],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [250, 50, 110], rotation: 0 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 190, 110], rotation: 90 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [90, 210, 110], rotation: 90 },
      { key: "p2-straight-left", productId: "pipe-st1", platform: 1, position: [350, 250, 110], rotation: 180 },
      { key: "p2-straight-middle", productId: "pipe-st1", platform: 1, position: [450, 250, 110], rotation: 180 },
      { key: "p2-elbow", productId: "pipe-lt2n", platform: 1, position: [550, 250, 110], rotation: 0 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 150, 110], rotation: 0 },
    ],
  },
  {
    id: "3A", name: "双塔小镇", platformCount: 3,
    poolPlatforms: [1],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [150, 190, 110], rotation: 0 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [78, 239, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [280.5, 264, 200], rotation: 0, parentKey: "p1-villa" },
      { key: "p2-cube", productId: "cube-house", platform: 1, position: [550, 250, 110], rotation: 270 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [400, 250, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [510, 110, 110], rotation: 270 },
      { key: "p3-villa", productId: "villa", platform: 2, position: [750, 190, 110], rotation: 0 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [678, 239, 200], rotation: 0, parentKey: "p3-villa" },
      { key: "p3-planter", productId: "planter", platform: 2, position: [880.5, 264, 200], rotation: 0, parentKey: "p3-villa" },
    ],
  },
  {
    id: "3B", name: "中央花园街", platformCount: 3,
    poolPlatforms: [1],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-villa", productId: "villa", platform: 0, position: [110, 150, 110], rotation: 270 },
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [159, 222, 200], rotation: 270, parentKey: "p1-villa" },
      { key: "p1-planter", productId: "planter", platform: 0, position: [184, 19.5, 200], rotation: 270, parentKey: "p1-villa" },
      { key: "p2-planter-left", productId: "planter", platform: 1, position: [310, 210, 110], rotation: 0 },
      { key: "p2-planter-right", productId: "planter", platform: 1, position: [510, 210, 110], rotation: 0 },
      { key: "p2-bowl", productId: "food-bowl", platform: 1, position: [410, 210, 110], rotation: 0 },
      { key: "p3-corner", productId: "l-house", platform: 2, position: [800, 200, 110], rotation: 270 },
      { key: "p3-cube", productId: "cube-house", platform: 2, position: [850, 250, 195.6], rotation: 180, parentKey: "p3-corner" },
      { key: "p3-seesaw", productId: "seesaw", platform: 2, position: [750, 100, 110], rotation: 270 },
    ],
  },
  {
    id: "3C", name: "三分区冒险城", platformCount: 3,
    poolPlatforms: [2],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-corner", productId: "l-house", platform: 0, position: [100, 200, 110], rotation: 0 },
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 250, 195.6], rotation: 0, parentKey: "p1-corner" },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 90, 110], rotation: 0 },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [450, 150, 110], rotation: 90 },
      { key: "p2-tee", productId: "pipe-tt2", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2n", platform: 1, position: [350, 250, 110], rotation: 90 },
      { key: "p2-side", productId: "pipe-st2", platform: 1, position: [350, 150, 110], rotation: 270 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [712, 240, 110], rotation: 0 },
      { key: "p3-seesaw", productId: "seesaw", platform: 2, position: [850, 100, 110], rotation: 270 },
      { key: "p3-planter", productId: "planter", platform: 2, position: [610, 210, 110], rotation: 0 },
    ],
  },
  {
    id: "3D", name: "帽子花园镇", platformCount: 3,
    poolPlatforms: [1],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-hat", productId: "roof-cottage", platform: 0, position: [60, 168, 110], rotation: 270 },
      { key: "p1-planter", productId: "planter", platform: 0, position: [210, 210, 110], rotation: 90 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [290, 110, 110], rotation: 90 },
      { key: "p2-seesaw", productId: "seesaw", platform: 1, position: [500, 250, 110], rotation: 0 },
      { key: "p2-planter", productId: "planter", platform: 1, position: [310, 210, 110], rotation: 180 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [660, 222, 110], rotation: 270 },
      { key: "p3-cube", productId: "cube-house", platform: 2, position: [850, 250, 110], rotation: 270 },
      { key: "p3-planter", productId: "planter", platform: 2, position: [810, 110, 110], rotation: 270 },
    ],
  },
  {
    id: "3E", name: "环游管道城", platformCount: 3,
    poolPlatforms: [2],
    openCovers: [{"platform":1,"coverId":"H05"}],
    items: [
      { key: "p1-cube", productId: "cube-house", platform: 0, position: [50, 50, 110], rotation: 0 },
      { key: "p1-straight", productId: "pipe-st1", platform: 0, position: [150, 250, 110], rotation: 180 },
      { key: "p1-side", productId: "pipe-st2", platform: 0, position: [250, 250, 110], rotation: 0 },
      { key: "p1-elbow", productId: "pipe-lt2n", platform: 0, position: [50, 250, 110], rotation: 90 },
      { key: "p1-bowl", productId: "food-bowl", platform: 0, position: [210, 90, 110], rotation: 180 },
      { key: "p2-tee", productId: "pipe-tt1", platform: 1, position: [350, 250, 110], rotation: 0 },
      { key: "p2-top-tee", productId: "pipe-tt2", platform: 1, position: [450, 250, 110], rotation: 0 },
      { key: "p2-elbow", productId: "pipe-lt2", platform: 1, position: [450, 50, 110], rotation: 270 },
      { key: "p2-straight", productId: "pipe-st1", platform: 1, position: [450, 150, 110], rotation: 270 },
      { key: "p3-hat", productId: "roof-cottage", platform: 2, position: [712, 240, 110], rotation: 0 },
      { key: "p3-seesaw", productId: "seesaw", platform: 2, position: [850, 100, 110], rotation: 270 },
      { key: "p3-planter", productId: "planter", platform: 2, position: [610, 210, 110], rotation: 0 },
    ],
  },
];
