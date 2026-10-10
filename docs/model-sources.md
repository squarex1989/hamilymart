# HamilyMart 模型资产来源与维护

网页模型来自已核对的正式装配目录：

```
/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_8x4_v4/
```

唯一几何输入是该目录的 `assembly_meshes.json`（schema 3），使用 `groups[].components[].vertices/triangles`。没有混用历史 V35、其他版本或打印排版坐标。没有改动源文件。

当前版本为 **Complete 8x4 V4**。花园复式套餐由 `A01,A02,G05,G15,G16,G17,W01,W02` 八个组构成：新增两根独立白柱及左右草栏，A01 包含绿色房体、金色饰条、红色蝴蝶结三个颜色体。保留全部原始四色。

源文件 SHA-256：`2668172cba9a6b03c0e99b1f7874ec3cf01db7988aaeab9ed2d828865f4212d0`。

## 坐标与加载约定

- 单位为毫米，**Z 向上**。每个 GLB 保留源装配世界坐标；导出没有归零、翻转、缩放或替换几何。
- `src/data/model-index.json` 按原始 group ID 索引，提供 `/models/{groupId}.glb`、源包围盒 `[minX,minY,minZ,maxX,maxY,maxZ]`、中文名称、各颜色体 ID 与原始色。
- P01 平台源范围为 `[0,0,100,300,300,110]`。L01–L04 支撑腿的 Z 为 0–100，X01–X04 为 -100–100。选择 20 cm 腿后，前端整体向上补偿 100 mm 才能让脚底保持地面位置。
- 套餐组合的各个 group 直接保留相对位置；前端统一减去 `catalog.ts` 中的套餐 `origin`，再旋转、平移。不要逐零件分别居中，否则真实组装关系会消失。
- 原始节点和 mesh 的 glTF `extras` 都包含 `sourcePart`、`sourceGroup`、`colorKey`、`defaultColor`。Three.js `GLTFLoader` 将其暴露为 `mesh.userData`，便于按零件或原颜色体调整颜色。
- GLB 用标准位置、法线和三角索引，不需要 Draco、Meshopt 或外部 CDN 解码器；每组独立文件，适合懒加载和缓存。
- 虽然标准 glTF 查看器通常假定 Y-up，这些业务资产有意保留模型 Z-up。Three.js 中应将模型放在统一转换父组中，或将 camera/controls 的 up 设置为 Z。Blender 生成缩略图时显式撤销导入器的轴转换。

## 轻量化与验证

原始 V4 模型为 42 组、48 个颜色体，共 906,924 个三角形。网页版本仍为相同的 42 组、48 个颜色体，保留磁孔、接合结构、房屋、楼梯和管道几何，总计 295,514 个三角形，GLB 总大小 7,064,392 字节（约 7.06 MB）。

密集曲面的三角划分使用保守 QEM 简化；小于 3,200 三角形的颜色体直接保留。每次简化检查包围盒、体积及确定性采样的最近面距离，超限时保留原网格。法线按 40° 分开锐边，使板面与圆角正确着色。材质源颜色由 sRGB 转换成 glTF 所需线性值。

本次导出验证：

- 全部 42 个 GLB 重新加载成功，顶点和三角索引有效，节点原零件编号一致。
- 导出网格与源包围盒最大差异为 **0.002899 mm**。
- 每个参与简化的颜色体最多抽取 1,600 个原始顶点，采样最近面距离最大为 **0.017028 mm**。
- 体积相对差异最大为 **0.022495%**。

采样误差不是完整 Hausdorff 距离证明；网页资产用于选购预览，不能替代原始生产文件。磁吸匹配仍以正式模型磁铁坐标数据计算，不根据简化后的三角网格推断。

`public/models/validation.json` 保存源文件 SHA-256、版本、每个颜色体简化前后面数和验证指标。

## 商品缩略图

`public/thumbnails/{productId}.png` 与 `base.png` 使用同一批真实 GLB 组合经 Blender 渲染，有透明背景，可直接放在奶油色卡片上。没有加入套餐外部件。商品图直接读取 `catalog.ts` 的 `COLORS`、各零件 `defaultColor`、`SOURCE_TRIM_COLORS` 和 `PRIMARY_COLOR_KEYS`，与交互画面的八色库存及默认配色保持一致。主颜色体使用零件默认色，其余装饰色使用同一八色板的映射；G05 楼梯主色明确采用红色源颜色体。默认色已恢复并精确保留源模型的 Snow `#F1EADB`、PineGreen `#174A3A`、ChristmasRed `#B8273C`、Gold `#C99B46`，再增加四种可选色。几何仍完全来自原 GLB。相机按投影后的模型范围自动留白，避免方糖屋等较高模型被裁切。

V4 共生成 15 张 480 × 400 RGBA 商品图，透明边界检查全部通过，无模型裁切。商品图合计 1,767,598 字节；GLB 与商品图合计 8,831,990 字节（约 8.83 MB）。每个主色与饰色的默认映射均与源颜色体的 hex 精确一致。

## 重新生成

使用 Python 3.11 或更新版本：

```sh
python3 -m pip install numpy trimesh fast-simplification rtree pillow
python3 scripts/prepare-models.py --source '/absolute/path/to/assembly_meshes.json'
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
