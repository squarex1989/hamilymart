/** Small capability-based shims for APIs actually used by this application. */
export function installRuntimeCompatibility() {
  const define = (target: object, key: string, value: unknown) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
  if (!Object.fromEntries) define(Object, 'fromEntries', function(entries: Iterable<[PropertyKey, unknown]>) {
    const result = {}; for (const [key, value] of entries) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true }); return result;
  });
  if (!Object.hasOwn) define(Object, 'hasOwn', (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key));
  if (!Array.prototype.flat) define(Array.prototype, 'flat', function(this: unknown[], depth = 1) {
    const result: unknown[] = []; const visit = (values: unknown[], level: number) => values.forEach(value => { if (Array.isArray(value) && level > 0) visit(value, level - 1); else result.push(value); }); visit(this, depth); return result;
  });
  if (!Array.prototype.flatMap) define(Array.prototype, 'flatMap', function(this: unknown[], fn: (value: unknown, index: number, values: unknown[]) => unknown, context?: unknown) { return this.map(fn, context).flat(1); });
  if (!Array.prototype.at) define(Array.prototype, 'at', function(this: unknown[], index: number) { const n = Math.trunc(Number(index) || 0); return this[n < 0 ? this.length + n : n]; });
  if (!String.prototype.replaceAll) define(String.prototype, 'replaceAll', function(this: string, search: string | RegExp, replacement: string) { if (search instanceof RegExp) { if (!search.global) throw new TypeError('replaceAll requires a global RegExp'); return String(this).replace(search, replacement); } return String(this).split(String(search)).join(replacement); });
  if (!Promise.prototype.finally) define(Promise.prototype, 'finally', function<T>(this: Promise<T>, callback: () => unknown) { return this.then(value => Promise.resolve(callback()).then(() => value), error => Promise.resolve(callback()).then(() => { throw error; })); });
  if (typeof window === 'undefined') return;
  if (!window.queueMicrotask) window.queueMicrotask = callback => { Promise.resolve().then(callback).catch(error => setTimeout(() => { throw error; }, 0)); };
  const media = window.matchMedia('(min-width: 0px)');
  if (typeof media.addEventListener !== 'function' && typeof media.addListener === 'function') {
    const proto = Object.getPrototypeOf(media);
    define(proto, 'addEventListener', function(this: MediaQueryList, type: string, fn: (event: MediaQueryListEvent) => void) { if (type === 'change') this.addListener(fn); });
    define(proto, 'removeEventListener', function(this: MediaQueryList, type: string, fn: (event: MediaQueryListEvent) => void) { if (type === 'change') this.removeListener(fn); });
  }
  if (!Element.prototype.scrollTo) define(Element.prototype, 'scrollTo', function(this: Element, options: ScrollToOptions | number, y?: number) { if (typeof options === 'number') { this.scrollLeft = options; this.scrollTop = y || 0; } else { if (options.left !== undefined) this.scrollLeft = options.left; if (options.top !== undefined) this.scrollTop = options.top; } });
  if (!window.ResizeObserver) {
    class LocalResizeObserver {
      private nodes = new Map<Element, string>();
      private pending = 0;
      private mutation: MutationObserver;
      constructor(private callback: ResizeObserverCallback) {
        this.mutation = new MutationObserver(this.schedule);
        window.addEventListener('resize', this.schedule);
        document.addEventListener('visibilitychange', this.schedule);
        this.mutation.observe(document.documentElement, { childList: true, subtree: true });
      }
      private schedule = () => {
        if (this.pending || document.hidden) return;
        this.pending = requestAnimationFrame(() => { this.pending = 0; const entries: ResizeObserverEntry[] = []; this.nodes.forEach((last, node) => { const box = node.getBoundingClientRect(); const key = `${box.width},${box.height}`; if (key !== last) { this.nodes.set(node, key); entries.push({ target: node, contentRect: box } as ResizeObserverEntry); } }); if (entries.length) this.callback(entries, this as unknown as ResizeObserver); });
      };
      observe(node: Element) { this.nodes.set(node, ''); this.schedule(); }
      unobserve(node: Element) { this.nodes.delete(node); }
      disconnect() { this.nodes.clear(); this.mutation.disconnect(); cancelAnimationFrame(this.pending); window.removeEventListener('resize', this.schedule); document.removeEventListener('visibilitychange', this.schedule); }
    }
    window.ResizeObserver = LocalResizeObserver as unknown as typeof ResizeObserver;
  }
}
installRuntimeCompatibility();
