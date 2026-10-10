# HamilyMart 模型资产来源与维护

## 当前正式源

网站正式源零件使用 `unified_complete_steel_v12/assembly_meshes.json`，与同目录完整 Steel V12 3MF 共用实际几何；额外派生的 30 cm 腿见下文：

```
/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_steel_v12/
```

源版本为 `Steel receivers V12 print-in-place seesaw`，输入为 schema 3 的 `groups[].components[].vertices/triangles`。导出使用装配坐标，不使用打印排盘坐标。完整打印套装有 45 个零件、52 个颜色体、11 个盘；网站现有商品目录使用其中 44 个零件、51 个颜色体。LT2NT 无顶部开孔弯管保留在正式 3MF 中，尚未列入网站商品目录。

`public/models/validation.json` 记录主源 SHA-256、版本、每组实际来源及简化指标。O01 食盆已改用正式 V12 单磁铁件，不再从历史 V30 导入。

正式工程 `磁吸泳池别墅_钢片12x2_磁铁8x4_V12_H2C.3mf` 的 SHA-256 为 `8a4aab33c450d940cc38b20b05c91665c8052bb7bd3f4f1168b8136bbc035ec6`。本次网站更新不改写该打印文件；切片与打印检查来自其 `delivery_validation.json`，记录原生切片无警告、尚未实物打印验证。

## 钢片接收面与单磁铁配件

V12 接收面使用 Ø12×2 mm 钢片，CAD 腔为 Ø12.2×2 mm，封闭接触面覆盖 0.4 mm，表面为平面，取消中心凹点。P01 顶面 32 片、底部 4 片，H06 大圆盖 4 片，A02 二层平台 7 片，LHR 顶盖 4 片，共 51 片。配件仍使用 Ø8×4 mm 磁铁、Ø8.2×4.2 mm 孔，完整选配套装共 41 枚磁铁，包含备用长腿和替换食盆；这不是任意网页搭配的五金数量。

六个管道支撑 ST1B、ST2B、ST3B、LT1B、LT2B、LT3B 均无侧面磁孔，底部十二个磁孔与顶部定位槽保留。网页继续按底部位置、实体碰撞、相邻管道端面方向校验，不再限制侧面磁极。

G06 圣诞袜花圃、O01 圣诞食盆各有一个底磁孔，共用二层接触点 `(285.5,264,200)`。这两个商品及 SS01 跷跷板允许单点磁吸，其他磁吸商品仍要求至少两个接触点。食盆保留红白配色和 55×60×21 mm 外形，平底加厚至 5.4 mm，磁孔之上留下 1.2 mm 完整底面。食盆与花圃在二层共用同一点位时互斥；一层可分别使用未占用的磁位。

## 跷跷板与本次同步差异

新增 SS01 磁吸跷跷板，网站商品 ID `seesaw`，SKU `HM-TY-001`，暂定 ¥39，追加到原商品数组末尾以保留 HM3 编码索引。原色 Gold `#C99B46`，装配尺寸 180×80×31.6 mm，底部正中心磁孔为 `(90,90)`，接触面 Z=110 mm；旧 V11 偏心磁孔不再使用。磁铁 Ø8×4 mm、开放磁孔 Ø8.2×4.2 mm，允许在任意一层平台真实磁位吸附并作四方向旋转，仍需通过占位和碰撞校验。

SS01 GLB 使用源中立姿态；网站保守碰撞盒使用 `[0,50,110,180,130,159.8]`，为 ±11.9° 摆动最高约 49.8 mm 留出空间。源中一件两活动实体，网页作为不可拆售的整体。读取 V12 `seesaw_validation.json` 核验轴、摆幅和磁孔，另对复制的打印 STL 运行 Bambu 分析：水密、法线一致、两实体均接触床面、无悬空，未发生网格修复；未改写生产文件，实际活动配合尚未实物测试。

本次把 V12 与上次 V9 源的组件 vertices、triangles 和颜色逐项对比，只有 G05 楼梯及新增 SS01 的实际几何发生变化，其他源组仅元数据路径变化。其余 42 个网站 GLB 复用相同几何，并在 validation provenance 中标记 `geometryUnchangedFrom: unified_complete_steel_v9`；G05/SS01 重新导出，礼物盒套餐和跷跷板商品图重新渲染。Y01–Y04 使用 V12 原样 X 腿重新派生。

## 五角星与独立配色

A01 使用 V12 的五角星实际几何，约 35.678×3.4×34.012 mm，源组件如下：

| 组件 | 含义 | 源色 | 网站默认色 |
| --- | --- | --- | --- |
| A01_PineGreen | 房体 | PineGreen `#174A3A` | 松绿 |
| A01_Gold | 十字丝带 | Gold `#C99B46` | 金黄 |
| A01_ChristmasRed | 五角星 | ChristmasRed `#B8273C` | 金黄（沿用用户要求） |

所有源色均保留在可选颜色中，GLB extras 保存原始源色。网站按源颜色体 ID 映射独立颜色槽，交互画面与商品图共用 `getSourceColorSlot`。星星沿用内部 `A01-bow` 键及原颜色数组位置，界面显示“五角星”；旧装饰颜色继续使用，丝带独立改色。

## 圣诞帽与草栏尺寸

G03 完全同步 V12 的 **162×118.4×173.333 mm** 几何，不继续使用旧网站的 136 mm 派生版。底孔中心为 `(5,192,200)`、`(5,286,200)`、`(151,192,200)`、`(151,286,200)`，孔距 146×94 mm；二层 A02 四点匹配。一层平台没有任何相应的两孔组合，因此不能按旧版的双层兼容规则安装。

业务 origin 保持 `[78,239,200]`，装配 bounds 为 `[-3,179.60000610351562,200,159,298,373.3333435058594]`。`scripts/derive-g03-dual-floor.py` 仅保存旧 V4 的历史派生过程，不用于当前 V12 导出。

A02 草栏插槽向内移动：后侧、左侧各 0.8 mm，右侧 0.4 mm，外侧连续壁厚增至 1.2 mm。G15/G16/G17 草片及插片同步移动，转角留 0.2 mm 间隔；数量仍为后侧 3 个、左右各 2 个插片。网站保持平台和三片草栏的源装配相对坐标。

## 坐标、材质和简化

- 所有 GLB 保持毫米、Z 向上的源世界坐标。套餐的组保留相对位置；前端统一减去套餐 `origin` 再旋转和平移，不逐零件居中。
- P01 平台 Z 为 100–110 mm；L01–L04 腿为 0–100 mm，X01–X04 为 -100–100 mm。选择长腿后整套向上补偿 100 mm。
- `model-index.json` 保存 group ID、URL、bounds、组件 ID 与源色。节点和 mesh extras 含 `sourcePart/sourceGroup/colorKey/defaultColor`，有源色槽时另含 `colorSlot`。
- Three.js 读取 extras 进行独立配色。Blender 渲染商品图时撤销 glTF 导入器的 Y-up 轴转换。
- GLB 无需外部解码器。材质颜色从 sRGB 转为 glTF 线性值，40° 锐边分裂用于保留硬表面。
- 小于 3,200 面的颜色体保留原网格；密集网格使用保守 QEM 简化。包围盒或最多 1,600 个确定性顶点样本到面距离误差超过 0.06 mm，或相对体积误差超过 0.1%，则使用原网格。

简化检查是抽样验证，不是完整 Hausdorff 距离证明。网页模型仅用于选购预览，生产使用正式 3MF；磁吸位置由正式孔位数据决定。

## 30 cm 腿的网页派生

当前模型索引额外包含 Y01–Y04，共 48 组、55 个颜色体。运行 `python3 scripts/prepare-tall-legs.py` 从 V12 的 20 cm 腿延长中段生成；保留两端形状及磁座，总长 300 mm，网格水密。每件 provenance 标明 `derivedFrom` 和 `production3mfIncluded:false`，不把它认作原 V12 生产套装的一部分。

## 重新生成网站资产

安装所需的 Python 库后，从已批准的 Steel V12 源更新当前目录使用的全部组：

```sh
python3 - <<'PYTHON'
import json, subprocess
from pathlib import Path
ids = [id for id in json.loads(Path('src/data/model-index.json').read_text()) if not id.startswith('Y0')]
subprocess.run(['python3', 'scripts/prepare-models.py', '--only', *ids, '--thumbnails'], check=True)
subprocess.run(['python3', 'scripts/prepare-tall-legs.py'], check=True)
PYTHON
```

`--source` 可显式指定正式 `assembly_meshes.json`；仅当主源缺少 O01 时，`--food-bowl-source` 才用于补充历史食盆；主源自带 O01 时优先使用正式件。`--only A01 ST1B` 可局部更新，保留其他 GLB 和来源记录。省略 `--only` 会导出完整源中所有组（包括尚未上架的 LT2NT），更新商品目录时应一起检查测试与索引覆盖。

仅重新渲染已有 GLB（可用 `--thumbnail-products villa seesaw` 限制到受影响的商品）：

```sh
python3 scripts/prepare-models.py --thumbnails-only
```

商品图由真实套餐 GLB、`catalog.ts` 的库存色和默认色槽经 Blender 渲染，透明背景 480×400，镜头按实际投影范围留白。修改模型后应同时更新商品图。新增产品在 `catalog.ts` 配置组合和真实接口，无需在缩略图脚本重复维护列表。
