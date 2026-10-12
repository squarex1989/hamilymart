// Mesh/thumbnail cache revision is separate from saved configuration indices.
export const MODEL_ASSET_VERSION = "steel-v17-four-magnet-seesaw";

/** Product data, prices (CNY cents), and attachment geometry. All dimensions are mm.
 * Magnet coordinates follow unified_complete_steel_v15/hardware_complete.json.
 * Contact planes, rather than embedded magnet centers, are used for assembly transforms.
 */
export type Vec3 = [number, number, number];
export type Rotation = 0 | 90 | 180 | 270;
export type Bounds = [number, number, number, number, number, number];
export const COLORS = [
  { id: "cream", name: "杏色", hex: "#FEF1DB" },
  { id: "pine", name: "绿色", hex: "#174A3A" },
  { id: "red", name: "红色", hex: "#B8273C" },
  { id: "butter", name: "黄色", hex: "#F3B34E" },
  { id: "sage", name: "鼠尾草", hex: "#A7BEA4" },
  { id: "rose", name: "粉色", hex: "#E9AEBC" },
  { id: "sky", name: "蓝色", hex: "#A6C8DF" },
  { id: "lilac", name: "香芋紫", hex: "#C7B4D8" },
  { id: "white", name: "白色", hex: "#FAFAF7" },
  { id: "marble", name: "大理石色", hex: "#E2E2DE" },
  { id: "jade", name: "琉璃绿", hex: "#299C82" },
  { id: "peachwood", name: "桃木", hex: "#BE896F" },
  { id: "wood", name: "仿木", hex: "#CCAB7A" },
  { id: "darkwood", name: "深棕", hex: "#654333" },
  { id: "yellow", name: "黄色", hex: "#F3B34E" },
  { id: "black", name: "黑色", hex: "#303331" },
  { id: "gray", name: "灰色", hex: "#A4ABA9" },
] as const;
/** Serialized indices stay fixed; index 14 is a same-yellow compatibility alias. */
export const AVAILABLE_COLORS = COLORS.filter(color => color.id !== "sage" && color.id !== "lilac" && color.id !== "marble" && color.id !== "yellow");
export type ColorId = (typeof COLORS)[number]["id"];
/** Compare/render one yellow while retaining either historical ID in saved data. */
export function canonicalColorId(color: ColorId): ColorId {
  return color === "yellow" ? "butter" : color;
}
export const WOOD_COLOR_IDS = ["peachwood", "wood", "darkwood"] as const satisfies readonly ColorId[];
/** All available wood tones use the same solid-color swatch as their rendered finish. */
export function getColorSwatch(colorId: string): string {
  return COLORS.find(color => color.id === colorId)?.hex ?? COLORS[0].hex;
}
/** Secondary decorative bodies use the same stock palette. */
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
  G05: { Snow: "G05-base" },
};
/** Source IDs distinguish decorative bodies even when both have the Gold material. */
export const SOURCE_COMPONENT_COLOR_SLOTS: Record<string, Record<string, string>> = {
  A01: {
    A01_Gold: "A01-ribbon",
    A01_StarGold: "A01-bow",
    A01_BowGold: "A01-bow",
    A01_ChristmasRed: "A01-bow",
  },
  G05: { G05_Snow: "G05-base" },
  SS01: { SS01_PineGreen: "SS01-base" },
  // Preserve the existing window slot before appending the brim/pompom control.
  G03: { G03_WindowSnow: "G03-window", G03_Snow: "G03-trim" },
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
  "SS01-base": { id: "SS01-base", role: "跷跷板底座", defaultColor: "pine" },
  "A01-ribbon": { id: "A01-ribbon", role: "礼物盒丝带", defaultColor: "butter" },
  // Keep the persisted key and position so previous bow colors become the star colors.
  "A01-bow": { id: "A01-bow", role: "五角星", defaultColor: "butter" },
  "G05-base": { id: "G05-base", role: "楼梯底座", defaultColor: "cream" },
  "G03-window": { id: "G03-window", role: "窗框", defaultColor: "cream" },
  "G03-trim": { id: "G03-trim", role: "帽檐与圆球", defaultColor: "cream" },
};
/** Stable order: real part controls first, then decorative slots in source mapping order. */
export function getColorParts(parts: ProductPart[]): ProductPart[] {
  const slots = [...new Set(parts.flatMap(part => [
    ...Object.values(SOURCE_PART_COLOR_SLOTS[part.id] ?? {}),
    ...Object.values(SOURCE_COMPONENT_COLOR_SLOTS[part.id] ?? {}),
  ]))];
  return [...parts, ...slots.map(id => COLOR_SLOTS[id])];
}
const LINKED_COLOR_PARTS: Record<string, string> = { G16: "G15", G17: "G15", W01: "A02", W02: "A02" };
/** Rendering and editing use one leader; persisted part positions remain unchanged. */
export function getLinkedColorPartId(partId: string): string {
  return LINKED_COLOR_PARTS[partId] ?? partId;
}
export function setProductColor(colors: ColorMap, partId: string, color: ColorId): ColorMap {
  const leader = getLinkedColorPartId(partId);
  const linked = Object.entries(LINKED_COLOR_PARTS).filter(([, id]) => id === leader).map(([id]) => id);
  return resolveHatContrast({ ...colors, ...Object.fromEntries([leader, ...linked].map(id => [id, color])) });
}
/** A hat's small details stay visible even after a manual single-part color change. */
export function resolveHatContrast(colors: ColorMap): ColorMap {
  if (!colors.G03) return colors;
  const result = { ...colors };
  const fallback = colors.G03 === "cream" || colors.G03 === "white" || colors.G03 === "wood" ? "pine" : "cream";
  for (const key of ["G03-window", "G03-trim"])
    if (canonicalColorId(result[key] ?? "cream") === canonicalColorId(colors.G03) || (["cream", "white"].includes(colors.G03) && ["cream", "white"].includes(result[key] ?? "cream"))) result[key] = fallback;
  return result;
}
/** Effective rendered/order colors; old saved follower choices are left intact in storage. */
export function resolveLinkedProductColors(colors: ColorMap): ColorMap {
  return resolveHatContrast(Object.fromEntries(Object.entries(colors).map(([part, color]) => [part, colors[getLinkedColorPartId(part)] ?? color])));
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
  category: "house" | "pipe" | "facility";
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
  /** Audited partial overlap on base steel receivers; other surfaces remain concentric. */
  baseMagnetOffsetMm?: number;
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
export const PLATFORM_BODY_PRICE = 2000;
export const PIPE_SET_PRICE = 800;
/** Four legs per set. Keep this table separate from the assembled platform total. */
export const LEG_SET_PRICES = { 0: 0, 100: 1000, 200: 1200, 300: 1400 } as const;
export const BASE_PRODUCT = {
  id: "platform",
  sku: "HM-PL-001",
  name: "云朵基础平台",
  price: PLATFORM_BODY_PRICE + LEG_SET_PRICES[100],
  tallLegSurcharge: LEG_SET_PRICES[200] - LEG_SET_PRICES[100],
  extraTallLegSurcharge: LEG_SET_PRICES[300] - LEG_SET_PRICES[100],
  noLegDiscount: LEG_SET_PRICES[100],
  poolSurcharge: 2500,
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
): Product {
  return {
    id: `pipe-${id.toLowerCase()}`,
    sku: `HM-TB-${id}`,
    name,
    category: "pipe",
    price: PIPE_SET_PRICE,
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
    price: 8000,
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
      [0, 178.2, 110, 300, 300, 238],
      [219, 82, 110, 300, 194, 201.423],
    ],
    surfaces: [
      {
        id: "cottage",
        points: down(
          [
            [10, 192],
            [10, 286],
            [156, 192],
            [156, 286],
          ],
          200,
        ),
        bounds: [0, 180, 200, 167, 300, 200],
      },
      {
        id: "planter",
        points: down(
          [
            [280.5, 264],
          ],
          200,
        ),
        bounds: [235, 215, 200, 300, 300, 200],
      },
    ],
    allowedParents: ["base"],
  },
  {
    id: "l-house",
    sku: "HM-HS-002",
    name: "L型转角屋",
    category: "house",
    price: 3500,
    description: "L 型房屋 + 顶盖板 · 屋顶可继续搭建",
    origin: [100, 100, 0],
    parts: [part("LHB", "房屋", "pine"), part("LHR", "顶盖板", "cream")],
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
    price: 1500,
    description: "立方房屋 + 顶盖板 · 也能叠在 L 型屋顶",
    origin: [50, 50, 0],
    parts: [part("SHB", "房屋", "pine"), part("SHR", "顶盖板", "cream")],
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
    name: "帽子小屋",
    category: "house",
    price: 4000,
    description: "一层两点磁吸 · 二层四点磁吸",
    // Stable virtual pivot: source body and all four contacts moved +5 mm in
    // V15, matching the parent receivers, so old saved hat transforms survive.
    origin: [78, 239, 200],
    parts: [part("G03", "阁楼", "red")],
    bottomMagnets: down(
      [
        [10, 192],
        [10, 286],
        [156, 192],
        [156, 286],
      ],
      200,
    ),
    collisionBoxes: [[2, 179.60000610351562, 200, 164, 298, 373.3333435058594]],
    allowedParents: ["base", "villa"],
    // Ø8 magnets on Ø12 steel: 94 mm / 100 mm pairs, centered with 3 mm
    // offset per magnet (89.36% overlap). Does not imply measured holding force.
    baseMagnetOffsetMm: 3,
    allowedRelativeRotations: [0],
  },
  pipe(
    "ST1",
    "直管道",
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
    "侧开口直管道",
    [150, 50, 0],
    [
      [110, 90],
      [190, 90],
    ],
    [100, 6.8, 0, 200, 96, 89.6],
    straightFaces(100, 0),
  ),
  pipe(
    "ST3",
    "直管道",
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
    "直管道",
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
    "顶开口弯管道",
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
  ),
  pipe(
    "LT3",
    "直管道",
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
    name: "袜子花圃",
    category: "facility",
    price: 500,
    description: "中心单点磁吸 · 可安装于平台及房屋顶面",
    origin: [280.5, 264, 200],
    parts: [part("G06", "花圃", "red")],
    bottomMagnets: down(
      [
        [280.5, 264],
      ],
      200,
    ),
    minimumMagnetMatches: 1,
    collisionBoxes: [[264, 220, 200, 296, 294, 261.5]],
    allowedParents: ["base", "villa", "l-house"],
    allowedRelativeRotations: [0],
  },
  {
    id: "food-bowl",
    sku: "HM-GD-002",
    name: "方块食盆",
    category: "facility",
    price: 500,
    description: "中心单点磁吸 · 可安装于平台及房屋顶面",
    origin: [280.5, 264, 200],
    parts: [part("O01", "食盆", "red")],
    bottomMagnets: down([[280.5, 264]], 200),
    minimumMagnetMatches: 1,
    collisionBoxes: [[241, 236, 200, 296, 296, 221]],
    allowedParents: ["base", "villa", "l-house"],
    allowedRelativeRotations: [0],
  },
  {
    id: "pool",
    sku: "HM-GD-003",
    name: "圆形泳池",
    category: "facility",
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
    name: "跷跷板",
    category: "facility",
    price: 1500,
    description: "18 × 10 cm · 四点磁吸 · 最高 10 cm · 圆角防滑棱",
    origin: [100, 250, 110],
    parts: [part("SS01", "防滑板面", "butter")],
    bottomMagnets: [[90, 210, 110], [110, 210, 110], [90, 290, 110], [110, 290, 110]],
    minimumMagnetMatches: 4,
    // Reserve the complete +/-32 degree swing, not just the default pose.
    collisionBoxes: [[9.3, 200, 110, 190.7, 300, 210]],
    allowedParents: ["base"],
  },
  // The source LT2N uses the same real LT2B support, magnets and end faces as LT2.
  {
    ...pipe("LT2N", "弯管道", [150, 150, 0], [[110, 190], [190, 110]],
      [100, 100, 0, 196, 196, 89.6], [
        { center: [100, 188, 11], normal: [-1, 0, 0] },
        { center: [188, 100, 11], normal: [0, -1, 0] },
      ]),
    parts: [part("LT2NT", "管道", "cream"), part("LT2B", "磁吸底座", "cream")],
  },
  // Append only: both T modules occupy one grid square and share a real keyed
  // support derived from ST1B. A common lumen joins all three horizontal mouths.
  ...(["TT1", "TT2"] as const).map(id => ({
    ...pipe(id, id === "TT1" ? "T型三通" : "顶开口T型三通", [50, 50, 0], [[10, 90], [90, 90]],
      [0, 0, 0, 100, 100, 89.6], [
        ...straightFaces(0, 0),
        { center: [50, 0, 46.4] as Vec3, normal: [0, -1, 0] as Vec3 },
      ]),
    description: "10 × 10 cm · 三向连通管道 + 专用磁吸底座",
    parts: [part(`${id}T`, "管道", "cream"), part("TTB", "磁吸底座", "cream")],
  })),
];
/** Keep legacy product indices decodable while showing one choice per distinct pipe geometry. */
const VISIBLE_PRODUCT_IDS = ["villa", "l-house", "cube-house", "roof-cottage", "pipe-st1", "pipe-lt2n", "pipe-st2", "pipe-lt2", "pipe-tt2", "pipe-tt1", "planter", "food-bowl", "pool", "seesaw"];
export const VISIBLE_PRODUCTS = VISIBLE_PRODUCT_IDS.map(id => getProduct(id));
export function getProduct(id: string): Product {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`未知组件：${id}`);
  return product;
}
export function getProductColorParts(productId: string): ProductPart[] {
  return getColorParts(getProduct(productId).parts);
}
export function getEditableProductColorParts(productId: string): ProductPart[] {
  const roles: Record<string, string> = {
    A01: "小屋墙面", A02: "二层平台与支柱", G05: "楼梯踏面", G15: "草丛围栏", G03: "帽子主体",
  };
  return getProductColorParts(productId)
    .filter(part => getLinkedColorPartId(part.id) === part.id)
    .map(part => ({ ...part, role: roles[part.id] ?? part.role }));
}
export function getDefaultColors(productId: string): ColorMap {
  return Object.fromEntries(
    getProductColorParts(productId).map((p) => [p.id, p.defaultColor]),
  );
}
export const COLOR_IDS = new Set<string>(COLORS.map((c) => c.id));
export const SNAP_DISTANCE_MM = 42;
export const CATALOG_VERSION = 8;
