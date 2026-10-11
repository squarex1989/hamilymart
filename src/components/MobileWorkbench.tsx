import { useEffect, useRef } from "react";
import { ArrowLeft, Check, Plus, Undo2, Redo2 } from "lucide-react";
import { AVAILABLE_COLORS, canonicalColorId, getColorSwatch, getProduct } from "../data/catalog";
import type { ColorId, ProductPart } from "../data/catalog";
import { getPlatforms } from "../lib/assembly";
import type { AssemblyState, PlatformId } from "../lib/assembly";
import ProductThumbnail from "./ProductThumbnail";
import "./mobile-workbench.css";

const categories = [["all", "全部"], ["house", "小屋"], ["pipe", "管道"], ["facility", "设施"]];
export type WorkbenchProps = {
  state: AssemblyState;
  styleIndex: number;
  ready: boolean;
  selectedId: string | null;
  title: string;
  products: ReturnType<typeof getProduct>[];
  parts: ProductPart[];
  colorPart: string;
  currentColor: ColorId;
  category: string;
  canUndo: boolean;
  canRedo: boolean;
  editingPlatform: boolean;
  platformId: PlatformId | null;
  onCategory: (id: string) => void;
  onSelect: (id: string | null) => void;
  onAdd: (id: string) => void;
  onColorPart: (id: string) => void;
  onColor: (id: ColorId) => void;
  onLegHeight: (height: AssemblyState["legHeight"]) => void;
  onRestoreCover: (platform: PlatformId, cover: string) => void;
  onUndo: () => void;
  onRedo: () => void;
};

/** A dedicated touch rail, separate from the desktop catalog and pointer-drag flow. */
export default function MobileWorkbench(props: WorkbenchProps) {
  const rail = useRef<HTMLDivElement>(null);
  const currentColor = canonicalColorId(props.currentColor);
  const platforms = getPlatforms(props.state);
  const platform = platforms.find(p => p.id === props.platformId);
  const editing = !!props.selectedId;
  const hasPool = platforms.some(p => p.baseInsert === "pool");
  useEffect(() => { rail.current?.scrollTo({ left: 0 }); }, [props.category]);
  return <aside className={`mobile-workbench ${editing ? "is-editing" : ""}`} aria-label="移动端组件工作台">
    <header className="mobile-dock-header">
      {editing ? <button onClick={() => props.onSelect(null)}><ArrowLeft size={18} /><span>返回</span></button> :
        <div className="history-actions"><button onClick={props.onUndo} disabled={!props.canUndo} aria-label="后退一步"><Undo2 size={18} /></button><button onClick={props.onRedo} disabled={!props.canRedo} aria-label="前进一步"><Redo2 size={18} /></button></div>}
      <strong>{editing ? props.title : "给小家添点喜欢"}</strong>
      <span aria-hidden="true" />
    </header>
    {editing ? <div className="mobile-edit-body">
      {props.editingPlatform && <div className="mobile-leg-options">
        <span>腿高</span><div>{([0, 100, 200, 300] as const).map(height => <button key={height} aria-pressed={props.state.legHeight === height} disabled={height === 0 && hasPool} title={height === 0 && hasPool ? "泳池需要支撑脚" : undefined} onClick={() => props.onLegHeight(height)}>{height === 0 ? "无腿" : `${height / 10} cm`}</button>)}</div>
      </div>}
      <div className="mobile-part-rail" aria-label="选择换色部位">
        {props.parts.map(part => <button key={part.id} aria-pressed={props.colorPart === part.id} onClick={() => props.onColorPart(part.id)}>{/^[LXY]01$/.test(part.id) ? "支撑脚" : part.role}</button>)}
      </div>
      <div className="mobile-color-rail" aria-label="可选颜色">
        {AVAILABLE_COLORS.map(color => <button key={color.id} className={currentColor === color.id ? "selected" : ""} aria-label={color.name} aria-pressed={currentColor === color.id} onClick={() => props.onColor(color.id)}>
          <span className="mobile-color-chip" style={{ background: getColorSwatch(color.id) }}>{currentColor === color.id && <Check size={16} />}</span><small>{color.name}</small>
        </button>)}
      </div>
      {props.editingPlatform && !!platform?.removedCovers.length && <div className="mobile-cover-options"><div>{platform.removedCovers.map(id => <button key={id} onClick={() => props.onRestoreCover(platform.id, id)}><Plus size={15} />放回小圆盖 {Number(id.slice(-1))}</button>)}</div></div>}
    </div> : <>
      <div className="mobile-product-rail" ref={rail} aria-label="横滑挑选配件">
        {props.products.map(product => <button className="mobile-product" key={product.id} disabled={!props.ready} onClick={() => props.onAdd(product.id)}>
          <span className="mobile-product-picture"><ProductThumbnail productId={product.id} styleIndex={props.styleIndex} /></span><strong>{product.name}</strong><small className="mobile-product-price">¥{product.price / 100}</small>
        </button>)}
      </div>
      <nav className="mobile-category-bar" aria-label="配件分类">
        {categories.map(([id, name]) => <button key={id} aria-pressed={props.category === id} onClick={() => props.onCategory(id)}>{name}</button>)}
      </nav>
    </>}
  </aside>;
}
