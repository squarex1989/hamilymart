/** Product data, prices (CNY cents), and attachment geometry. All dimensions are mm.
 * Magnet coordinates follow unified_complete_steel_v12/hardware_complete.json.
 * Contact planes, rather than embedded magnet centers, are used for assembly transforms.
 */
export type Vec3 = [number, number, number];
export type Rotation = 0 | 90 | 180 | 270;
export type Bounds = [number, number, number, number, number, number];
export const COLORS = [
  { id: "cream", name: "杏色", hex: "#F1EADB" },
  { id: "pine", name: "绿色", hex: "#174A3A" },
  { id: "red", name: "红色", hex: "#B8273C" },
  { id: "butter", name: "黄色", hex: "#C99B46" },
  { id: "sage", name: "鼠尾草", hex: "#A7BEA4" },
  { id: "rose", name: "粉色", hex: "#E9AEBC" },
  { id: "sky", name: "蓝色", hex: "#A6C8DF" },
  { id: "lilac", name: "香芋紫", hex: "#C7B4D8" },
  { id: "white", name: "白色", hex: "#FAFAF7" },
  { id: "marble", name: "大理石色", hex: "#E2E2DE" },
  { id: "jade", name: "琉璃绿", hex: "#299C82" },
] as const;
/** Keep legacy sage/lilac decodable without offering them for new color selections. */
export const AVAILABLE_COLORS = COLORS.filter(color => color.id !== "sage" && color.id !== "lilac");
export type ColorId = (typeof COLORS)[number]["id"];
/** Secondary decorative bodies use the same eight-color stock palette. */
export const SOURCE_TRIM_COLORS: Record<string, ColorId> = {
  Snow: "cream",
  Gold: "butter",
  ChristmasRed: "red",
  PineGreen: "pine",
};
export const PRIMARY_COLOR_KEYS: Record<string, string> = {
  G05: "ChristmasRed",
};
/** User-approved decorative overrides; all other source colors remain unchanged. */
export const SOURCE_PART_TRIM_COLORS: Record<string, Record<string, ColorId>> = {
  A01: { ChristmasRed: "butter" },
};
export type ColorMap = Record<string, ColorId>;
export interface ProductPart {
  id: string;
  role: string;
  defaultColor: ColorId;
  offset?: Vec3;
}
/** Independent decorative color slots; these are color controls, not separately sold parts. */
export const SOURCE_PART_COLOR_SLOTS: Record<string, Record<string, string>> = {
  A01: { Gold: "A01-ribbon", ChristmasRed: "A01-bow" },
};
/** Source IDs distinguish decorative bodies even when both have the Gold material. */
export const SOURCE_COMPONENT_COLOR_SLOTS: Record<string, Record<string, string>> = {
  A01: {
    A01_Gold: "A01-ribbon",
    A01_StarGold: "A01-bow",
    A01_BowGold: "A01-bow",
    A01_ChristmasRed: "A01-bow",
  },
};
export function getSourceColorSlot(
  groupId: string,
  sourcePart?: string,
  colorKey?: string,
): string | undefined {
  return (sourcePart ? SOURCE_COMPONENT_COLOR_SLOTS[groupId]?.[sourcePart] : undefined)
    ?? (colorKey ? SOURCE_PART_COLOR_SLOTS[groupId]?.[colorKey] : undefined);
}
export const COLOR_SLOTS: Record<string, ProductPart> = {
  "A01-ribbon": { id: "A01-ribbon", role: "礼物盒丝带", defaultColor: "butter" },
  // Keep the persisted key and position so previous bow colors become the star colors.
  "A01-bow": { id: "A01-bow", role: "五角星", defaultColor: "butter" },
};
/** Stable order: real part controls first, then decorative slots in source mapping order. */
export function getColorParts(parts: ProductPart[]): ProductPart[] {
  const slots = [...new Set(parts.flatMap(part => Object.values(SOURCE_PART_COLOR_SLOTS[part.id] ?? {})))];
  return [...parts, ...slots.map(id => COLOR_SLOTS[id])];
}
export interface MagnetSurface {
  id: string;
  points: Vec3[];
  bounds: Bounds;
}
export interface PipeFace {
  center: Vec3;
  normal: Vec3;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: "house" | "pipe" | "garden" | "toy";
  price: number;
  description: string;
  badge?: string;
  installation?: "magnet" | "insert";
  parts: ProductPart[];
  /** Source-space pivot; renderer subtracts this before rotating and translating. */
  origin: Vec3;
  /** Source-space external downward magnet contact positions. */
  bottomMagnets: Vec3[];
  /** Only source-defined single-contact accessories opt out of the two-contact minimum. */
  minimumMagnetMatches?: number;
  /** Source-space conservative occupied volumes, separate boxes retain L-shaped clearance. */
  collisionBoxes: Bounds[];
  /** Source-space upward attachment positions and supporting area. */
  surfaces?: MagnetSurface[];
  pipeFaces?: PipeFace[];
  allowedParents?: string[];
  /** Relative rotations proven clear of the bundled parent geometry. */
  allowedRelativeRotations?: Rotation[];
}
const part = (
  id: string,
  role: string,
  defaultColor: ColorId,
): ProductPart => ({ id, role, defaultColor });
const down = (xy: number[][], z: number): Vec3[] =>
  xy.map(([x, y]) => [x, y, z]);
/** Steel V12 P01/H06 receiver locations, transcribed and audited separately from source hardware. */
export const P01_TOP_XY: [number, number][] = [[10, 10], [10, 90], [10, 110], [10, 190], [10, 210], [10, 290], [90, 10], [90, 190], [90, 210], [90, 290], [110, 10], [110, 190], [110, 210], [110, 290], [190, 10], [190, 90], [190, 110], [190, 190], [190, 210], [190, 290], [210, 10], [210, 90], [210, 110], [210, 190], [210, 210], [210, 290], [290, 10], [290, 90], [290, 110], [290, 190], [290, 210], [290, 290]];
export const H06_TOP_XY: [number, number][] = [[90, 90], [90, 110], [110, 90], [110, 110]];
export const BASE_PRODUCT = {
  id: "platform",
  sku: "HM-PL-001",
  name: "云朵基础平台",
  price: 12900,
  tallLegSurcharge: 2400,
  extraTallLegSurcharge: 4800,
  noLegDiscount: 2000,
  poolSurcharge: 2900,
  description: "30 × 30 cm 平台 · 含四支撑脚与六个孔盖",
};
export function getBaseParts(
  legHeight: 0 | 100 | 200 | 300,
  pool: boolean | "lid" | "pool" = false,
  removedCovers: string[] = [],
): ProductPart[] {
  return [
    part("P01", "平台", "cream"),
    ...[1, 2, 3, 4, 5].filter(n => !removedCovers.includes(`H0${n}`)).map((n) => part(`H0${n}`, `小圆盖 ${n}`, "cream")),
    part(
      pool === true || pool === "pool" ? "B01" : "H06",
      pool === true || pool === "pool" ? "嵌入池盆" : "大圆盖",
      "cream",
    ),
    ...(legHeight === 0 ? [] : [1, 2, 3, 4]).map((n) =>
      part(`${legHeight === 100 ? "L" : legHeight === 200 ? "X" : "Y"}0${n}`, `支撑脚 ${n}`, "pine"),
    ),
  ];
}
function pipe(
  id: string,
  name: string,
  origin: Vec3,
  magnets: number[][],
  bounds: Bounds,
  faces: PipeFace[],
  price = 2900,
): Product {
  return {
    id: `pipe-${id.toLowerCase()}`,
    sku: `HM-TB-${id}`,
    name,
    category: "pipe",
    price,
    description: "管道 + 专用磁吸底座 · 不可拆售",
    origin,
    parts: [
      part(`${id}T`, "管道", "cream"),
      part(`${id}B`, "磁吸底座", "cream"),
    ],
    bottomMagnets: down(magnets, 0),
    collisionBoxes: [bounds],
    pipeFaces: faces,
    allowedParents: ["base", "l-house"],
  };
}
const straightFaces = (x: number, y: number): PipeFace[] => [
  { center: [x, y + 88, 11], normal: [-1, 0, 0] },
  { center: [x + 100, y + 88, 11], normal: [1, 0, 0] },
];
export const PRODUCTS: Product[] = [
  {
    id: "villa",
    sku: "HM-HS-001",
    name: "礼物盒小屋",
    category: "house",
    price: 15900,
    badge: "人气套餐",
    description: "礼物盒小屋 + 二层平台 + 楼梯 + 三边草栏 + 双支柱",
    origin: [150, 190, 110],
    parts: [
      part("A01", "一层小屋", "pine"),
      part("A02", "二层平台", "cream"),
      part("G05", "波浪楼梯", "red"),
      part("G15", "后侧草栏", "pine"),
      part("G16", "左侧草栏", "pine"),
      part("G17", "右侧草栏", "pine"),
      part("W01", "前侧白柱", "cream"),
      part("W02", "后侧白柱", "cream"),
    ],
    bottomMagnets: down(
      [
        [10, 190],
        [190, 190],
        [10, 290],
        [190, 290],
        [290, 190],
        [290, 290],
        [290, 90],
      ],
      110,
    ),
    collisionBoxes: [
      [-5, 178.2, 110, 305, 300, 238],
      [219, 82, 110, 300, 194, 201.423],
    ],
    surfaces: [
      {
        id: "cottage",
        points: down(
          [
            [5, 192],
            [5, 286],
            [151, 192],
            [151, 286],
          ],
          200,
        ),
        bounds: [-5, 180, 200, 162, 300, 200],
      },
      {
        id: "planter",
        points: down(
          [
            [285.5, 264],
          ],
          200,
        ),
        bounds: [240, 215, 200, 305, 300, 200],
      },
    ],
    allowedParents: ["base"],
  },
  {
    id: "l-house",
    sku: "HM-HS-002",
    name: "L型转角屋",
    category: "house",
    price: 8900,
    description: "L 型房屋 + 顶盖板 · 屋顶可继续搭建",
    origin: [100, 100, 0],
    parts: [part("LHB", "房屋", "pine"), part("LHR", "顶盖板", "butter")],
    bottomMagnets: down(
      [
        [10, 10],
        [10, 190],
        [190, 190],
      ],
      0,
    ),
    collisionBoxes: [
      [2, 2, 0, 98, 198, 85.6],
      [98, 102, 0, 198, 198, 85.6],
    ],
    surfaces: [
      {
        id: "roof",
        points: down(
          [
            [10, 110],
            [90, 110],
            [10, 190],
            [90, 190],
          ],
          85.6,
        ),
        bounds: [2, 102, 85.6, 98, 198, 85.6],
      },
    ],
    allowedParents: ["base"],
  },
  {
    id: "cube-house",
    sku: "HM-HS-003",
    name: "方糖小屋",
    category: "house",
    price: 4900,
    description: "立方房屋 + 顶盖板 · 也能叠在 L 型屋顶",
    origin: [50, 50, 0],
    parts: [part("SHB", "房屋", "pine"), part("SHR", "顶盖板", "butter")],
    bottomMagnets: down(
      [
        [10, 90],
        [90, 10],
      ],
      0,
    ),
    collisionBoxes: [[2, 2, 0, 98, 98, 83.4]],
    allowedParents: ["base", "l-house"],
  },
  {
    id: "roof-cottage",
    sku: "HM-HS-004",
    name: "圣诞帽小屋",
    category: "house",
    price: 7900,
    description: "四点磁吸 · 安装于礼物盒二层平台",
    // The original source pivot also preserves saved upper-floor placements.
    origin: [78, 239, 200],
    parts: [part("G03", "阁楼", "red")],
    bottomMagnets: down(
      [
        [5, 192],
        [5, 286],
        [151, 192],
        [151, 286],
      ],
      200,
    ),
    collisionBoxes: [[-3, 179.60000610351562, 200, 159, 298, 373.3333435058594]],
    allowedParents: ["base", "villa"],
    allowedRelativeRotations: [0],
  },
  pipe(
    "ST1",
    "云朵直通管 01",
    [50, 50, 0],
    [
      [10, 90],
      [90, 90],
    ],
    [0, 6.8, 0, 100, 96, 89.6],
    straightFaces(0, 0),
  ),
  pipe(
    "ST2",
    "侧开口探索管",
    [150, 50, 0],
    [
      [110, 90],
      [190, 90],
    ],
    [100, 6.8, 0, 200, 96, 89.6],
    straightFaces(100, 0),
    3500,
  ),
  pipe(
    "ST3",
    "云朵直通管 03",
    [250, 50, 0],
    [
      [210, 90],
      [290, 90],
    ],
    [200, 6.8, 0, 300, 96, 89.6],
    straightFaces(200, 0),
  ),
  pipe(
    "LT1",
    "花园直通管 01",
    [50, 150, 0],
    [
      [10, 190],
      [90, 190],
    ],
    [0, 106.8, 0, 100, 196, 89.6],
    straightFaces(0, 100),
  ),
  pipe(
    "LT2",
    "90° 转角探索管",
    [150, 150, 0],
    [
      [110, 190],
      [190, 110],
    ],
    [100, 100, 0, 196, 196, 89.6],
    [
      { center: [100, 188, 11], normal: [-1, 0, 0] },
      { center: [188, 100, 11], normal: [0, -1, 0] },
    ],
    3900,
  ),
  pipe(
    "LT3",
    "花园直通管 03",
    [150, 50, 0],
    [
      [190, 90],
      [190, 10],
    ],
    [106.8, 0, 0, 196, 100, 89.6],
    [
      { center: [188, 100, 11], normal: [0, 1, 0] },
      { center: [188, 0, 11], normal: [0, -1, 0] },
    ],
  ),
  {
    id: "planter",
    sku: "HM-GD-001",
    name: "圣诞袜花圃",
    category: "garden",
    price: 1900,
    description: "中心单点磁吸 · 可安装于平台及房屋顶面",
    origin: [285.5, 264, 200],
    parts: [part("G06", "花圃", "red")],
    bottomMagnets: down(
      [
        [285.5, 264],
      ],
      200,
    ),
    minimumMagnetMatches: 1,
    collisionBoxes: [[269, 220, 200, 301, 294, 261.5]],
    allowedParents: ["base", "villa", "l-house"],
    allowedRelativeRotations: [0],
  },
  {
    id: "food-bowl",
    sku: "HM-GD-002",
    name: "圣诞食盆",
    category: "garden",
    price: 1900,
    description: "中心单点磁吸 · 可安装于平台及房屋顶面",
    origin: [285.5, 264, 200],
    parts: [part("O01", "食盆", "red")],
    bottomMagnets: down([[285.5, 264]], 200),
    minimumMagnetMatches: 1,
    collisionBoxes: [[246, 236, 200, 301, 296, 221]],
    allowedParents: ["base", "villa", "l-house"],
    allowedRelativeRotations: [0],
  },
  {
    id: "pool",
    sku: "HM-GD-003",
    name: "圣诞泳池",
    category: "garden",
    price: BASE_PRODUCT.poolSurcharge,
    description: "嵌入平台大圆洞 · 自动移除大圆盖 · 需要支撑脚",
    installation: "insert",
    origin: [100, 100, 110],
    parts: [part("B01", "泳池", "cream")],
    bottomMagnets: [],
    collisionBoxes: [[22, 22, 30.65, 178, 178, 113.65]],
    allowedParents: ["base"],
  },
  // Append products: HM3 codes store the existing product-array indices.
  {
    id: "seesaw",
    sku: "HM-TY-001",
    name: "磁吸跷跷板",
    category: "toy",
    price: 3900,
    description: "18 × 8 cm · 中心单点磁吸 · 一体活动玩具",
    origin: [90, 90, 110],
    parts: [part("SS01", "跷跷板", "butter")],
    bottomMagnets: [[90, 90, 110]],
    minimumMagnetMatches: 1,
    // Source neutral height is 31.6 mm; reserve the full ±11.9° swing envelope.
    collisionBoxes: [[0, 50, 110, 180, 130, 159.8]],
    allowedParents: ["base"],
  },
];
export function getProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`未知组件：${id}`);
  return product;
}
export function getProductColorParts(productId: string): ProductPart[] {
  return getColorParts(getProduct(productId).parts);
}
export function getDefaultColors(productId: string): ColorMap {
  return Object.fromEntries(
    getProductColorParts(productId).map((p) => [p.id, p.defaultColor]),
  );
}
export const COLOR_IDS = new Set<string>(COLORS.map((c) => c.id));
export const SNAP_DISTANCE_MM = 42;
export const CATALOG_VERSION = 6;
