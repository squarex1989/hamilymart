import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Expand,
  House,
  Info,
  Layers2,
  Link,
  Magnet,
  Minus,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import AssemblyScene from "./components/AssemblyScene";
import type { SceneHandle } from "./components/AssemblyScene";
import {
  AVAILABLE_COLORS,
  BASE_PRODUCT,
  CATALOG_VERSION,
  COLORS,
  COLOR_SLOTS,
  PRODUCTS,
  getBaseParts,
  getDefaultColors,
  getProduct,
  getProductColorParts,
} from "./data/catalog";
import { HAMSTER_VARIANTS } from "./data/hamsters";
import { FEATURES } from "./data/features";
import type { ColorId, Rotation } from "./data/catalog";
import {
  addPlatform,
  autoPlace,
  createInitialState,
  getPlatforms,
  getOrderLines,
  getPlacements,
  getTotalPrice,
  migrateAssembly,
  removeItem,
  removePlatform,
  rotateItem,
  setBedding,
  setHamster,
  setPlatformColors,
  setCoverRemoved,
  setLegHeight,
  setPlatformPool,
  tryPlace,
} from "./lib/assembly";
import type { ActionResult, AssemblyState, Bedding, PlatformId } from "./lib/assembly";
import { decodeConfigWithMigration, encodeConfig } from "./lib/config-code";

const STORAGE = "hamilymart.assembly.v2";
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
    return { ...result, recovery: null };
  } catch (error) {
    return {
      state: createInitialState(),
      messages: [
        `本地搭配暂时无法载入：${error instanceof Error ? error.message : "存档读取失败"}。原存档已保留，你也可以粘贴搭配编号恢复。`,
      ],
      recovery: original,
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

export default function App() {
  const [startup] = useState(initial);
  const [state, setState] = useState<AssemblyState>(startup.state),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState(startup.messages.join(" "));
  const [activeProduct, setActiveProduct] = useState<string | null>(null),
    [rotation, setRotation] = useState<Rotation>(0);
  const [category, setCategory] = useState("all"),
    [panel, setPanel] = useState<"catalog" | "selected" | "settings">("catalog");
  const [toolTab, setToolTab] = useState<"build" | "bedding" | "hamster">("build");
  const [hamsterSpecies, setHamsterSpecies] = useState("all");
  const [showMagnets, setShowMagnets] = useState(false),
    [modal, setModal] = useState<"code" | "order" | "help" | null>(null);
  const [importCode, setImportCode] = useState(""),
    [importError, setImportError] = useState(""),
    [toast, setToast] = useState("");
  const [ready, setReady] = useState(false),
    [colorPart, setColorPart] = useState("P01"),
    [saved, setSaved] = useState(true),
    [bounce, setBounce] = useState<string | null>(null);
  const [history, setHistory] = useState<AssemblyState[]>([]);
  const controlScroll = useRef<HTMLDivElement>(null);
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
  const hasPool = platforms.some(p => p.baseInsert === "pool");
  const groupCount = platforms.length + state.items.length + platforms.filter(p => p.baseInsert === "pool").length;
  const selectedItem = state.items.find((i) => i.id === selectedId);
  const selectedProduct = selectedItem
    ? getProduct(selectedItem.productId)
    : null;
  const selectedParts =
    selectedPlatform
      ? getBaseParts(state.legHeight, selectedPlatform.baseInsert, selectedPlatform.removedCovers).filter(
          (p) => selectedCover ? p.id === selectedCover : selectedPool ? p.id === "B01" : p.id === "P01" || /^[LXY]01$/.test(p.id),
        )
      : (selectedProduct ? getProductColorParts(selectedProduct.id) : []);
  const selectedColors =
    selectedPlatform ? selectedPlatform.baseColors : (selectedItem?.colors ?? {});
  const colorKey = /^[LXY]01$/.test(colorPart) ? "legs" : colorPart;
  const currentColor =
    selectedColors[colorKey] ??
    selectedParts.find((p) => p.id === colorPart)?.defaultColor ??
    "cream";
  const visibleProducts = PRODUCTS.filter(
    (p) => category === "all" || p.category === category,
  ).sort((a, b) => (HOUSE_ORDER.includes(a.id) ? HOUSE_ORDER.indexOf(a.id) : 20) - (HOUSE_ORDER.includes(b.id) ? HOUSE_ORDER.indexOf(b.id) : 20));
  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3800);
  }
  function commit(next: AssemblyState) {
    if (next === state) return;
    setHistory((h) => [...h.slice(-19), state]);
    setState(next);
  }
  function applyAction(result: ActionResult, message?: string) {
    if (!result.ok) { notify(result.reason); return false; }
    commit(result.state);
    if (message) notify(message);
    return true;
  }
  function addProduct(productId: string) {
    setActiveProduct(null);
    const result = autoPlace(state, productId, selectedPlatformId ?? undefined);
    if (!result.ok) { notify(result.reason); return; }
    commit(result.state);
    if (result.item) select(result.item.id);
    else {
      const addedPool = getPlatforms(result.state).find(p => p.baseInsert === "pool" && platforms.find(old => old.id === p.id)?.baseInsert !== "pool");
      if (addedPool) select(`pool:${addedPool.id}`);
    }
    notify(productId === "pool" ? "泳池已装好，大圆盖已自动移除" : "已安排到最合适的磁吸位置");
  }
  function addNextPlatform() {
    const result = addPlatform(state);
    if (applyAction(result, "新平台已贴合在右侧")) {
      select(getPlatforms(result.ok ? result.state : state).at(-1)!.id);
    }
  }
  function chooseBedding(bedding: Bedding) {
    applyAction(setBedding(state, bedding), state.legHeight === 0
      ? "垫料已更新，无腿平台已放在垫料上"
      : bedding.mode === "thin" ? "已薄铺 5 cm 垫料，支撑脚为 10 cm" : `垫料和所有支撑脚已同步为 ${bedding.depth / 10} cm`);
  }
  useEffect(() => {
    controlScroll.current?.scrollTo({ top: 0 });
  }, [selectedId, panel, toolTab]);
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
      setToolTab("build");
      setPanel("settings");
      const item = state.items.find((i) => i.id === id);
      setRotation(item?.rotation ?? 0);
    } else setPanel("catalog");
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
      existing?.colors ?? {},
      itemId,
    );
    if (result.ok) {
      commit(result.state);
      select(result.item.id);
      setActiveProduct(null);
      notify(itemId ? "已经移到新的磁吸位" : "咔哒！已吸附到匹配位置");
    } else {
      setBounce(productId);
      setTimeout(() => setBounce(null), 500);
      notify(result.reason || "这里的磁吸位不匹配，换个位置试试");
    }
  }
  function restoreOriginalColors() {
    if (selectedPlatform) {
      const defaults = createInitialState().baseColors;
      const colors = selectedCover || selectedPool ? { ...selectedPlatform.baseColors, [selectedCover ?? "B01"]: defaults[selectedCover ?? "B01"] } : defaults;
      applyAction(setPlatformColors(state, selectedPlatform.id, colors));
    }
    else if (selectedItem)
      commit({
        ...state,
        items: state.items.map((item) =>
          item.id === selectedId
            ? { ...item, colors: getDefaultColors(item.productId) }
            : item,
        ),
      });
    notify("已恢复这组组件的原模型配色");
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
            ? { ...i, colors: { ...i.colors, [colorPart]: color } }
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
      notify(`已旋转至 ${result.item.rotation}°，并吸附到匹配位置`);
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
    const removed = state.items.length - next.items.length;
    commit(next);
    select("base");
    notify(
      removed > 1
        ? `已移除套餐及其上方 ${removed - 1} 件配件`
        : "已移除这件配件",
    );
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
      commit(result.state);
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
      "演示价格，最终金额待商家确认",
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
  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            scene.current?.home();
          }}
          aria-label="HamilyMart 仓鼠造屋所"
        >
          <HamsterMark />
          <span>
            Hamily<span className="brand-light">Mart</span>
            <small>仓鼠造屋所</small>
          </span>
        </a>
        <nav className="main-nav" aria-label="主导航">
          <span className="nav-active">
            造一个小家 <span className="nav-dot" />
          </span>
          <button onClick={() => setModal("help")}>搭建指南</button>
        </nav>
        <div className="header-actions">
          <span className="save-status">
            <span className={saved ? "status-dot" : "status-dot error"} />
            {saved ? "已保存在此设备" : "未能保存，请复制编号"}
          </span>
          <button
            className="outline-button header-code"
            onClick={() => setModal("code")}
          >
            <Link size={15} />
            搭配编号
          </button>
          <button
            className="round-button mobile-help"
            aria-label="搭建指南"
            onClick={() => setModal("help")}
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <section className="studio" aria-label="3D 搭建工作台">
          <AssemblyScene
            ref={scene}
            state={state}
            selectedId={selectedId}
            activeProduct={activeProduct}
            rotation={rotation}
            showMagnets={showMagnets}
            onSelect={select}
            onDrop={drop}
            onDragEnd={() => {
              dragFinishedAt.current = Date.now();
              notify("配件已放回，请拖到画布里的匹配磁位");
            }}
            onReady={() => setReady(true)}
            onError={notify}
          />
          <div className="canvas-caption"><Move size={13} /><span>拖动空白处旋转 · 双指缩放</span></div>
        </section>
        <aside className="catalog-panel control-dock" aria-label="搭建与场景设置">
          <div className="workspace-tabs" role="tablist" aria-label="场景设置">
            {([["build", "搭建"], ["bedding", "垫料"], ["hamster", "仓鼠"]] as const).filter(([id]) => id !== "hamster" || FEATURES.hamsterPreview).map(([id, label]) =>
              <button key={id} role="tab" aria-selected={toolTab === id} className={toolTab === id ? "active" : ""}
                onClick={() => { setToolTab(id); setActiveProduct(null); }}>{label}</button>)}
            <button className="round-button undo-action" aria-label="撤销上一步" disabled={!history.length} onClick={() => {
              const last = history.at(-1);
              if (last) { setState(last); setHistory(h => h.slice(0, -1)); select(null); }
            }}><RotateCcw size={17} /></button>
          </div>
          <div className="control-scroll" ref={controlScroll}>
            {(migrationNotice || toast) && <div className={`dock-notice ${migrationNotice ? "migration-notice" : ""}`} role="status">
              <Info size={16} /><span>{migrationNotice || toast}</span>
              <button className="round-button" aria-label="关闭提示" onClick={() => { setMigrationNotice(""); setToast(""); }}><X size={15} /></button>
            </div>}
            {toolTab === "build" && <>
              {panel === "settings" && selectedId ? <div className="settings-panel">
                <div className="settings-navigation">
                  <button className="back-to-catalog" onClick={() => select(null)}><ArrowLeft size={16} />配件</button>
                  <span>{selectedCover ? `小圆盖 ${Number(selectedCover.slice(-1))}` : selectedPool ? "圣诞泳池" : editingPlatform ? platformName(selectedId) : selectedProduct?.name}</span>
                  <button className="finish-editing" onClick={() => select(null)}><Check size={15} />完成</button>
                </div>
              <div className="selection-card">
                <div className="selection-head">
                  <div className="selection-icon">
                    {selectedPlatform ? (
                      <Layers2 size={21} />
                    ) : (
                      <House size={21} />
                    )}
                  </div>
                  <div>
                    <span className="mini-label">组件设置</span>
                    <strong>
                      {selectedCover ? `小圆盖 ${Number(selectedCover.slice(-1))}`
                        : selectedPool ? "圣诞泳池"
                        : editingPlatform
                        ? platformName(selectedId ?? "base")
                        : selectedProduct?.name}
                    </strong>
                  </div>
                  <div className="selection-actions">
                    <button
                      className="round-button"
                      aria-label="恢复原模型配色"
                      title="恢复原模型配色"
                      onClick={restoreOriginalColors}
                    >
                      <RotateCcw size={17} /><small>原色</small>
                    </button>
                    {(selectedItem || selectedCover || selectedPool || selectedId === "base2" || selectedId === "base3") && (
                      <>
                        {selectedItem && <button
                          className="round-button"
                          aria-label="旋转已选配件"
                          title="切换到下一个可安装方向"
                          onClick={rotateSelected}
                        >
                          <RotateCw size={18} /><small>旋转</small>
                        </button>}
                        <button
                          className="round-button danger"
                          aria-label="移除已选配件"
                          title="移除所选组件"
                          onClick={removeSelected}
                        >
                          <Trash2 size={17} /><small>移除</small>
                        </button>
                      </>
                    )}

                  </div>
                </div>
                {editingPlatform && selectedPlatform && (
                  <div className="base-options">
                    <div>
                      <span>支撑脚{platforms.length > 1 ? ` · ${platforms.length} 个平台同步` : ""}</span>
                      <div className="segmented">
                        <button
                          className={state.legHeight === 0 ? "active" : ""}
                          disabled={hasPool}
                          title={hasPool ? "请先移除泳池，再选择无腿" : "平台不配支撑脚"}
                          onClick={() => applyAction(setLegHeight(state, 0))}
                        >无腿</button>
                        <button
                          className={state.legHeight === 100 ? "active" : ""}
                          onClick={() => applyAction(setLegHeight(state, 100))}
                        >
                          10 cm
                        </button>
                        <button
                          className={state.legHeight === 200 ? "active" : ""}
                          onClick={() => applyAction(setLegHeight(state, 200))}
                        >
                          20 cm
                        </button>
                        <button className={state.legHeight === 300 ? "active" : ""}
                          onClick={() => applyAction(setLegHeight(state, 300))}>30 cm</button>
                      </div>
                    </div>
                    <p className="platform-hint">{hasPool ? "泳池需要支撑脚。" : ""}{state.bedding.mode === "thick" ? "厚铺时，支撑脚与垫料高度同步；无腿平台放在垫料上。" : "薄铺 5 cm 垫料，无腿平台放在垫料上。"}</p>
                    <p className="platform-hint">先选平台，再点小圆盖可移除留洞。平台有 32 个磁吸位，大圆盖另有 4 个。</p>
                    {selectedPlatform.removedCovers.length > 0 && <div className="restore-covers">
                      <span>放回圆盖</span>
                      {selectedPlatform.removedCovers.map(id => <button key={id} onClick={() => applyAction(setCoverRemoved(state, selectedPlatform.id, id, false), "圆盖已放回")}>小圆盖 {Number(id.slice(-1))}</button>)}
                    </div>}
                  </div>
                )}
                <div className="color-editor">
                  <label className="part-select">
                    <select
                      aria-label="选择要换色的部位"
                      value={colorPart}
                      onChange={(e) => setColorPart(e.target.value)}
                    >
                      {selectedParts.map((p) => (
                        <option value={p.id} key={p.id}>
                          {/^[LXY]01$/.test(p.id) ? "四根支撑脚" : p.role}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <div className="swatches" aria-label="九种可选颜色">
                    {AVAILABLE_COLORS.map((c) => (
                      <button
                        key={c.id}
                        className={`swatch ${currentColor === c.id ? "selected" : ""}`}
                        style={{ "--swatch": c.hex } as React.CSSProperties}
                        aria-label={c.name}
                        title={c.name}
                        aria-pressed={currentColor === c.id}
                        onClick={() => setColor(c.id)}
                      >
                        {currentColor === c.id && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                  <span className="color-name">
                    {COLORS.find((c) => c.id === currentColor)?.name}
                  </span>
                </div>
              </div>
              </div> : <>
                <div className="build-navigation">
                  <div className="panel-tabs">
                    <button className={panel === "catalog" ? "active" : ""} onClick={() => setPanel("catalog")}><ShoppingBag size={16} />配件</button>
                    <button className={panel === "selected" ? "active" : ""} onClick={() => setPanel("selected")}><Layers2 size={16} />已搭建 {groupCount}</button>
                  </div>
                  <details className="view-settings"><summary aria-label="视角和磁吸位置"><Expand size={16} /><span>视角</span></summary>
          <div className="dock-view-tools">
            <button
              className="round-button"
              title="恢复视角"
              aria-label="恢复视角"
              onClick={() => scene.current?.home()}
            >
              <Expand size={18} />
            </button>
            <button
              className="round-button"
              title="俯视查看"
              aria-label="俯视查看"
              onClick={() => scene.current?.top()}
            >
              <Layers2 size={18} />
            </button>
            <span />
            <button
              className="round-button"
              aria-label="放大"
              onClick={() => scene.current?.zoom(0.85)}
            >
              <Plus size={18} />
            </button>
            <button
              className="round-button"
              aria-label="缩小"
              onClick={() => scene.current?.zoom(1.18)}
            >
              <Minus size={18} />
            </button>
            <span />
            <button
              className="round-button"
              aria-label="撤销上一步"
              disabled={!history.length}
              onClick={() => {
                const last = history.at(-1);
                if (last) {
                  setState(last);
                  setHistory((h) => h.slice(0, -1));
                  select("base");
                }
              }}
            >
              <RotateCcw size={17} />
            </button>
          </div>

                    <button className={`magnet-toggle ${showMagnets ? "is-on" : ""}`} onClick={() => setShowMagnets(v => !v)} aria-pressed={showMagnets}><Magnet size={15} />显示磁吸位</button>
                    <p>平台本体 32 个，大圆盖另有 4 个。</p>
                  </details>
                </div>
          {panel === "catalog" ? (
            <>
              <div className="catalog-intro">
                <div>
                  <h2>给小家添点喜欢</h2>
                  <p>点选配件，自动安排合适的位置。</p>
                </div>
                <span className="sparkle-stamp">
                  <Sparkles size={23} />
                </span>
              </div>
              <div className="platform-tools">
                <div className="platform-tools-heading">
                  <span><Layers2 size={15} />{platforms.length} / 3 块平台 · 依次贴边</span>
                  <button className="outline-button" disabled={platforms.length >= 3} onClick={addNextPlatform}>
                    <Plus size={14} />向右增加平台
                  </button>
                </div>
              </div>
              <div
                className="category-tabs"
                role="tablist"
                aria-label="配件分类"
              >
                {[
                  ["all", "全部"],
                  ["house", "小屋"],
                  ["pipe", "管道"],
                  ["garden", "花园"],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={category === id}
                    className={category === id ? "active" : ""}
                    onClick={() => setCategory(id)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="product-grid">
                <button className="add-platform-card" disabled={platforms.length >= 3} onClick={addNextPlatform}>
                  <span><Plus size={22} /><Layers2 size={27} /></span>
                  <strong>{platforms.length >= 3 ? "已放满三块" : "向右增加平台"}</strong>
                  <small>{platforms.length} / 3 块 · 自动贴边</small>
                </button>
                {visibleProducts.map((product) => {
                  const available = product.id === "pool" ? state.legHeight > 0 && platforms.some(p => p.baseInsert === "lid") :
                    ([0, 90, 180, 270] as Rotation[]).some(r => getPlacements(state, product.id, r).length > 0);
                  return (
                    <article
                      key={product.id}
                      className={`product-card ${activeProduct === product.id ? "is-active" : ""} ${bounce === product.id ? "bounce-back" : ""}`}
                      onClick={(event) => {
                        if (!ready || (event.target instanceof Element && event.target.closest("button"))) return;
                        addProduct(product.id);
                      }}
                    >
                      <button
                        className="product-visual"
                        aria-label={`拖动或选择${product.name}`}
                        disabled={!ready}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !ready || product.id === "pool") return;
                          setActiveProduct(product.id);
                          setRotation(0);
                          scene.current?.startDrag(
                            product.id,
                            e.clientX,
                            e.clientY,
                            e.pointerId,
                          );
                        }}
                        onClick={() => {
                          if (Date.now() - dragFinishedAt.current < 350) return;
                          addProduct(product.id);
                        }}
                      >
                        <img
                          src={`/thumbnails/${product.id}.png?v=${CATALOG_VERSION}`}
                          alt={product.name}
                          draggable={false}
                        />
                        {product.badge && (
                          <span className="product-badge">{product.badge}</span>
                        )}
                        <span className="drag-hint">
                          <Move size={12} />
                          点击搭建
                        </span>
                      </button>
                      <div className="product-info">
                        <h3>{product.name}</h3>
                        <p>
                          {product.parts.length > 1
                            ? `${product.parts.length} 件组合 · 套餐`
                            : product.id === "pool" ? "自动替换大圆盖" : "磁吸配件"}
                          {!available && (
                            <span className="needs-parent">
                              {" "}
                              · 暂无可用磁位
                            </span>
                          )}
                        </p>
                        <div>
                          <strong>{money(product.price)}</strong>
                          <button
                            className="add-button"
                            aria-label={`选择${product.name}`}
                            disabled={!ready}
                            onClick={() => addProduct(product.id)}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="catalog-note">
                <Magnet size={16} />
                <p>
                  对准真实磁吸位，就能“咔哒”到位。
                  <br />
                  小屋、管道与支撑成套搭配，不会漏买。
                </p>
              </div>
            </>
          ) : (
            <div className="selected-list">
              <h2>你的小家，由这些组成</h2>
              {platforms.map(platform => <div key={platform.id}>
                <button
                  className={`selected-row ${selectedId === platform.id ? "active" : ""}`}
                  onClick={() => select(platform.id)}
                >
                  <img src={`/thumbnails/base.png?v=${CATALOG_VERSION}`} alt="基础平台" />
                  <span>
                    <strong>{platformName(platform.id)}</strong>
                    <small>{state.legHeight === 0 ? "无支撑脚" : `四根 ${state.legHeight / 10} cm 腿`}{platform.removedCovers.length ? ` · ${platform.removedCovers.length} 个留洞` : ""}</small>
                    <em>{money(BASE_PRODUCT.price + (state.legHeight === 300 ? BASE_PRODUCT.extraTallLegSurcharge : state.legHeight === 200 ? BASE_PRODUCT.tallLegSurcharge : state.legHeight === 0 ? -BASE_PRODUCT.noLegDiscount : 0))}</em>
                  </span>
                  <ChevronDown size={15} />
                </button>
                {platform.baseInsert === "pool" && <button className={`selected-row ${selectedId === `pool:${platform.id}` ? "active" : ""}`} onClick={() => select(`pool:${platform.id}`)}>
                  <img src={`/thumbnails/pool.png?v=${CATALOG_VERSION}`} alt="圣诞泳池" />
                  <span><strong>圣诞泳池</strong><small>{platformName(platform.id)} · 嵌入大圆洞</small><em>{money(BASE_PRODUCT.poolSurcharge)}</em></span>
                  <ChevronDown size={15} />
                </button>}
              </div>)}
              {state.items.map((item) => {
                const product = getProduct(item.productId);
                return (
                  <button
                    key={item.id}
                    className={`selected-row ${selectedId === item.id ? "active" : ""}`}
                    onClick={() => select(item.id)}
                  >
                    <img src={`/thumbnails/${product.id}.png?v=${CATALOG_VERSION}`} alt="" />
                    <span>
                      <strong>{product.name}</strong>
                      <small>
                        {product.sku} · {item.rotation}°
                      </small>
                      <em>{money(product.price)}</em>
                    </span>
                    <ChevronDown size={15} />
                  </button>
                );
              })}
              <button
                className="outline-button more-parts"
                onClick={() => setPanel("catalog")}
              >
                <Plus size={15} />
                继续添点喜欢
              </button>
            </div>
          )}

              </>}
            </>}
            {toolTab === "bedding" && <section className="environment-panel" aria-label="垫料设置">
              <div className="environment-heading"><h2>铺上软软的垫料</h2><span>{state.bedding.mode === "thin" ? "薄铺" : "厚铺"} {state.bedding.depth / 10} cm</span></div>
              <div className="bedding-options">
                <button className={`bedding-option ${state.bedding.mode === "thin" ? "selected" : ""}`} aria-pressed={state.bedding.mode === "thin"} onClick={() => chooseBedding({ mode: "thin", depth: 50 })}>
                  <span className="bedding-preview"><i style={{ height: "18%" }} /></span><strong>薄铺</strong><span>5 cm</span>
                </button>
                {([100, 200, 300] as const).map(depth => <button key={depth} className={`bedding-option ${state.bedding.mode === "thick" && state.bedding.depth === depth ? "selected" : ""}`} aria-pressed={state.bedding.mode === "thick" && state.bedding.depth === depth} onClick={() => chooseBedding({ mode: "thick", depth })}>
                  <span className="bedding-preview"><i style={{ height: `${depth / 4}%` }} /></span><strong>厚铺</strong><span>{depth / 10} cm</span>
                </button>)}
              </div>
              <p className="setting-note"><Info size={15} /><span>厚铺时，所有有腿平台的脚长自动与垫料同高；薄铺 5 cm 使用 10 cm 腿。无腿平台始终放在垫料上。</span></p>
            </section>}
            {FEATURES.hamsterPreview && toolTab === "hamster" && <section className="environment-panel hamster-panel" aria-label="仓鼠品种与花色">
              <div className="environment-heading"><h2>请小家人入住</h2>{state.hamster && <button className="remove-hamster" onClick={() => applyAction(setHamster(state, null), "仓鼠预览已移除")}><Trash2 size={14} />移除</button>}</div>
              <p className="setting-description">选择一种品种与花色，看看它在小家里的样子。</p>
              <div className="species-tabs" aria-label="仓鼠品种筛选">
                <button className={hamsterSpecies === "all" ? "active" : ""} onClick={() => setHamsterSpecies("all")}>全部</button>
                {[...new Set(HAMSTER_VARIANTS.map(variant => variant.species))].map(species => <button key={species} className={hamsterSpecies === species ? "active" : ""} onClick={() => setHamsterSpecies(species)}>{species.match(/（(.*?)）/)?.[1] ?? species}</button>)}
              </div>
              <div className="hamster-grid">
                {HAMSTER_VARIANTS.filter(variant => hamsterSpecies === "all" || variant.species === hamsterSpecies).map(variant => <button key={variant.id} className={`hamster-choice ${state.hamster === variant.id ? "selected" : ""}`} aria-pressed={state.hamster === variant.id} onClick={() => applyAction(setHamster(state, variant.id), `${variant.name}已入住`)}>
                  <svg className="hamster-portrait" viewBox="0 0 100 70" aria-hidden="true">
                    <ellipse cx="50" cy="63" rx="32" ry="4" fill="#273C3520" />
                    <ellipse cx="28" cy="21" rx="12" ry="13" fill={variant.primary} /><ellipse cx="72" cy="21" rx="12" ry="13" fill={variant.primary} />
                    <ellipse cx="28" cy="22" rx="7" ry="8" fill="#EBC7BF" /><ellipse cx="72" cy="22" rx="7" ry="8" fill="#EBC7BF" />
                    <ellipse cx="50" cy="41" rx="34" ry="25" fill={variant.primary} />
                    {variant.pattern === "banded" && <ellipse cx="50" cy="40" rx="12" ry="24" fill={variant.secondary} />}
                    {variant.pattern === "dorsal" && <path d="M46 17h8l-1 23h-6z" fill={variant.id === "winter-pearl" ? "#ACA99F" : "#534C47"} opacity=".55" />}
                    {variant.pattern === "panda" && <ellipse cx="50" cy="42" rx="23" ry="25" fill={variant.secondary} />}
                    <ellipse cx="50" cy="51" rx="22" ry="14" fill={variant.secondary} />
                    <circle cx="34" cy="39" r="3" fill="#342D29" /><circle cx="66" cy="39" r="3" fill="#342D29" />
                    <circle cx="35" cy="38" r=".9" fill="#FFF" /><circle cx="67" cy="38" r=".9" fill="#FFF" />
                    <path d="M46 48h8l-4 4z" fill="#BB8C83" /><path d="M50 52v4m0 0-4 2m4-2 4 2" fill="none" stroke="#927B71" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <strong>{variant.name}</strong><small>{variant.coat}</small>{state.hamster === variant.id && <Check className="hamster-selected" size={15} />}
                </button>)}
              </div>
              {!state.hamster && <p className="setting-note">当前未添加仓鼠，点选即可预览。仓鼠仅用于展示比例，不计入配件价格。</p>}
            </section>}
          </div>
          <footer className="checkout-bar">
            <div className="checkout-total">
              <span>共 <b>{groupCount}</b> 组 <span className="price-note">· 演示价格</span></span>
              <strong>{money(total)}</strong>
            </div>
            <button className="outline-button footer-share" aria-label="分享搭配" onClick={() => setModal("code")}><Link size={16} /></button>
            <button className="primary-button" onClick={() => setModal("order")}><span>搭配清单</span><ArrowRight size={17} /></button>
          </footer>
        </aside>
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "order" ? "order-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="round-button modal-close"
              aria-label="关闭弹窗"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
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
                  套餐内的配件已全部包含。当前为演示价格。
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
            {modal === "help" && (
              <>
                <div className="modal-symbol">
                  <Sparkles size={27} />
                </div>
                <span className="eyebrow">LET’S MAKE A LITTLE HOME.</span>
                <h2 id="modal-title">三步，造一个喜欢的小家</h2>
                <div className="help-steps">
                  <article>
                    <span>01</span>
                    <div>
                      <h3>从一张平台开始</h3>
                      <p>
                        默认配四根 10 cm 支撑脚，可切换 20 / 30 cm 或无腿。增加平台会依次向右贴边，最多三块，支撑脚高度同步。厚铺垫料时，腿与垫料同步升高；无腿平台放在垫料上。
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>02</span>
                    <div>
                      <h3>挑一件，自动搭好</h3>
                      <p>
                        点选配件即可自动安排位置，也可拖到绿色圆环附近。小屋和管道需要至少两个磁吸位对齐；花圃、食盆使用各自的单磁吸位。安装时会检查碰撞，没有位置会提示“放不下去了”。
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>03</span>
                    <div>
                      <h3>转一转，涂上喜欢的颜色</h3>
                      <p>
                        选中配件后，在下方或右侧设置区旋转、换色或移除，点击完成继续挑选。拖动画布空白处查看全貌。{FEATURES.hamsterPreview && "还能添加仓鼠预览比例。"}满意后复制搭配编号，或下载完整配件清单。
                      </p>
                    </div>
                  </article>
                </div>
                <div className="help-note">
                  <Magnet size={19} />
                  <p>
                    先选平台，再点小圆盖可移除，预览留洞；选中平台可放回圆盖。P01 本体提供 32 个磁吸位，H06 大圆盖另有 4 个。圣诞泳池自动替换大圆盖，无腿平台不能安装泳池。房屋顶盖、管道底座随套餐提供；移除平台或底层小屋时，上方配件也会一起移除。
                  </p>
                </div>
                <button
                  className="primary-button full-width"
                  onClick={() => setModal(null)}
                >
                  开始我的小家
                  <ArrowRight size={17} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
