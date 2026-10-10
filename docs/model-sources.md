# HamilyMart 模型资产来源与维护

网页模型来自已核对的正式装配目录：

```
/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_8x4_v4/
```

主体几何输入是该目录的 `assembly_meshes.json`（schema 3），使用 `groups[].components[].vertices/triangles`。另外，圣诞食盆 O01 来自独立注明的历史 V30 选配资产；G03 使用下文说明的双层兼容派生几何。所有 GLB 使用装配坐标，不使用打印排版坐标；没有改动任何源打印文件。

主体版本为 **Complete 8x4 V4**。礼物盒小屋套餐由 `A01,A02,G05,G15,G16,G17,W01,W02` 八个组构成。A01 源文件包含绿色房体、金色饰条、红色蝴蝶结三个颜色体。按用户的新配色要求，网页与商品图将 A01 的蝴蝶结显示为 Gold `#C99B46`；使用 `SOURCE_PART_TRIM_COLORS` 做零件级映射，保留源文件与其他红色部件。

源文件 SHA-256：`2668172cba9a6b03c0e99b1f7874ec3cf01db7988aaeab9ed2d828865f4212d0`。

## G03 圣诞帽阁楼的双层兼容派生版

用户授权调整阁楼尺寸，同时兼容一层和二层。原 G03 四孔矩形为 146 × 94 mm；二层 A02 的最左两个孔为 `(5,192)`、`(5,286)`，心距 94 mm。V4 一层 P01 的 100 mm 格内，孔心距格边 10 mm，同格四孔心距 80 mm。例如 `[200,300]²` 格的四孔为 `(210,210)`、`(210,290)`、`(290,210)`、`(290,290)`。已在 P01 实际网格 z=107 mm 截面交叉验证，孔边缘为 205.899994 / 214.100006 mm 等，孔径为 Ø8.2 mm。不能将格宽 100 mm 当成磁孔心距。

在保留二层 94 mm 纵向孔距、仅允许四个直角方向的约束下，一层格点可用的横向孔距中，120 mm 最接近原 146 mm。因此只将阁楼宽度从 162 mm 缩短 26 mm，变为 **136 × 118.4 × 173.333 mm**。`scripts/derive-g03-dual-floor.py` 保留原闭合网格拓扑，在 x=14..142 mm 中段做连续单调的分段压缩；x≤14 的左磁座/侧墙完全不动，x≥142 的右磁座/侧墙整体左移 26 mm。它重建真实网格、打印 STL 与 GLB，不使用前端缩放，磁孔不会缩成椭圆。原 5 mm 侧墙、y 向 70 mm 入口与 Ø8.2 × 4.2 mm 底孔保留。

- 新装配 bounds：`[-3,179.60000610351562,200,133,298,373.3333435058594]`。
- 业务 origin 保持 `[78,239,200]`，避免隐式改变安装参考点。
- 磁孔接触点：`(5,192,200)`、`(5,286,200)`、`(125,192,200)`、`(125,286,200)`；对应 local XY 为 `(-73,-47)`、`(-73,47)`、`(47,-47)`、`(47,47)`。
- 二层保留左侧两个 94 mm 孔吸附；一层使用前侧或后侧的 120 mm 双孔吸附。每次实际匹配两孔，并非宣称四孔同时匹配两个平台。

派生源保存在本项目忽略目录 `.site-workflow/derived-models/g03-dual-floor/assembly_meshes.json`，SHA-256 为 `0622375b327e6db357f663a87022f7c044a8231eb1ecf2df9545c22da799f338`。同目录保存双色打印 STL、`G03_combined_print.stl`、`geometry-validation.json`、`printability-analysis.json` 和四视图预览。原始 V4 目录保持不动。

验证结果：两色打印 STL 均水密且法向一致，合并后为一个实体；四个圆孔的空腔检查通过，左右磁座的实体差集小于 0.001 mm³，67 × 50 mm 保守入口净空探针通过。实际派生实体在原二层位置和右移 26 mm 的另一合法位置，与 A02/G15/G16/G17 均无实体干涉。技能 `analyze.py --repair --printer H2C --unit mm` 检查评分 9.7/10，未执行任何修复，零边界边/非流形边/退化面；2000 点壁厚抽样最小 1.9 mm、95% 表面至少 4.03 mm，适配 H2C。尚未重新原生切片或实体打印，仍需像原阁楼一样在切片器检查窗框等局部支撑；抽样结果不等于穷尽式壁厚证明。

网页 G03 为 13,608 个三角形、339,036 字节。它的来源和验证数据记录在 `public/models/validation.json` 的 `groups.G03.derivedSource`；当前全部 43 组共 299,242 个三角形、7,158,576 字节。

## 圣诞食盆的独立来源

O01 是现有历史选配件，来自 `christmas_villa_v30_pool_cover/assembly_meshes.json`（版本 V30），不是 V4 的 42 件之一。源 SHA-256 为 `3d25c19b4a9c6584a12cb06fbf76ce217666a8623638c1b270a8a59796feed9f`。它保留红色盆身与白色盆沿、55 × 60 × 21 mm 尺寸及原坐标 `[94.5,96,180,149.5,156,201]`，网站没有另造食盆几何。

原始 `magnet_interfaces.json` 记录两个底孔中心为 `(127,124,180)`、`(141,124,180)`，间距 14 mm，可匹配 A02 的花圃磁位。**O01 的硬件仍为 Ø8 × 2 mm 磁铁、Ø8.1 × 2.1 mm 孔，并未改成主体 V4 的 8 × 4 mm 规格。** 食盆与圣诞袜花圃占用同一个安装位置，不能重叠安装。

`public/models/validation.json` 的 `supplementalSources` 独立记录其来源、校验值与硬件尺寸。网页共提供 43 组、50 个颜色体；其中 V4 主体 42 组、48 个颜色体，O01 增补 1 组、2 个颜色体。

## 坐标与加载约定

- 单位为毫米，**Z 向上**。每个 GLB 保留源装配世界坐标；除上述有来源记录的 G03 派生重建外，导出没有归零、翻转、缩放或替换几何。
- `src/data/model-index.json` 按原始 group ID 索引，提供 `/models/{groupId}.glb`、源包围盒 `[minX,minY,minZ,maxX,maxY,maxZ]`、中文名称、各颜色体 ID 与原始色。
- P01 平台源范围为 `[0,0,100,300,300,110]`。L01–L04 支撑腿的 Z 为 0–100，X01–X04 为 -100–100。选择 20 cm 腿后，前端整体向上补偿 100 mm 才能让脚底保持地面位置。
- 套餐组合的各个 group 直接保留相对位置；前端统一减去 `catalog.ts` 中的套餐 `origin`，再旋转、平移。不要逐零件分别居中，否则真实组装关系会消失。
- 原始节点和 mesh 的 glTF `extras` 都包含 `sourcePart`、`sourceGroup`、`colorKey`、`defaultColor`。Three.js `GLTFLoader` 将其暴露为 `mesh.userData`，便于按零件或原颜色体调整颜色。
- GLB 用标准位置、法线和三角索引，不需要 Draco、Meshopt 或外部 CDN 解码器；每组独立文件，适合懒加载和缓存。
- 虽然标准 glTF 查看器通常假定 Y-up，这些业务资产有意保留模型 Z-up。Three.js 中应将模型放在统一转换父组中，或将 camera/controls 的 up 设置为 Z。Blender 生成缩略图时显式撤销导入器的轴转换。

## 轻量化与验证

原始 V4 模型为 42 组、48 个颜色体，共 906,924 个三角形。未应用 G03 派生版前，网页主体总计 295,514 个三角形、7,064,392 字节。增补 O01 原始 7,422 个三角形，网页简化为 3,814 个；当时总计 43 组、50 个颜色体、299,328 个三角形。G03 派生版后的当前统计见上节；磁孔、接合结构、房屋、楼梯和管道仍来自各自注明的实际几何。

密集曲面的三角划分使用保守 QEM 简化；小于 3,200 三角形的颜色体直接保留。每次简化检查包围盒、体积及确定性采样的最近面距离，超限时保留原网格。法线按 40° 分开锐边，使板面与圆角正确着色。材质源颜色由 sRGB 转换成 glTF 所需线性值。

本次导出验证：

- 全部 42 个 GLB 重新加载成功，顶点和三角索引有效，节点原零件编号一致。
- 导出网格与源包围盒最大差异为 **0.002899 mm**。
- 每个参与简化的颜色体最多抽取 1,600 个原始顶点，采样最近面距离最大为 **0.017028 mm**。
- 体积相对差异最大为 **0.022495%**。

采样误差不是完整 Hausdorff 距离证明；网页资产用于选购预览，不能替代原始生产文件。磁吸匹配仍以正式模型磁铁坐标数据计算，不根据简化后的三角网格推断。

O01 另外通过 GLB 重新加载与包围盒校验。`public/models/validation.json` 保存主体与增补源文件 SHA-256、版本、每个颜色体简化前后面数和验证指标。

## 商品缩略图

`public/thumbnails/{productId}.png` 与 `base.png` 使用同一批真实 GLB 组合经 Blender 渲染，有透明背景，可直接放在奶油色卡片上。没有加入套餐外部件。商品图直接读取 `catalog.ts` 的 `COLORS`、各零件 `defaultColor`、`SOURCE_TRIM_COLORS`、`SOURCE_PART_TRIM_COLORS` 和 `PRIMARY_COLOR_KEYS`，与交互画面的八色库存及默认配色保持一致。主颜色体使用零件默认色，其余装饰色使用同一八色板的映射；G05 楼梯主色明确采用红色源颜色体。保留源模型的 Snow `#F1EADB`、PineGreen `#174A3A`、ChristmasRed `#B8273C`、Gold `#C99B46`，再增加四种可选色，A01 蝴蝶结按用户要求默认改为金黄色。几何仍完全来自原 GLB。相机按投影后的模型范围自动留白，避免方糖屋等较高模型被裁切。

现有 16 张商品图规格为 480 × 400 RGBA，已按新增食盆与黄色蝴蝶结重新生成，透明边界检查通过。其余 14 张像素未变的图片保留原文件，避免仅由 PNG 元数据引起无效变更。商品目录与默认配色变化自动反映到图片中。

## 重新生成

使用 Python 3.11 或更新版本：

```sh
python3 -m pip install numpy trimesh fast-simplification rtree pillow
python3 scripts/prepare-models.py --source '/absolute/path/to/assembly_meshes.json'
python3 scripts/derive-g03-dual-floor.py --source '/absolute/path/to/V4/assembly_meshes.json'
```

脚本默认从相邻历史 V30 目录导入 O01。源目录不同时使用 `--food-bowl-source '/absolute/path/to/V30/assembly_meshes.json'`。只重建某个已有组可用 `--only O01`；它保留其他现有 GLB 与校验项。

全量导出或 `--only G03` 后，必须再次运行 `derive-g03-dual-floor.py`，才能保持网站的双层兼容版。派生脚本额外需要 `manifold3d`，只更新 G03 GLB/index/validation 和本地工件，不改其他组。打印检查复现命令：

```sh
python3 /Users/chachacha/.agents/skills/bambu-studio-ai/scripts/analyze.py .site-workflow/derived-models/g03-dual-floor/G03_combined_print.stl --repair --printer H2C --unit mm --material PLA --purpose functional --json
```

同时生成商品图（无需 Blender 插件）：

```sh
python3 scripts/prepare-models.py --source '/absolute/path/to/assembly_meshes.json' --thumbnails --blender '/Applications/Blender.app/Contents/MacOS/Blender'
```

仅在已生成的 GLB 上重新渲染：

```sh
python3 scripts/prepare-models.py --thumbnails-only
```

新增产品时，在 `catalog.ts` 中配置组合、默认颜色与连接规则；缩略图脚本会通过本地 `tsx` 自动读取目录，无需重复维护产品列表。渲染缩略图前需在应用目录运行 `npm install`。新增几何时先更新正式源模型，再重新导出；不要手改二进制 GLB。
