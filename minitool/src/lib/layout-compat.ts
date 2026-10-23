/** Chrome 61 layout fallbacks. Call once after body exists and before mounting React. */
const GAP_SELECTORS = ".brand, .main-nav, .main-nav > span, .main-nav > button, .header-actions, .save-status, .outline-button, .primary-button, .studio-badge, .magnet-toggle, .view-tools, .scale-label, .canvas-help, .selection-head, .selection-actions, .base-options, .restore-covers, .color-editor, .placement-card, .scene-loading, .platform-tools-heading, .platform-tools-heading > span, .platform-directions, .panel-tabs > button, .category-tabs, .product-grid, .drag-hint, .catalog-note, .selected-list, .selected-row, .checkout-bar, .checkout-message, .checkout-total, .checkout-bar .primary-button, .toast, .dialog-divider, .order-line > div, .help-steps, .help-steps > article, .help-note, .site-header, .footer-share, .header-code, .canvas-caption, .workspace-tabs, .dock-notice, .view-settings > summary, .dock-view-tools, .settings-navigation, .settings-navigation > button, .control-dock .selection-head, .control-dock .selection-actions, .control-dock .base-options, .control-dock .color-editor, .control-dock .swatches, .control-dock .checkout-bar, .control-dock .checkout-total, .control-dock .checkout-bar .primary-button, .environment-heading, .bedding-options, .bedding-option, .setting-note, .remove-hamster, .species-tabs, .hamster-grid, .hamster-choice, .control-dock .category-tabs, .control-dock .product-grid, .add-platform-card, .add-platform-card > span, .control-dock .selection-actions .round-button, .header-price, .header-global, .canvas-notice, .global-view-actions, .global-view-actions button, .global-links button, .canvas-bottom-actions, .canvas-bottom-actions > button, .clear-design-actions, .app-shell.is-mobile .canvas-bottom-actions, .app-shell.is-mobile .canvas-bottom-actions > button, .desktop-workbench-v2 .desktop-dock-heading, .desktop-workbench-v2 .back-to-catalog, .desktop-part-options, .desktop-color-options, .desktop-color-options button, .desktop-leg-options > div, .app-shell.is-mobile .header-actions, .app-shell.is-mobile .brand, .app-shell.is-mobile .header-price, .app-shell.is-mobile .site-header, .mobile-dock-header, .mobile-dock-header > button, .mobile-product-rail, .mobile-product, .mobile-add-platform .mobile-product-picture, .mobile-category-bar, .mobile-part-rail, .mobile-color-rail, .mobile-color-rail button, .mobile-edit-tools, .mobile-edit-tools button, .mobile-leg-options > div, .mobile-cover-options > div, .mobile-cover-options button, .mobile-workbench .history-actions, .mobile-edit-body, .mobile-leg-options, .scene-item-toolbar, .scene-item-actions, .scene-item-toolbar button, .scene-view-actions, .scene-view-actions button";

type StyledElement = HTMLElement | SVGElement;
type MarginSide = "margin-left" | "margin-right" | "margin-top" | "margin-bottom";
type MarginPatch = { element: StyledElement; side: MarginSide; original: string; priority: string; applied: string };
type FlexItem = { element: StyledElement | null; style: CSSStyleDeclaration | null; size: number };

/** A syntax query accepts Grid gap in engines that still lack Flex gap. */
function supportsFlexGap(): boolean {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;top:-9999px;";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.body.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  document.body.removeChild(probe);
  return supported;
}

export function initLayoutCompatibility(): () => void {
  const root = document.documentElement;
  const flexGap = supportsFlexGap();
  root.classList.toggle("supports-flex-gap", flexGap);
  const patches: MarginPatch[] = [];
  let frame = 0;
  let stopped = false;

  function restoreMargins() {
    for (const patch of patches) {
      // A later component style change takes precedence over our previous patch.
      if (patch.element.style.getPropertyValue(patch.side) !== patch.applied) continue;
      if (patch.original) patch.element.style.setProperty(patch.side, patch.original, patch.priority);
      else patch.element.style.removeProperty(patch.side);
    }
    patches.length = 0;
  }

  function updateViewport() {
    const viewport = window.visualViewport;
    const height = window.innerHeight;
    root.style.setProperty("--app-height", `${height}px`);
    root.style.setProperty("--app-viewport-top", `${viewport ? viewport.offsetTop : 0}px`);
    root.style.setProperty("--mobile-dock-height", `${Math.max(272, Math.min(332, height * .4))}px`);
    schedule();
  }

  function updateParentStates() {
    document.querySelectorAll(".studio").forEach(element => {
      element.classList.toggle("has-selection-card", !!element.querySelector(".selection-card"));
    });
    document.querySelectorAll(".base-options").forEach(element => {
      element.classList.toggle("has-restore-covers", !!element.querySelector(".restore-covers"));
    });
  }

  function applyFlexMargins() {
    restoreMargins();
    const additions = new Map<StyledElement, Map<MarginSide, number>>();
    const computed = new Map<StyledElement, CSSStyleDeclaration>();
    function add(element: StyledElement | null, side: MarginSide, amount: number) {
      if (!element || !amount) return;
      let sides = additions.get(element);
      if (!sides) { sides = new Map(); additions.set(element, sides); }
      sides.set(side, (sides.get(side) || 0) + amount);
    }
    // The selector list only contains containers declaring gap in the packaged CSS.
    // Collect all reads first; write margins afterwards to avoid repeated layout flushes.
    document.querySelectorAll<StyledElement>(GAP_SELECTORS).forEach(parent => {
      const style = getComputedStyle(parent);
      if ((style.display !== "flex" && style.display !== "inline-flex") || !parent.getClientRects().length) return;
      const rowGap = parseFloat(style.getPropertyValue("--compat-row-gap")) || 0;
      const columnGap = parseFloat(style.getPropertyValue("--compat-column-gap")) || 0;
      if (!rowGap && !columnGap) return;
      const column = style.flexDirection.indexOf("column") === 0;
      const reverse = style.flexDirection.indexOf("reverse") !== -1;
      const after: MarginSide = column ? (reverse ? "margin-top" : "margin-bottom") : (reverse ? "margin-left" : "margin-right");
      const before: MarginSide = column ? (reverse ? "margin-bottom" : "margin-top") : (reverse ? "margin-right" : "margin-left");
      const gap = column ? rowGap : columnGap;
      const items: FlexItem[] = [];
      parent.childNodes.forEach(node => {
        if (node.nodeType === 1) {
          const element = node as StyledElement;
          const childStyle = getComputedStyle(element);
          if (childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed") return;
          const rect = element.getBoundingClientRect();
          computed.set(element, childStyle);
          const size = column ? rect.height + (parseFloat(childStyle.marginTop) || 0) + (parseFloat(childStyle.marginBottom) || 0)
            : rect.width + (parseFloat(childStyle.marginLeft) || 0) + (parseFloat(childStyle.marginRight) || 0);
          items.push({ element, style: childStyle, size });
        } else if (node.nodeType === 3 && node.textContent && node.textContent.trim()) {
          // Keep React's text nodes intact; put the gap on the adjacent element.
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          items.push({ element: null, style: null, size: column ? rect.height : rect.width });
        }
      });
      const wrapping = !column && style.flexWrap !== "nowrap";
      const available = parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      let used = 0;
      let line = 0;
      let previous: FlexItem | undefined;
      for (const item of items) {
        if (wrapping && previous && used + gap + item.size > available + .5) {
          line++;
          previous = undefined;
          used = 0;
        }
        if (previous) {
          if (previous.element) add(previous.element, after, gap);
          else add(item.element, before, gap);
          used += gap;
        }
        if (line) add(item.element, "margin-top", rowGap);
        used += item.size;
        previous = item;
      }
    });
    additions.forEach((sides, element) => {
      const style = computed.get(element)!;
      sides.forEach((amount, side) => {
        const original = element.style.getPropertyValue(side);
        const priority = element.style.getPropertyPriority(side);
        const applied = `${(parseFloat(style.getPropertyValue(side)) || 0) + amount}px`;
        patches.push({ element, side, original, priority, applied });
        element.style.setProperty(side, applied);
      });
    });
  }

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target && target.closest(".scene-dimension-label")) return false;
      // Scene annotations repeatedly assign hidden while rendering; unchanged values need no work.
      if (record.type === "attributes" && target && record.attributeName && record.oldValue === target.getAttribute(record.attributeName)) return false;
      return true;
    });
    if (relevant) schedule();
  });
  function observe() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "hidden"] });
  }
  function refresh() {
    frame = 0;
    if (stopped) return;
    observer.disconnect();
    updateParentStates();
    if (!flexGap) applyFlexMargins();
    observe();
  }
  function schedule() {
    if (!frame && !stopped) frame = window.requestAnimationFrame(refresh);
  }

  updateViewport();
  observe();
  window.addEventListener("resize", updateViewport);
  window.addEventListener("orientationchange", updateViewport);
  const viewport = window.visualViewport;
  if (viewport) {
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
  }
  return () => {
    stopped = true;
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    restoreMargins();
    window.removeEventListener("resize", updateViewport);
    window.removeEventListener("orientationchange", updateViewport);
    if (viewport) {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    }
  };
}
