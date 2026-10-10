import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Expand,
  Heart,
  House,
  Info,
  Layers2,
  Link,
  LoaderCircle,
  Magnet,
  Minus,
  MousePointer2,
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
  BASE_PRODUCT,
  CATALOG_VERSION,
  COLORS,
  PRODUCTS,
  getBaseParts,
  getDefaultColors,
  getProduct,
} from "./data/catalog";
import type { ColorId, Rotation } from "./data/catalog";
import {
  createInitialState,
  getOrderLines,
  getPlacements,
  getTotalPrice,
  migrateAssembly,
  removeItem,
  rotateItem,
  tryPlace,
  validateAssembly,
} from "./lib/assembly";
import type { AssemblyState } from "./lib/assembly";
import { decodeConfigWithMigration, encodeConfig } from "./lib/config-code";

const STORAGE = "hamilymart.assembly.v2";
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
    [selectedId, setSelectedId] = useState<string | null>("base");
  const [migrationNotice, setMigrationNotice] = useState(startup.messages.join(" "));
  const [activeProduct, setActiveProduct] = useState<string | null>(null),
    [rotation, setRotation] = useState<Rotation>(0);
  const [category, setCategory] = useState("all"),
    [panel, setPanel] = useState<"catalog" | "selected">("catalog");
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
  const dragFinishedAt = useRef(0);
  const scene = useRef<SceneHandle>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    codeField = useRef<HTMLTextAreaElement>(null);
  const configurationCode = useMemo(() => encodeConfig(state), [state]);
  const orderLines = useMemo(() => getOrderLines(state), [state]);
  const total = getTotalPrice(state);
  const selectedItem = state.items.find((i) => i.id === selectedId);
  const selectedProduct = selectedItem
    ? getProduct(selectedItem.productId)
    : null;
  const selectedParts =
    selectedId === "base"
      ? getBaseParts(state.legHeight, state.baseInsert).filter(
          (p) => !p.id.startsWith("H0") && !/^[LX]0[234]$/.test(p.id),
        )
      : (selectedProduct?.parts ?? []);
  const selectedColors =
    selectedId === "base" ? state.baseColors : (selectedItem?.colors ?? {});
  const colorKey = /^[LX]01$/.test(colorPart) ? "legs" : colorPart;
  const currentColor =
    selectedColors[colorKey] ??
    selectedParts.find((p) => p.id === colorPart)?.defaultColor ??
    "cream";
  const visibleProducts = PRODUCTS.filter(
    (p) => category === "all" || p.category === category,
  );
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
    const keys =
      selectedId === "base"
        ? getBaseParts(state.legHeight, state.baseInsert)
        : (selectedProduct?.parts ?? []);
    setColorPart(keys[0]?.id ?? "P01");
  }, [selectedId, state.legHeight, state.baseInsert, selectedProduct]);
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
      existing?.colors ?? {},
      itemId,
    );
    if (result.ok) {
      commit(result.state);
      setSelectedId(result.item.id);
      setActiveProduct(null);
      notify(itemId ? "已经移到新的磁吸位" : "咔哒！已吸附到匹配位置");
    } else {
      setBounce(productId);
      setTimeout(() => setBounce(null), 500);
      notify(result.reason || "这里的磁吸位不匹配，换个位置试试");
    }
  }
  function restoreOriginalColors() {
    if (selectedId === "base")
      commit({ ...state, baseColors: createInitialState().baseColors });
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
    if (selectedId === "base") {
      const colors = { ...state.baseColors, [colorKey]: color };
      if (colorPart === "P01")
        for (const n of [1, 2, 3, 4, 5, 6]) colors[`H0${n}`] = color;
      commit({ ...state, baseColors: colors });
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
      notify(`已切换到 ${result.item.rotation}°，磁吸位匹配`);
    } else notify(result.reason);
  }
  function removeSelected() {
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
  function changeInsert(insert: "pool" | "lid") {
    try {
      const next = { ...state, baseInsert: insert };
      validateAssembly(next);
      commit(next);
    } catch {
      notify("当前有配件使用大圆盖的磁位，请先移除对应配件，再切换泳池。");
    }
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
                `${part} ${COLORS.find((v) => v.id === c)?.name ?? c}`,
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
  const actionProduct = activeProduct ? getProduct(activeProduct) : null;
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
      <div className="intro-strip">
        <div>
          <span className="eyebrow">A LITTLE HOME, A LOT OF LOVE.</span>
          <h1>
            小小的家，<span>大大的喜欢。</span>
            <Heart className="intro-heart" size={24} />
          </h1>
        </div>
        <p>
          选一件，搭一下。
          <br />
          为你的小小家人，拼出独一份的日常。
        </p>
      </div>
      <main className="workspace">
        <section className="studio" aria-label="3D 搭建工作台">
          <div className="studio-heading">
            <div className="studio-badge">
              <span />
              我的小小家 <span className="badge-divider" />
              3D 搭建中
            </div>
            <button
              className={`magnet-toggle ${showMagnets ? "is-on" : ""}`}
              onClick={() => setShowMagnets((v) => !v)}
              aria-pressed={showMagnets}
            >
              <Magnet size={15} />
              <span>磁吸位置</span>
            </button>
          </div>
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
          <div className="view-tools">
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
          <div className="scale-label">
            <span />
            30 cm
            <span />
          </div>
          {activeProduct ? (
            <div className="placement-card">
              <div className="placement-icon">
                <Magnet size={23} />
              </div>
              <div>
                <strong>把「{actionProduct?.name}」放进小家</strong>
                <p>拖到绿色圆环附近，或轻点圆环安装</p>
              </div>
              <button
                className="round-button"
                aria-label="旋转待放置组件"
                onClick={rotateSelected}
              >
                <RotateCw size={18} />
                <small>{rotation}°</small>
              </button>
              <button
                className="round-button"
                aria-label="取消放置"
                onClick={() => setActiveProduct(null)}
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            selectedId && (
              <div className="selection-card">
                <div className="selection-head">
                  <div className="selection-icon">
                    {selectedId === "base" ? (
                      <Layers2 size={21} />
                    ) : (
                      <House size={21} />
                    )}
                  </div>
                  <div>
                    <span className="mini-label">正在编辑</span>
                    <strong>
                      {selectedId === "base"
                        ? BASE_PRODUCT.name
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
                      <RotateCcw size={17} />
                    </button>
                    {selectedId !== "base" && (
                      <>
                        <button
                          className="round-button"
                          aria-label="旋转已选配件"
                          title="切换到下一个可安装方向"
                          onClick={rotateSelected}
                        >
                          <RotateCw size={18} />
                        </button>
                        <button
                          className="round-button danger"
                          aria-label="移除已选配件"
                          title="移除套餐"
                          onClick={removeSelected}
                        >
                          <Trash2 size={17} />
                        </button>
                      </>
                    )}
                    <button
                      className="round-button"
                      aria-label="收起编辑"
                      onClick={() => select(null)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                </div>
                {selectedId === "base" && (
                  <div className="base-options">
                    <div>
                      <span>支撑脚</span>
                      <div className="segmented">
                        <button
                          className={state.legHeight === 100 ? "active" : ""}
                          onClick={() => commit({ ...state, legHeight: 100 })}
                        >
                          10 cm
                        </button>
                        <button
                          className={state.legHeight === 200 ? "active" : ""}
                          onClick={() => commit({ ...state, legHeight: 200 })}
                        >
                          20 cm{" "}
                          <small>+{money(BASE_PRODUCT.tallLegSurcharge)}</small>
                        </button>
                      </div>
                    </div>
                    <div>
                      <span>平台中心</span>
                      <div className="segmented">
                        <button
                          className={state.baseInsert === "lid" ? "active" : ""}
                          onClick={() => changeInsert("lid")}
                        >
                          齐平圆盖
                        </button>
                        <button
                          className={
                            state.baseInsert === "pool" ? "active" : ""
                          }
                          onClick={() => changeInsert("pool")}
                        >
                          泳池{" "}
                          <small>+{money(BASE_PRODUCT.poolSurcharge)}</small>
                        </button>
                      </div>
                    </div>
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
                          {/^[LX]01$/.test(p.id) ? "四根支撑脚" : p.role}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                  <div className="swatches" aria-label="八种基础颜色">
                    {COLORS.map((c) => (
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
            )
          )}
          <div className="canvas-help">
            <Move size={13} />
            <span>拖动空白处旋转 · 双指缩放</span>
            <span className="help-separator">/</span>
            <span>选中配件可移动、旋转和换色</span>
          </div>
          <span className="studio-watermark">made for tiny friends ♡</span>
        </section>
        <aside className="catalog-panel" aria-label="组件商店">
          <div className="panel-tabs">
            <button
              className={panel === "catalog" ? "active" : ""}
              onClick={() => setPanel("catalog")}
            >
              <ShoppingBag size={17} />
              挑选配件
            </button>
            <button
              className={panel === "selected" ? "active" : ""}
              onClick={() => setPanel("selected")}
            >
              <Layers2 size={17} />
              已选搭配 <span>{state.items.length + 1}</span>
            </button>
          </div>
          {panel === "catalog" ? (
            <>
              <div className="catalog-intro">
                <div>
                  <h2>给小家添点喜欢</h2>
                  <p>整套配好，拖进画布就能搭。</p>
                </div>
                <span className="sparkle-stamp">
                  <Sparkles size={23} />
                </span>
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
                {visibleProducts.map((product) => {
                  const available =
                    getPlacements(state, product.id, rotation).length > 0;
                  return (
                    <article
                      key={product.id}
                      className={`product-card ${activeProduct === product.id ? "is-active" : ""} ${bounce === product.id ? "bounce-back" : ""}`}
                    >
                      <button
                        className="product-visual"
                        aria-label={`拖动或选择${product.name}`}
                        disabled={!ready}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !ready) return;
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
                          setActiveProduct(product.id);
                          setRotation(0);
                          if (!getPlacements(state, product.id, 0).length)
                            notify(
                              product.allowedParents?.includes("villa")
                                ? "先放入花园复式小屋，才有对应的二层磁吸位"
                                : "当前没有可用的匹配位置，可调整现有配件后再试。",
                            );
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
                          拖动搭建
                        </span>
                      </button>
                      <div className="product-info">
                        <h3>{product.name}</h3>
                        <p>
                          {product.parts.length > 1
                            ? `${product.parts.length} 件组合 · 套餐`
                            : "磁吸配件"}
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
                            onClick={() => {
                              setActiveProduct(product.id);
                              setRotation(0);
                            }}
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
                  只在匹配的磁吸位“咔哒”到位。
                  <br />
                  小屋、管道与支撑成套搭配，不会漏买。
                </p>
              </div>
            </>
          ) : (
            <div className="selected-list">
              <h2>你的小家，由这些组成</h2>
              <button
                className={`selected-row ${selectedId === "base" ? "active" : ""}`}
                onClick={() => select("base")}
              >
                <img src={`/thumbnails/base.png?v=${CATALOG_VERSION}`} alt="基础平台" />
                <span>
                  <strong>{BASE_PRODUCT.name}</strong>
                  <small>
                    四根 {state.legHeight / 10} cm 腿 ·{" "}
                    {state.baseInsert === "pool" ? "泳池" : "圆盖"}
                  </small>
                  <em>
                    {money(
                      BASE_PRODUCT.price +
                        (state.legHeight === 200
                          ? BASE_PRODUCT.tallLegSurcharge
                          : 0) +
                        (state.baseInsert === "pool"
                          ? BASE_PRODUCT.poolSurcharge
                          : 0),
                    )}
                  </em>
                </span>
                <ChevronDown size={15} />
              </button>
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
        </aside>
      </main>
      <footer className="checkout-bar">
        <div className="checkout-message">
          <span className="tiny-house">
            <House size={21} />
            <Heart size={9} />
          </span>
          <span>
            <strong>小小家人，值得满满用心</strong>
            <small>每一种搭配，都是独一份的喜欢。</small>
          </span>
        </div>
        <div className="checkout-total">
          <span>
            共 <b>{state.items.length + 1}</b> 组配件{" "}
            <span className="price-note">· 演示价格</span>
          </span>
          <strong>{money(total)}</strong>
        </div>
        <button
          className="outline-button footer-share"
          onClick={() => setModal("code")}
        >
          <Link size={16} />
          <span>分享搭配</span>
        </button>
        <button className="primary-button" onClick={() => setModal("order")}>
          <span>查看搭配清单</span>
          <ArrowRight size={17} />
        </button>
      </footer>
      {migrationNotice && (
        <div className="toast migration-notice" role="status">
          <Info size={18} />
          <span>{migrationNotice}</span>
          <button
            className="round-button"
            aria-label="关闭模型更新提示"
            onClick={() => setMigrationNotice("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {toast && !migrationNotice && (
        <div className="toast" role="status">
          <Info size={17} />
          {toast}
        </div>
      )}
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
                  完整搭配编号包含组件、颜色、位置和脚长。
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
                  placeholder="在这里粘贴完整的 HM 搭配编号…"
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
                              `${part} ${COLORS.find((v) => v.id === c)?.name ?? c}`,
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
                        已包含四根 10 cm 支撑脚。选中平台，就能切换 20 cm
                        脚、中心泳池和颜色。
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>02</span>
                    <div>
                      <h3>挑一件，拖进去</h3>
                      <p>
                        将配件图片拖到画布，靠近绿色圆环便会吸附。也可以先点选配件，再轻点画布里的圆环。不匹配的位置会退回。
                      </p>
                    </div>
                  </article>
                  <article>
                    <span>03</span>
                    <div>
                      <h3>转一转，涂上喜欢的颜色</h3>
                      <p>
                        选中配件可移动、旋转和换色；拖动画布空白处查看全貌。满意后复制搭配编号，或下载完整配件清单。
                      </p>
                    </div>
                  </article>
                </div>
                <div className="help-note">
                  <Magnet size={19} />
                  <p>
                    泳池和圆盖是平台内置选项；房屋顶盖、管道底座随套餐一起提供。移除底层小屋时，上面的配件也会一起移除。
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
