import { fixedDoorPair } from './fixed-door-variants';
/** Buyer-facing copy: manufacturing claims are kept separate from resin feedstock facts. */
export const PRODUCT_INTROS: Record<string, string> = {
  base: 'PLA平台为仓鼠划分活动空间，内嵌不锈钢片，可吸附配件底部圆形强磁，可选连通孔，搭配向下管道连接垫料。',
  cover: '选择开洞连接垫料空间，或封闭此处保留完整平台。',
  villa: 'PLA礼物盒小屋集躲藏、登高与休息于一体，平台、楼梯和草丛配套组装，底部强磁吸附固定。',
  'roof-cottage': 'PLA帽子小屋为仓鼠提供隐蔽休息角落，窗洞方便观察，底部圆形强磁吸附平台钢片。',
  'l-house': 'PLA转角小屋留出穿行与躲藏空间，顶盖可取下整理，底部圆形强磁吸附平台钢片。',
  'cube-house': 'PLA方糖小屋适合独处与短暂停留，可拆顶盖方便检查，底部圆形强磁吸附平台钢片。',
  'pipe-st1': 'PLA直管道让仓鼠练习钻行与探索，搭配支撑底座组装，通过底部圆形强磁固定。',
  'pipe-st2': 'PLA侧开口直管道增加进出路线，侧窗方便观察探索，管道与支撑配套，底部强磁固定。',
  'pipe-lt2n': 'PLA弯管道为探索路线增加转角，封闭管壁提供遮蔽感，搭配支撑底座磁吸固定。',
  'pipe-lt2': 'PLA顶开口弯管道兼顾转弯与探头张望，顶部留出入口，管道与支撑底座配套磁吸固定。',
  'pipe-tt2': 'PLA顶开口三通让仓鼠从多个方向进出，顶部方便探头观察，管道搭配底座磁吸固定。',
  'pipe-tt1': 'PLA三通把三条探索路线连在一起，为仓鼠提供分岔选择，搭配支撑底座磁吸固定。',
  'pipe-down': 'PLA向下管道连接平台与垫料区，内壁防滑棱辅助攀行，嵌入圆洞固定，无需另装磁铁。',
  planter: 'PLA袜子花圃为平台增添探索角落，可搭配布置藏食区域，底部单颗圆形强磁灵活固定。',
  'food-bowl': 'PLA方块食盆集中放置日常干粮，矮沿便于取食，底部圆形强磁支持原位或边角吸附，取下方便擦洗。',
  pool: 'PLA圆形泳池可作浴沙或探索盆，嵌入平台大圆孔固定，整盆可取出整理，不用于水浴。',
  'urine-tray-aite': 'PLA尿砂盆为仓鼠提供如厕角落，弧形低口方便进出，全圆角便于擦洗，自由放入合适房间，整盆取出整理。',
  seesaw: 'PLA跷跷板让仓鼠体验起伏探索，防滑棱辅助行走，四点磁吸底座固定，板面与底座可分色。',
  'milk-house-left': 'PLA左门奶糖小屋提供宽敞躲藏空间，顶盖可拆方便整理，底部圆形强磁吸附平台钢片。',
  'milk-house-right': 'PLA奶糖小屋提供躲藏休息空间，固定门墙，顶盖可拆方便整理，底部强磁固定。',
  'milk-house-aite': 'PLA双室小屋方便分区休息与穿行，固定门墙，顶盖可拆方便整理，底部强磁固定。',
  'milk-house-double-2x3': 'PLA六格双室小屋以拱门连接两室，固定门墙分左右款，顶盖可拆，底部强磁吸附平台钢片。',
  'milk-house-double': 'PLA奶糖二居室便于分区休息与穿行，固定门墙分左右款，可拆顶盖方便整理，底部强磁固定。',
  'sag-bridge': 'PLA吊桥连接两个同高屋顶，让仓鼠跨越探索，两端对齐屋顶磁吸位固定，需双侧支撑。',
  'pokemon-center': 'PLA宝可梦中心提供躲藏与穿行空间，顶盖可拆，底部强磁固定；上下层窗片均为半透明蓝色PETG。',
};
for (const [shape, label] of [['straight','直行'],['left','左转'],['right','右转']] as const)
  for (const size of [1,2]) PRODUCT_INTROS[`stairs-${shape}-${size}`] = `PLA${label}三阶台阶辅助仓鼠登高，圆角与防滑台面便于行走，底部圆形强磁固定。`;
const legacyPipes: Record<string,string> = { 'pipe-st3':'pipe-st1', 'pipe-lt1':'pipe-lt2n', 'pipe-lt3':'pipe-lt2n' };
export function productIntroduction(id: string): string {
  return PRODUCT_INTROS[legacyPipes[id] ?? fixedDoorPair(id)?.right ?? id] ?? 'PLA组件为仓鼠增添探索空间，按照对应安装位置组装，取下后可单独整理与擦洗。';
}
export const MATERIAL_NOTE = '主体采用PLA。PLA通常由玉米、甘蔗等植物糖制成，具体原料来源以耗材供应商说明为准。';
export const CARE_NOTE = '日常污渍及时用湿布擦拭，必要时用常温水清洗并充分晾干，避免热水、洗碗机和长期浸泡。不是啃咬玩具；发现碎屑、裂损或磁铁松动时请移走更换。';
