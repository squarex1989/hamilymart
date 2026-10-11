/** Visual variants, not a breeding or animal-care recommendation.
 * Species reference: https://www.merckvetmanual.com/multimedia/table/hamster-breeds-commonly-kept-as-pets
 * Behaviours: https://www.rspca.org.uk/adviceandwelfare/pets/rodents/hamsters/behaviour
 */
export interface HamsterVariant {
  id: string;
  name: string;
  species: string;
  coat: string;
  primary: string;
  secondary: string;
  pattern: "solid" | "banded" | "dorsal" | "panda";
  /** Approximate visual body length in mm. Individual animals vary. */
  size: number;
}
export const HAMSTER_VARIANTS: readonly HamsterVariant[] = [
  { id: "syrian-golden", name: "金丝熊 · 金黄", species: "叙利亚仓鼠（金丝熊）", coat: "金黄", primary: "#C99451", secondary: "#F5E7CF", pattern: "solid", size: 110 },
  { id: "syrian-cream", name: "金丝熊 · 奶油", species: "叙利亚仓鼠（金丝熊）", coat: "奶油", primary: "#E8CCA0", secondary: "#FFF3DC", pattern: "solid", size: 110 },
  { id: "syrian-banded", name: "金丝熊 · 花斑", species: "叙利亚仓鼠（金丝熊）", coat: "棕白花斑", primary: "#A97443", secondary: "#F8F3E8", pattern: "banded", size: 110 },
  { id: "winter-agouti", name: "三线 · 原色", species: "加卡利亚仓鼠（三线）", coat: "灰棕背线", primary: "#938776", secondary: "#F1EBDC", pattern: "dorsal", size: 75 },
  { id: "winter-pearl", name: "三线 · 银狐", species: "加卡利亚仓鼠（三线）", coat: "珍珠白", primary: "#EEEDE7", secondary: "#FFFFFF", pattern: "dorsal", size: 75 },
  { id: "winter-sapphire", name: "三线 · 紫仓", species: "加卡利亚仓鼠（三线）", coat: "蓝灰背线", primary: "#939DAB", secondary: "#EDECE8", pattern: "dorsal", size: 75 },
  { id: "campbell-panda", name: "一线 · 黑白", species: "坎贝尔仓鼠（一线）", coat: "黑白花斑", primary: "#4E4B49", secondary: "#F5F2E8", pattern: "panda", size: 80 },
  { id: "robo-agouti", name: "公婆 · 原色", species: "罗伯罗夫斯基仓鼠（公婆）", coat: "沙金白腹", primary: "#C8AF83", secondary: "#FFF8E8", pattern: "solid", size: 55 },
  { id: "chinese-agouti", name: "中国仓鼠 · 原色", species: "中国仓鼠", coat: "灰棕背线", primary: "#9A8870", secondary: "#EEE3CD", pattern: "dorsal", size: 85 },
];
