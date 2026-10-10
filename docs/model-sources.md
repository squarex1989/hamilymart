# HamilyMart 模型资产来源与维护

## 当前正式源

网站主体使用 `unified_complete_8x4_v7/assembly_meshes.json`，与同目录的完整 V7 3MF 共用实际几何。完整目录位于：

```
/Users/chachacha/Desktop/3D Printing/泳池别墅/unified_complete_8x4_v7/
```

输入为 schema 3 的 `groups[].components[].vertices/triangles`。导出使用装配坐标，不使用打印排盘坐标。V7 完整打印套装有 43 个零件、49 个颜色体；网站保留当前目录使用的 42 个主体零件及历史 O01 食盆，共 43 个网页组、50 个颜色体。V5 新增的 LT2NT 无上部开孔弯管保留在完整 3MF 中，本次不改变网站商品目录。

`public/models/validation.json` 记录主源 SHA-256、版本、每组实际来源及简化指标。`groups.O01.source` 单独记录历史食盆，不能把它认作统一 8×4 套装零件。

## V7 五角星与管道支撑

A01 礼物盒的蝴蝶结替换为尖端向上的实心黄色五角星，位于原丝带十字交点。重建了原蝴蝶结留在绿墙和丝带中的凹位，避免留下旧装饰轮廓。模型仍由三个独立颜色体组成：

| 组件 | 含义 | 默认颜色 |
| --- | --- | --- |
| A01_PineGreen | 绿色房体 | PineGreen `#174A3A` |
| A01_Gold | 十字丝带 | Gold `#C99B46` |
| A01_StarGold | 五角星 | Gold `#C99B46` |

网页按 `sourcePart` 组件 ID 优先选择颜色槽，不能按相同的 Gold 材质合并。`getSourceColorSlot(groupId, sourcePart, colorKey)` 同时用于交互画面与商品图。五角星沿用内部 `A01-bow` 键及原颜色数组位置，旧搭配编号和本地保存的蝴蝶结颜色会自然应用到五角星；界面名称显示“五角星”。源 CAD 的 `color_slot: A01-star` 是源组件语义，并非网站历史存储键。

六个管道支撑 ST1B、ST2B、ST3B、LT1B、LT2B、LT3B 各取消两个侧面磁吸孔，共 12 个；底部十二个磁吸孔、顶部定位槽与管道配合面保留。LT2NT 共用 LT2B，不重复计数。V7 硬件总数为 92 枚 Ø8×4 mm 磁铁（包含四枚备用长腿磁铁），46 个封闭磁腔与埋磁暂停保持。网站移除了侧面 N/S 磁极限制，保留底部至少两孔匹配、碰撞与相邻端面几何朝向检查。

V7 源包保留生成脚本和几何检查。`assembly_validation.json` 检查装配，`printability_analysis.json` 对七个改变的实体重新分析，其余 36 件仅在打印 STL 字节相同时继承 V6 分析；`3mf_validation.json` 与 `embedded_magnet_validation.json` 对本版重新切片和实际暂停刀路核验。实物打印尚未验证。

## G03 圣诞帽双层兼容几何

V7 保留 V6 的 G03，宽度由旧版 162 mm 缩至 136 mm，前后尺寸和高度保持，实际尺寸约为 **136 × 118.4 × 173.333 mm**。底孔矩形从 146×94 mm 改为 120×94 mm。

- 四孔接触点：`(5,192,200)`、`(5,286,200)`、`(125,192,200)`、`(125,286,200)`。
- 二层 A02 保留最左两个孔 `(5,192)`、`(5,286)`；一层使用 120 mm 横向孔对，例如 `(90,190)`、`(210,190)`。
- 安装只要求两个实际磁位重合，不代表四孔能同时对上两个平台。
- 一层 P01 的 100 mm 格内孔心距边 10 mm，同格孔心距是 80 mm；94 mm 属于二层左侧接口。
- 业务 origin 保持 `[78,239,200]`，装配 bounds 为 `[-3,179.60000610351562,200,133,298,373.3333435058594]`。

原派生过程在 `scripts/derive-g03-dual-floor.py`：只压缩原 x=14..142 mm 中间区域，左右磁座作刚性保留/平移，保留 Ø8.2×4.2 mm 圆孔与入口净空。旧 V4 及派生证据均保留。该脚本仅供从旧 V4 复现历史推导，**不要再对 V6/V7 重复派生**；正常导出直接使用当前正式源中的 G03。

## 圣诞食盆的独立来源

O01 来自 `christmas_villa_v30_pool_cover/assembly_meshes.json`（V30），SHA-256 为 `3d25c19b4a9c6584a12cb06fbf76ce217666a8623638c1b270a8a59796feed9f`。保留红色盆身、白色盆沿和 55×60×21 mm 尺寸，原 bounds 为 `[94.5,96,180,149.5,156,201]`。

其两个底孔中心 `(127,124,180)`、`(141,124,180)` 相距 14 mm，可匹配 A02 花圃磁位；食盆与花圃不能重叠安装。**它仍使用 Ø8×2 mm 磁铁和 Ø8.1×2.1 mm 孔**，未混入当前统一 8×4 mm 打印套装。

## 坐标、材质和简化

- 所有 GLB 保持毫米、Z 向上的源世界坐标。套餐的组保留相对位置；前端统一减去套餐 `origin` 再旋转和平移，不逐零件居中。
- P01 平台 Z 为 100–110 mm；L01–L04 腿为 0–100 mm，X01–X04 为 -100–100 mm。选择长腿后整套向上补偿 100 mm。
- `model-index.json` 保存 group ID、URL、bounds、组件 ID 与源色。节点和 mesh extras 含 `sourcePart/sourceGroup/colorKey/defaultColor`，有源色槽时另含 `colorSlot`。
- Three.js 读取 extras 进行独立配色。Blender 渲染商品图时撤销 glTF 导入器的 Y-up 轴转换。
- GLB 无需外部解码器。材质颜色从 sRGB 转为 glTF 线性值，40° 锐边分裂用于保留硬表面。
- 小于 3,200 面的颜色体保留原网格；密集网格使用保守 QEM 简化。包围盒或最多 1,600 个确定性顶点样本到面距离误差超过 0.06 mm，或相对体积误差超过 0.1%，则使用原网格。

简化检查是抽样验证，不是完整 Hausdorff 距离证明。网页模型仅用于选购预览，生产使用正式 3MF；磁吸位置由正式孔位数据决定。

## 重新生成网站资产

安装所需的 Python 库后，从已批准的 V7 源更新当前目录使用的全部组：

```sh
python3 - <<'PYTHON'
import json, subprocess
from pathlib import Path
ids = list(json.loads(Path('src/data/model-index.json').read_text()))
subprocess.run(['python3', 'scripts/prepare-models.py', '--only', *ids, '--thumbnails'], check=True)
PYTHON
```

`--source` 可显式指定正式 `assembly_meshes.json`；`--food-bowl-source` 可指定历史 O01 源。`--only A01 ST1B` 可局部更新，保留其他 GLB 和来源记录。省略 `--only` 会导出完整源中所有组（包括尚未上架的 LT2NT），更新商品目录时应一起检查测试与索引覆盖。

仅重新渲染已有 GLB：

```sh
python3 scripts/prepare-models.py --thumbnails-only
```

商品图由真实套餐 GLB、`catalog.ts` 的库存色和默认色槽经 Blender 渲染，透明背景 480×400，镜头按实际投影范围留白。修改模型后应同时更新商品图。新增产品在 `catalog.ts` 配置组合和真实接口，无需在缩略图脚本重复维护列表。
