import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, Copy, Info, Layers2, Link, Plus, Ruler, ShoppingBag, Sparkles, Trash2, X } from "lucide-react";
import AssemblyScene from "./components/AssemblyScene";
import MobileWorkbench from "./components/MobileWorkbench";
import type { WorkbenchProps } from "./components/MobileWorkbench";
import DesktopWorkbench from "./components/DesktopWorkbench";
import { COLOR_STYLES, applyColorStyle, getProductStyleColors } from "./lib/color-styles";
import { colorNewAdditions, createCatalogStyleHint, restoreCatalogStyle, type StyledAssemblySnapshot } from "./lib/catalog-style";
import type { SceneHandle } from "./components/AssemblyScene";
import {
  COLORS,
  COLOR_SLOTS,
  VISIBLE_PRODUCTS,
  getBaseParts,
  getProduct,
  getEditableProductColorParts,
  resolveLinkedProductColors,
  setProductColor,
} from "./data/catalog";
import { FEATURES } from "./data/features";
import type { ColorId, Rotation } from "./data/catalog";
import {
  addPlatform,
  autoPlace,
  createInitialState,
  getPlatforms,
  getOrderLines,
  getTotalPrice,
  migrateAssembly,
  removeItem,
  removePlatform,
  rotateItem,
  setBedding,
  setPlatformColors,
  setCoverRemoved,
  setLegHeight,
  setPlatformPool,
  tryPlace,
} from "./lib/assembly";
import type { ActionResult, AssemblyState, Bedding, PlatformId } from "./lib/assembly";
import { decodeConfigWithMigration, encodeConfig } from "./lib/config-code";

const STORAGE = "hamilymart.assembly.v2";
const STYLE_STORAGE = "hamilymart.catalog-style.v1";
const platformName = (id: string) => id === "base3" ? "第三平台" : id === "base2" ? "第二平台" : "基础平台";
const HOUSE_ORDER = ["villa", "roof-cottage", "l-house", "cube-house"];
const money = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(cents / 100);
function initial() {
  let original: string | null = null;
  try {
    original = localStorage.getItem(STORAGE);
    const result = original
      ? migrateAssembly(JSON.parse(original))
      : { state: createInitialState(), messages: [] };
    let styleHint: string | null = null;
    try { styleHint = localStorage.getItem(STYLE_STORAGE); } catch { /* Optional UI preference. */ }
    return { ...result, recovery: null, styleIndex: restoreCatalogStyle(result.state, encodeConfig(result.state), styleHint) };
  } catch (error) {
    return {
      state: createInitialState(),
      messages: [
        `本地搭配暂时无法载入：${error instanceof Error ? error.message : "存档读取失败"}。原存档已保留，你也可以粘贴搭配编号恢复。`,
      ],
      recovery: original,
      styleIndex: 0,
    };
  }
}
function HamsterMark() {
  return (
    <svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="13" cy="14" r="8" fill="currentColor" />
      <circle cx="35" cy="14" r="8" fill="currentColor" />
      <rect x="5" y="12" width="38" height="32" rx="16" fill="currentColor" />
      <circle cx="17" cy="26" r="2.5" fill="#f8f5e9" />
      <circle cx="31" cy="26" r="2.5" fill="#f8f5e9" />
      <path d="M21 32h6l-3 4z" fill="#f8f5e9" />
      <path
        d="M7 31H2m5 4H3m38-4h5m-5 4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function useMobileWorkbench() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 1024px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 1024px)");
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

export default function App() {
  const mobile = useMobileWorkbench();
  const [startup] = useState(initial);
  const [state, setState] = useState<AssemblyState>(startup.state),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState(startup.messages.join(" "));
  const [activeProduct, setActiveProduct] = useState<string | null>(null),
    [rotation, setRotation] = useState<Rotation>(0);
  const [category, setCategory] = useState("all");
  const [showDimensions, setShowDimensions] = useState(false);
  const [modal, setModal] = useState<"code" | "order" | "bedding" | "clear" | null>(null);
  const [importCode, setImportCode] = useState(""),
    [importError, setImportError] = useState(""),
    [toast, setToast] = useState("");
  const [ready, setReady] = useState(false),
    [colorPart, setColorPart] = useState("P01"),
    [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<StyledAssemblySnapshot[]>([]);
  const [future, setFuture] = useState<StyledAssemblySnapshot[]>([]);
  const [styleIndex, setStyleIndex] = useState(startup.styleIndex);
  const dragFinishedAt = useRef(0);
  const scene = useRef<SceneHandle>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    codeField = useRef<HTMLTextAreaElement>(null);
  const configurationCode = useMemo(() => encodeConfig(state), [state]);
  const orderLines = useMemo(() => getOrderLines(state), [state]);
  const total = getTotalPrice(state);
  const platforms = getPlatforms(state);
  const selectedCover = selectedId?.startsWith("cover:") ? selectedId.split(":")[2] : null;
  const selectedPool = selectedId?.startsWith("pool:") ?? false;
  const selectedPlatformId = (selectedId === "base" || selectedId === "base2" || selectedId === "base3"
    ? selectedId : selectedCover || selectedPool ? selectedId!.split(":")[1] : null) as PlatformId | null;
  const selectedPlatform = platforms.find(p => p.id === selectedPlatformId);
  const editingPlatform = selectedId === "base" || selectedId === "base2" || selectedId === "base3";
  const selectedItem = state.items.find((i) => i.id === selectedId);
  const selectedProduct = selectedItem
    ? getProduct(selectedItem.productId)
    : null;
  const selectedParts =
    selectedPlatform
      ? getBaseParts(state.legHeight, selectedPlatform.baseInsert, selectedPlatform.removedCovers).filter(
          (p) => selectedCover ? p.id === selectedCover : selectedPool ? p.id === "B01" : p.id === "P01" || /^[LXY]01$/.test(p.id),
        )
      : (selectedProduct ? getEditableProductColorParts(selectedProduct.id) : []);
  const selectedColors =
    selectedPlatform ? selectedPlatform.baseColors : resolveLinkedProductColors(selectedItem?.colors ?? {});
  const colorKey = /^[LXY]01$/.test(colorPart) ? "legs" : colorPart;
  const currentColor =
    selectedColors[colorKey] ??
    selectedParts.find((p) => p.id === colorPart)?.defaultColor ??
    "cream";
  const visibleProducts = VISIBLE_PRODUCTS.filter(
    (p) => category === "all" || p.category === category,
  ).sort((a, b) => (HOUSE_ORDER.includes(a.id) ? HOUSE_ORDER.indexOf(a.id) : 20) - (HOUSE_ORDER.includes(b.id) ? HOUSE_ORDER.indexOf(b.id) : 20));
  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), Math.min(8000, Math.max(2500, message.length * 85)));
  }
  function commit(next: AssemblyState, nextStyleIndex = styleIndex) {
    if (next === state && nextStyleIndex === styleIndex) return;
    setHistory((h) => [...h.slice(-19), { state, styleIndex }]);
    setFuture([]);
    setState(next);
    setStyleIndex(nextStyleIndex);
  }
  function applyAction(result: ActionResult, message?: string) {
    if (!result.ok) { notify(result.reason); return false; }
    commit(result.state);
    if (message) notify(message);
    return true;
  }
  function addProduct(productId: string) {
    if (Date.now() - dragFinishedAt.current < 350) return;
    setActiveProduct(null);
    const result = autoPlace(state, productId, selectedPlatformId ?? undefined);
    if (!result.ok) { notify(result.reason); return; }
    commit(colorNewAdditions(state, result.state, styleIndex));
    if (result.item) select(result.item.id);
    else {
      const addedPool = getPlatforms(result.state).find(p => p.baseInsert === "pool" && platforms.find(old => old.id === p.id)?.baseInsert !== "pool");
      if (addedPool) select(`pool:${addedPool.id}`);
    }
  }
  function addNextPlatform() {
    const result = addPlatform(state);
    if (!result.ok) { notify(result.reason); return; }
    commit(colorNewAdditions(state, result.state, styleIndex));
    select(getPlatforms(result.state).at(-1)!.id);
  }
  function chooseBedding(bedding: Bedding) {
    if (applyAction(setBedding(state, bedding))) setModal(null);
  }
  useEffect(() => {
    try {
      if (startup.recovery) {
        // Preserve unreadable/unsupported data before the user starts a replacement.
        if (state === startup.state) {
          setSaved(false);
          return;
        }
        localStorage.setItem(`${STORAGE}.recovery`, startup.recovery);
      }
      localStorage.setItem(STORAGE, JSON.stringify(state));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [state, startup]);
  useEffect(() => {
    if (startup.recovery && state === startup.state) return;
    try { localStorage.setItem(STYLE_STORAGE, JSON.stringify(createCatalogStyleHint(styleIndex, configurationCode))); }
    catch { /* The design remains saved even if its optional catalog preference cannot be stored. */ }
  }, [configurationCode, styleIndex, state, startup]);
  useEffect(() => {
    setColorPart(selectedParts[0]?.id ?? "P01");
  }, [selectedId, state.legHeight, selectedPlatform?.baseInsert, selectedProduct]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            '.modal button,.modal textarea,.modal input,.modal [tabindex="0"]',
          ),
        ].filter((n) => !n.hasAttribute("disabled"));
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const focus = setTimeout(
      () => document.querySelector<HTMLElement>(".modal button")?.focus(),
      0,
    );
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(focus);
      previous?.focus();
    };
  }, [modal]);
  function select(id: string | null) {
    setSelectedId(id);
    setActiveProduct(null);
    if (id) {
      const item = state.items.find((i) => i.id === id);
      setRotation(item?.rotation ?? 0);
    }
  }
  function drop(
    productId: string,
    point: { x: number; y: number; z: number },
    r: number,
    itemId?: string,
  ) {
    dragFinishedAt.current = Date.now();
    const existing = state.items.find((i) => i.id === itemId);
    const result = tryPlace(
      state,
      productId,
      point,
      r as Rotation,
      existing?.colors ?? getProductStyleColors(productId, styleIndex),
      itemId,
    );
    if (result.ok) {
      commit(result.state);
      select(result.item.id);
      setActiveProduct(null);
    } else {
      notify(result.reason || "这里的磁吸位不匹配，换个位置试试");
    }
  }
  function setColor(color: ColorId) {
    if (selectedPlatform) {
      const colors = { ...selectedPlatform.baseColors, [colorKey]: color };
      if (colorPart === "P01")
        for (const n of [1, 2, 3, 4, 5, 6]) colors[`H0${n}`] = color;
      applyAction(setPlatformColors(state, selectedPlatform.id, colors));
    } else if (selectedItem) {
      commit({
        ...state,
        items: state.items.map((i) =>
          i.id === selectedId
            ? { ...i, colors: setProductColor(i.colors, colorPart, color) }
            : i,
        ),
      });
    }
  }
  function rotateSelected() {
    if (activeProduct) {
      setRotation((r) => ((r + 90) % 360) as Rotation);
      return;
    }
    if (!selectedItem) return;
    const attempts = ([90, 180, 270] as Rotation[]).map((step) =>
      rotateItem(state, selectedItem.id, step),
    );
    const result = attempts.find((r) => r.ok) ?? attempts[0];
    if (result.ok) {
      commit(result.state);
      setRotation(result.item.rotation);
      if (!attempts[0].ok) notify(`${attempts[0].reason}，已转到下一可用方向`);
    } else notify(result.reason);
  }
  function removeSelected() {
    if (selectedCover && selectedPlatformId) {
      if (applyAction(setCoverRemoved(state, selectedPlatformId, selectedCover, true), "小圆盖已移除，可以看到留洞效果")) select(selectedPlatformId);
      return;
    }
    if (selectedPool && selectedPlatformId) {
      if (applyAction(setPlatformPool(state, selectedPlatformId, false), "泳池已移除，大圆盖已放回")) select(selectedPlatformId);
      return;
    }
    if (selectedId === "base2" || selectedId === "base3") {
      if (applyAction(removePlatform(state, selectedId), `${platformName(selectedId)}及其上方组件已移除`)) select("base");
      return;
    }
    if (!selectedItem) return;
    const next = removeItem(state, selectedItem.id);
    commit(next);
    select(null);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制，发给朋友就能复现同一搭配");
    } catch {
      codeField.current?.focus();
      codeField.current?.select();
      notify("请长按或使用系统复制，完整编号已选中");
    }
  }
  function restore() {
    try {
      const result = decodeConfigWithMigration(importCode.trim());
      commit(result.state, restoreCatalogStyle(result.state, encodeConfig(result.state)));
      setMigrationNotice(result.messages.join(" "));
      select("base");
      setImportError("");
      setModal(null);
      notify("搭配已还原，欢迎来到这个小小家");
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "编号无效，请检查是否完整复制。",
      );
    }
  }
  function downloadOrder() {
    const text = [
      "HamilyMart 搭配清单",
      ...orderLines.map(
        (l) =>
          `${l.sku} | ${l.name} × ${l.quantity} | ${money(l.total)} | 颜色：${Object.entries(
            l.colors,
          )
            .map(
              ([part, c]) =>
                `${COLOR_SLOTS[part]?.role ?? part} ${COLORS.find((v) => v.id === c)?.name ?? c}`,
            )
            .join("、")} | 包含：${l.parts.join("、")}`,
      ),
      `合计：${money(total)}`,
      "搭配编号：",
      configurationCode,
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "HamilyMart-搭配清单.txt";
    a.click();
    URL.revokeObjectURL(url);
    notify("配件编号、颜色和价格清单已下载");
  }
  function undo() {
    const last = history.at(-1);
    if (!last) return;
    setHistory(previous => previous.slice(0, -1));
    setFuture(next => [{ state, styleIndex }, ...next].slice(0, 20));
    setState(last.state); setStyleIndex(last.styleIndex); select(null);
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory(previous => [...previous.slice(-19), { state, styleIndex }]);
    setFuture(previous => previous.slice(1));
    setState(next.state); setStyleIndex(next.styleIndex); select(null);
  }
  function nextStyle() {
    const next = (styleIndex + 1) % COLOR_STYLES.length;
    commit(applyColorStyle(state, next), next);
    notify(COLOR_STYLES[next].name);
  }
  function clearDesign() {
    commit(createInitialState(), 0);
    select(null);
    setModal(null);
    setMigrationNotice("");
    setToast("");
  }
  const selectedTitle = selectedCover ? `小圆盖 ${Number(selectedCover.slice(-1))}` : selectedPool ? "圆形泳池" : editingPlatform ? platformName(selectedId!) : selectedProduct?.name ?? "组件设置";
  const workbench: WorkbenchProps = {
    state, styleIndex, ready, selectedId, title: selectedTitle, products: visibleProducts, parts: selectedParts,
    colorPart, currentColor, category, canUndo: !!history.length, canRedo: !!future.length,
    editingPlatform, platformId: selectedPlatformId,
    onCategory: setCategory, onSelect: select, onAdd: addProduct,
    onColorPart: setColorPart, onColor: setColor,
    onLegHeight: height => applyAction(setLegHeight(state, height)),
    onRestoreCover: (platform, cover) => applyAction(setCoverRemoved(state, platform, cover, false)),
    onUndo: undo, onRedo: redo,
  };
  return <div className={`app-shell ${mobile ? "is-mobile" : "is-desktop"}`} onContextMenu={event => { if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }} onDragStart={event => event.preventDefault()}>
    <header className="site-header">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); }} aria-label="HamilyMart 仓鼠造屋所"><HamsterMark /><span>Hamily<span className="brand-light">Mart</span><small>仓鼠造屋所</small></span></a>
      <div className="header-actions"><button className="header-price" onClick={() => setModal("order")} aria-label={`搭配清单，总价 ${money(total)}`}><span>{money(total)}</span><ChevronDown size={14} /></button></div>
    </header>
    <main className="workspace">
      <section className="studio" aria-label="3D 搭建工作台">
        <AssemblyScene ref={scene} state={state} selectedId={selectedId} selectedTitle={selectedTitle} activeProduct={activeProduct} rotation={rotation}
          getPreviewColors={productId => getProductStyleColors(productId, styleIndex)}
          showDimensions={showDimensions} canRotate={!!selectedItem}
          canRemove={!!(selectedItem || selectedCover || selectedPool || selectedId === "base2" || selectedId === "base3")}
          onRotate={rotateSelected} onRemove={removeSelected} onSelect={select} onDrop={drop}
          onDragEnd={() => { dragFinishedAt.current = Date.now(); }} onReady={() => setReady(true)} onError={notify} />
        <div className="canvas-bottom-actions" aria-label="搭建选项">
          <button disabled={platforms.length >= 3} onClick={addNextPlatform}><Plus size={17} /><span>增加平台</span></button>
          <button onClick={nextStyle}><Sparkles size={16} /><span>切换风格</span></button>
          <button onClick={() => setModal("bedding")}><Layers2 size={16} /><span>垫料高度</span></button>
          <button aria-pressed={showDimensions} onClick={() => setShowDimensions(value => !value)}><Ruler size={16} /><span>显示尺寸</span></button>
          <button className="clear-design-button" aria-label="清空当前设计" title="清空当前设计" onClick={() => setModal("clear")}><Trash2 size={18} /></button>
        </div>
        {(migrationNotice || toast || !saved) && <div className="canvas-notice" role="status"><Info size={16} /><span>{migrationNotice || toast || "暂未保存，请复制搭配编号"}</span><button aria-label="关闭提示" onClick={() => { setMigrationNotice(""); setToast(""); }}><X size={16} /></button></div>}
      </section>
      {mobile ? <MobileWorkbench {...workbench} /> : <DesktopWorkbench {...workbench} onStartDrag={(id, event) => {
        if (event.button !== 0 || !ready || id === "pool") return;
        setActiveProduct(id); setRotation(0);
        scene.current?.startDrag(id, event.clientX, event.clientY, event.pointerId);
      }} />}
    </main>
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}>
      <section className={`modal ${modal === "order" ? "order-modal" : ""} ${modal === "bedding" ? "bedding-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button className="round-button modal-close" aria-label="关闭弹窗" onClick={() => setModal(null)}><X size={20} /></button>
        {modal === "clear" && <><h2 id="modal-title">是否清空当前所有设计</h2><p className="modal-lead">清空后只保留一个基础平台。可以通过后退恢复。</p><div className="clear-design-actions"><button className="secondary-button" onClick={() => setModal(null)}>取消</button><button className="primary-button" onClick={clearDesign}>确认清空</button></div></>}
        {modal === "bedding" && <><h2 id="modal-title">设置垫料高度</h2><div className="bedding-options">
          <button className={`bedding-option ${state.bedding.mode === "thin" ? "selected" : ""}`} aria-pressed={state.bedding.mode === "thin"} onClick={() => chooseBedding({ mode: "thin", depth: 50 })}><span className="bedding-preview"><i style={{height:"18%"}} /></span><strong>薄铺</strong><span>5 cm</span></button>
          {([100, 200, 300] as const).map(depth => <button key={depth} className={`bedding-option ${state.bedding.mode === "thick" && state.bedding.depth === depth ? "selected" : ""}`} aria-pressed={state.bedding.mode === "thick" && state.bedding.depth === depth} onClick={() => chooseBedding({mode:"thick",depth})}><span className="bedding-preview"><i style={{height:`${depth / 4}%`}} /></span><strong>厚铺</strong><span>{depth / 10} cm</span></button>)}
        </div></>}
            {modal === "code" && (
              <>
                <div className="modal-symbol">
                  <Link size={26} />
                </div>
                <span className="eyebrow">SAME LITTLE HOME.</span>
                <h2 id="modal-title">把这份喜欢，分享出去</h2>
                <p className="modal-lead">
                  完整搭配编号包含平台、组件、颜色、留洞、脚长、垫料{FEATURES.hamsterPreview ? "与仓鼠" : ""}。
                  <br />
                  复制给朋友，粘贴即可还原同一个小家。
                </p>
                <label className="field-label" htmlFor="config-code">
                  我的搭配编号
                </label>
                <textarea
                  ref={codeField}
                  id="config-code"
                  className="code-field"
                  value={configurationCode}
                  readOnly
                  rows={3}
                />
                <button
                  className="primary-button full-width"
                  onClick={() => copy(configurationCode)}
                >
                  <Copy size={16} />
                  复制完整编号
                </button>
                <div className="dialog-divider">
                  <span>或者，还原另一个小家</span>
                </div>
                <label className="field-label" htmlFor="restore-code">
                  粘贴搭配编号
                </label>
                <textarea
                  id="restore-code"
                  rows={3}
                  className="code-field"
                  placeholder="粘贴完整的 HM1 / HM2 / HM3 搭配编号…"
                  value={importCode}
                  onChange={(e) => {
                    setImportCode(e.target.value);
                    setImportError("");
                  }}
                />
                {importError && (
                  <p className="field-error" role="alert">
                    {importError}
                  </p>
                )}
                <button
                  className="outline-button full-width"
                  disabled={!importCode.trim()}
                  onClick={restore}
                >
                  <ArrowDownToLine size={16} />
                  还原这个搭配
                </button>
                <small className="dialog-footnote">
                  还原会替换当前搭配，可用工作台的撤销按钮返回。
                </small>
              </>
            )}
            {modal === "order" && (
              <>
                <div className="modal-symbol">
                  <ShoppingBag size={26} />
                </div>
                <span className="eyebrow">YOUR TINY HOME LIST.</span>
                <h2 id="modal-title">小家的搭配清单</h2>
                <p className="modal-lead">
                  套餐内的配件已全部包含。
                </p>
                <div className="order-lines">
                  {orderLines.map((line, i) => (
                    <article className="order-line" key={`${line.id}-${i}`}>
                      <div>
                        <strong>{line.name}</strong>
                        <span>× {line.quantity}</span>
                        <b>{money(line.total)}</b>
                      </div>
                      <code>{line.sku}</code>
                      <p>
                        {Object.entries(line.colors)
                          .map(
                            ([part, c]) =>
                              `${COLOR_SLOTS[part]?.role ?? part} ${COLORS.find((v) => v.id === c)?.name ?? c}`,
                          )
                          .join(" · ")}
                      </p>
                      <details>
                        <summary>包含 {line.parts.length} 个部件编号</summary>
                        <p>{line.parts.join(" · ")}</p>
                      </details>
                    </article>
                  ))}
                </div>
                <div className="order-total">
                  <span>
                    搭配合计 <small>演示价</small>
                  </span>
                  <strong>{money(total)}</strong>
                </div>
                <button
                  className="primary-button full-width"
                  onClick={downloadOrder}
                >
                  <ArrowDownToLine size={16} />
                  下载编号与价格清单
                </button>
                <button
                  className="outline-button full-width"
                  onClick={() => setModal("code")}
                >
                  <Link size={16} />
                  复制搭配编号
                </button>
              </>
            )}

      </section>
    </div>}
  </div>;
}
