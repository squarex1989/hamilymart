import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Layers2, Palette, Plus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { AVAILABLE_COLORS, MODEL_ASSET_VERSION, COLORS, getColorSwatch, getProduct } from "../data/catalog";
import type { ColorId, ProductPart } from "../data/catalog";
import { getPlatforms } from "../lib/assembly";
import type { AssemblyState, PlatformId } from "../lib/assembly";
import "./mobile-workbench.css";

const categories = [["all", "全部"], ["house", "小屋"], ["pipe", "管道"], ["garden", "花园"], ["toy", "玩具"]];
const platformName = (id: string) => id === "base3" ? "第三平台" : id === "base2" ? "第二平台" : "基础平台";
type Product = ReturnType<typeof getProduct>;

type Props = {
  state: AssemblyState;
  ready: boolean;
  saved: boolean;
  selectedId: string | null;
  title: string;
  products: Product[];
  parts: ProductPart[];
  colorPart: string;
  currentColor: ColorId;
  category: string;
  canUndo: boolean;
  canRemove: boolean;
  canRotate: boolean;
  editingPlatform: boolean;
  platformId: PlatformId | null;
  onCategory: (id: string) => void;
  onSelect: (id: string | null) => void;
  onAdd: (id: string) => void;
  onAddPlatform: () => void;
  onColorPart: (id: string) => void;
  onColor: (id: ColorId) => void;
  onRestoreColors: () => void;
  onRotate: () => void;
  onRemove: () => void;
  onLegHeight: (height: AssemblyState["legHeight"]) => void;
  onRestoreCover: (platform: PlatformId, cover: string) => void;
  onUndo: () => void;
};

/** Touch-only workbench. Shares assembly actions, never the desktop control layout. */
export default function MobileWorkbench(props: Props) {
  const [library, setLibrary] = useState<"catalog" | "assembled">("catalog");
  const [editTool, setEditTool] = useState<"color" | "legs" | "covers">("color");
  const rail = useRef<HTMLDivElement>(null);
  const platforms = getPlatforms(props.state);
  const platform = platforms.find(p => p.id === props.platformId);
  const editing = !!props.selectedId;
  const hasPool = platforms.some(p => p.baseInsert === "pool");
  const count = platforms.length + props.state.items.length + platforms.filter(p => p.baseInsert === "pool").length;
  useEffect(() => { setEditTool("color"); }, [props.selectedId]);
  useEffect(() => { rail.current?.scrollTo({ left: 0 }); }, [props.category, library]);
  function finish() { props.onSelect(null); setLibrary("catalog"); }
  return <aside className="mobile-workbench" aria-label="移动端组件工作台">
    <header className="mobile-dock-header">
      {editing || library === "assembled"
        ? <button onClick={editing ? finish : () => setLibrary("catalog")}><ArrowLeft size={18} /><span>返回</span></button>
        : <button onClick={props.onUndo} disabled={!props.canUndo} aria-label="撤销上一步"><RotateCcw size={19} /></button>}
      <strong>{editing ? props.title : library === "assembled" ? `已搭建 · ${count} 组` : "给小家添点喜欢"}</strong>
      {editing
        ? <button className="mobile-save" onClick={finish}><Check size={18} /><span>保存</span></button>
        : <button onClick={() => setLibrary(library === "assembled" ? "catalog" : "assembled")} aria-label={library === "assembled" ? "挑选配件" : `已搭建 ${count} 组`}><Layers2 size={18} /><span>{library === "assembled" ? "配件" : count}</span></button>}
    </header>
    {editing ? <>
      <div className="mobile-edit-body">
        {editTool === "color" && <>
          <div className="mobile-part-rail" aria-label="选择换色部位">
            {props.parts.map(part => <button key={part.id} aria-pressed={props.colorPart === part.id} onClick={() => props.onColorPart(part.id)}>{/^[LXY]01$/.test(part.id) ? "支撑脚" : part.role}</button>)}
          </div>
          <div className="mobile-color-rail" aria-label="可选颜色">
            {AVAILABLE_COLORS.map(color => <button key={color.id} className={props.currentColor === color.id ? "selected" : ""} aria-label={color.name} aria-pressed={props.currentColor === color.id} onClick={() => props.onColor(color.id)}>
              <span className="mobile-color-chip" style={{ background: getColorSwatch(color.id) }}>{props.currentColor === color.id && <Check size={16} />}</span><small>{color.name}</small>
            </button>)}
          </div>
          <span className="mobile-color-caption">{COLORS.find(color => color.id === props.currentColor)?.name} · {props.saved ? "已保存在此设备" : "未能保存，请复制编号"}</span>
        </>}
        {editTool === "legs" && <div className="mobile-leg-options">
          <p>支撑脚 · {platforms.length} 个平台同步</p>
          <div>{([0, 100, 200, 300] as const).map(height => <button key={height} aria-pressed={props.state.legHeight === height} disabled={height === 0 && hasPool} onClick={() => props.onLegHeight(height)}>{height === 0 ? "无腿" : `${height / 10} cm`}</button>)}</div>
          <small>{hasPool ? "泳池需要支撑脚；" : ""}腿长与垫料高度独立设置</small>
        </div>}
        {editTool === "covers" && <div className="mobile-cover-options">
          <p>点画面中的小圆盖，可以移除留洞</p>
          <div>{platform?.removedCovers.map(id => <button key={id} onClick={() => props.onRestoreCover(platform.id, id)}><Plus size={15} />放回小圆盖 {Number(id.slice(-1))}</button>)}</div>
          {!platform?.removedCovers.length && <small>当前小圆盖均已装好</small>}
        </div>}
      </div>
      <nav className="mobile-edit-tools" aria-label="组件编辑工具">
        <button aria-pressed={editTool === "color"} onClick={() => setEditTool("color")}><Palette size={19} /><span>配色</span></button>
        {props.editingPlatform && <button aria-pressed={editTool === "legs"} onClick={() => setEditTool("legs")}><Layers2 size={19} /><span>支撑脚</span></button>}
        {props.editingPlatform && <button aria-pressed={editTool === "covers"} onClick={() => setEditTool("covers")}><span className="cover-tool-icon" /><span>圆盖</span></button>}
        {props.canRotate && <button className="mobile-rotate" onClick={props.onRotate}><RotateCw size={19} /><span>旋转</span></button>}
        <button className="mobile-original" onClick={props.onRestoreColors}><Palette size={19} /><span>原配色</span></button>
        {props.canRemove && <button className="mobile-remove" onClick={props.onRemove}><Trash2 size={18} /><span>移除</span></button>}
      </nav>
    </> : <>
      <div className="mobile-product-rail" ref={rail} aria-label={library === "catalog" ? "横滑挑选配件" : "横滑查看已搭建组件"}>
        {library === "catalog" ? <>
          {props.category === "all" && <button className="mobile-product mobile-add-platform" disabled={platforms.length >= 3} onClick={props.onAddPlatform}>
            <span className="mobile-product-picture"><Layers2 size={35} /><Plus size={19} /></span><strong>增加平台</strong><small>{platforms.length} / 3 块 · 向右贴边</small>
          </button>}
          {props.products.map(product => <button className="mobile-product" key={product.id} disabled={!props.ready} onClick={() => props.onAdd(product.id)}>
            <span className="mobile-product-picture"><img src={`/thumbnails/${product.id}.png?v=${MODEL_ASSET_VERSION}`} alt="" draggable={false} /></span><strong>{product.name}</strong><small>{product.parts.length > 1 ? `${product.parts.length} 件套装` : "磁吸配件"}</small>
          </button>)}
        </> : <>
          {platforms.flatMap(p => [<button className="mobile-product" key={p.id} onClick={() => props.onSelect(p.id)}>
            <span className="mobile-product-picture"><img src={`/thumbnails/base.png?v=${MODEL_ASSET_VERSION}`} alt="" draggable={false} /></span><strong>{platformName(p.id)}</strong><small>{props.state.legHeight === 0 ? "无腿" : `${props.state.legHeight / 10} cm 支撑脚`}</small>
          </button>, ...(p.baseInsert === "pool" ? [<button className="mobile-product" key={`pool:${p.id}`} onClick={() => props.onSelect(`pool:${p.id}`)}>
            <span className="mobile-product-picture"><img src={`/thumbnails/pool.png?v=${MODEL_ASSET_VERSION}`} alt="" draggable={false} /></span><strong>圣诞泳池</strong><small>{platformName(p.id)}</small>
          </button>] : [])])}
          {props.state.items.map(item => <button className="mobile-product" key={item.id} onClick={() => props.onSelect(item.id)}>
            <span className="mobile-product-picture"><img src={`/thumbnails/${item.productId}.png?v=${MODEL_ASSET_VERSION}`} alt="" draggable={false} /></span><strong>{getProduct(item.productId).name}</strong><small>{item.rotation}°</small>
          </button>)}
        </>}
      </div>
      <nav className="mobile-category-bar" aria-label="配件分类">
        {categories.map(([id, name]) => <button key={id} aria-pressed={library === "catalog" && props.category === id} onClick={() => { setLibrary("catalog"); props.onCategory(id); }}>{name}</button>)}
      </nav>
    </>}
  </aside>;
}
