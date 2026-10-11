import { ArrowLeft, Check, Plus, Undo2, Redo2 } from "lucide-react";
import { AVAILABLE_COLORS, canonicalColorId, COLORS, getColorSwatch } from "../data/catalog";
import { getPlatforms } from "../lib/assembly";
import type { WorkbenchProps } from "./MobileWorkbench";
import ProductThumbnail from "./ProductThumbnail";

type Props = WorkbenchProps & { onStartDrag: (id: string, event: React.PointerEvent<HTMLButtonElement>) => void };
const money = (value: number) => `¥${(value / 100).toFixed(2)}`;
export default function DesktopWorkbench(props: Props) {
  const currentColor = canonicalColorId(props.currentColor);
  const platforms = getPlatforms(props.state);
  const platform = platforms.find(p => p.id === props.platformId);
  const hasPool = platforms.some(p => p.baseInsert === "pool");
  return <aside className="desktop-workbench-v2" aria-label="桌面组件工作台">
    <header className="desktop-dock-heading">
      {props.selectedId ? <button className="back-to-catalog" onClick={() => props.onSelect(null)}><ArrowLeft size={17} />返回</button> : <div className="history-actions"><button aria-label="后退一步" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={18} /></button><button aria-label="前进一步" disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={18} /></button></div>}
      <strong>{props.selectedId ? props.title : "给小家添点喜欢"}</strong>
    </header>
    {props.selectedId ? <div className="desktop-component-editor">
      {props.editingPlatform && <section className="desktop-leg-options"><h3>支撑脚高度</h3><div>{([0, 100, 200, 300] as const).map(height => <button key={height} aria-pressed={props.state.legHeight === height} disabled={height === 0 && hasPool} title={height === 0 && hasPool ? "泳池需要支撑脚" : undefined} onClick={() => props.onLegHeight(height)}>{height === 0 ? "无腿" : `${height / 10} cm`}</button>)}</div></section>}
      <div className="desktop-part-options" aria-label="选择换色部位">{props.parts.map(part => <button key={part.id} aria-pressed={props.colorPart === part.id} onClick={() => props.onColorPart(part.id)}>{/^[LXY]01$/.test(part.id) ? "支撑脚" : part.role}</button>)}</div>
      <div className="desktop-color-options" aria-label="可选颜色">{AVAILABLE_COLORS.map(color => <button key={color.id} aria-label={color.name} aria-pressed={currentColor === color.id} onClick={() => props.onColor(color.id)}><span style={{ background: getColorSwatch(color.id) }}>{currentColor === color.id && <Check size={16} />}</span><small>{color.name}</small></button>)}</div>
      <p className="desktop-color-name">{COLORS.find(c => c.id === currentColor)?.name}</p>
      {props.editingPlatform && !!platform?.removedCovers.length && <div className="restore-covers">{platform.removedCovers.map(id => <button key={id} onClick={() => props.onRestoreCover(platform.id, id)}><Plus size={14} />放回小圆盖 {Number(id.slice(-1))}</button>)}</div>}
    </div> : <div className="desktop-catalog-scroll">
      <nav className="category-tabs" aria-label="配件分类">{[["all", "全部"], ["house", "小屋"], ["pipe", "管道"], ["facility", "设施"]].map(([id, label]) => <button key={id} aria-pressed={props.category === id} className={props.category === id ? "active" : ""} onClick={() => props.onCategory(id)}>{label}</button>)}</nav>
      <div className="product-grid">{props.products.map(product => <article className="product-card" key={product.id}>
        <button className="product-visual" aria-label={`选择${product.name}`} disabled={!props.ready} onPointerDown={event => props.onStartDrag(product.id, event)} onClick={() => props.onAdd(product.id)}><ProductThumbnail productId={product.id} styleIndex={props.styleIndex} alt={product.name} /></button>
        <div className="product-info"><h3>{product.name}</h3><div><strong>{money(product.price)}</strong><button className="add-button" aria-label={`添加${product.name}`} disabled={!props.ready} onClick={() => props.onAdd(product.id)}><Plus size={17} /></button></div></div>
      </article>)}</div>
    </div>}
  </aside>;
}
