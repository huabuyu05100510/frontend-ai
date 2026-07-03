/* ================================================================
 * WaterfallEngine — 瀑布流引擎  v2.0 (content-visibility 重构)
 *
 * v2.0 架构变化（vs v1.0）：
 *   - 删除 DOMPool（节点池复用）—— 不再需要
 *   - 删除 visibleSet / findAnchor / 二分查找 —— 不再需要
 *   - 删除父→子 scroll postMessage 桥 —— 不再需要
 *   - 删除 _externalViewport 双视口抽象 —— 不再需要
 *
 *   取而代之：
 *   - .card 加 `content-visibility:auto; contain-intrinsic-size:auto <h>`
 *     浏览器原生跳过视口外卡片的 layout/paint/style 计算
 *   - 全量渲染所有卡片为 DOM，DOM 数 ≠ 渲染开销（content-visibility 把虚拟化下放浏览器）
 *   - ResizeObserver 仍监听所有卡片做"高度修正"（图片 onload 后实测高度回传 LayoutEngine）
 *     但 content-visibility 让视口外卡片永远不会触发 RO（没 layout 就没 size 变化）
 *
 * 面试叙事：
 *   "v1 我手写了 DOMPool + 二分查找 + RO 重排 + 滚动锚定补偿，~600 行。
 *    v2 我用 CSS Containment 把虚拟化下放到浏览器，~350 行。
 *    content-visibility: auto 是 Baseline 2025 特性，浏览器自己知道真实视口，
 *    比我手写的双视口抽象（iframe 撑高后 innerHeight=body高）更准。"
 *
 * 核心能力（保留）：
 *   - N 列瀑布流（贪心最短列）+ 不定高卡片
 *   - 二阶段高度：先按 estHeight 占位，RO 实测后增量重排
 *   - 图片加载导致上方卡片高度变化时，自动补偿 scrollTop 防跳
 *
 * 公开 API（与 v1 一致，向下兼容）：
 *   appendItems(items) / setItems(items) / updateItem(id, data)
 *   removeItem(id) / refreshLayout() / scrollToItem(id)
 *   getItemCount() / setDone() / destroy()
 * ================================================================ */

(function (global) {
  'use strict';

  // ──────────────────────────────────────────────
  // SizeCache — 高度缓存（estHeight → measuredHeight 二阶段）
  // ──────────────────────────────────────────────

  class SizeCache {
    constructor(defaultEstimate) {
      this._default = defaultEstimate;
      /** @type {Map<string|number, {est:number, real:number|null}>} */
      this._map = new Map();
    }

    setEstimate(id, h) {
      const e = this._map.get(id);
      if (e) {
        if (e.real == null) e.est = h;
      } else {
        this._map.set(id, { est: h, real: null });
      }
    }

    /**
     * 设置实测高度
     * @returns {boolean} 是否发生了显著变化（>1px）
     */
    setMeasured(id, h) {
      const e = this._map.get(id);
      if (!e) {
        this._map.set(id, { est: h, real: h });
        return true;
      }
      const old = e.real ?? e.est;
      e.real = h;
      return Math.abs(old - h) > 1;
    }

    getHeight(id) {
      const e = this._map.get(id);
      if (!e) return this._default;
      return e.real ?? e.est;
    }

    delete(id) { this._map.delete(id); }
    clear() { this._map.clear(); }

    invalidateAll() {
      for (const [, e] of this._map) e.real = null;
    }
  }

  // ──────────────────────────────────────────────
  // LayoutEngine — 贪心瀑布流布局
  //
  // 核心数据结构：
  //   _itemsRef[]       — 所有项 {id, estHeight}
  //   _colItems[][]     — 每列的项索引（push 顺序即单调递增 top）
  //   _colHeights[]     — 每列累计高度
  //   _layout[]         — 每项布局 {col, top, left}
  // ──────────────────────────────────────────────

  class LayoutEngine {
    constructor(opts) {
      this.columnCount = opts.columnCount;
      this.gap = opts.gap;
      this.cache = opts.sizeCache;
      this._itemsRef = opts.itemsRef;
      this._colItems = Array.from({ length: this.columnCount }, () => []);
      this._colHeights = new Array(this.columnCount).fill(0);
      this._layout = [];
      this.containerWidth = 0;
      this.totalHeight = 0;
    }

    get columnWidth() {
      return this.containerWidth > 0
        ? (this.containerWidth - this.gap * (this.columnCount - 1)) / this.columnCount
        : 0;
    }

    append(batch) {
      const startIdx = this._itemsRef.length - batch.length;
      for (const it of batch) {
        if (it.estHeight != null) this.cache.setEstimate(it.id, it.estHeight);
      }
      this._layoutFrom(startIdx);
    }

    replace() {
      this._colItems = Array.from({ length: this.columnCount }, () => []);
      this._colHeights = new Array(this.columnCount).fill(0);
      this._layout = [];
      this.totalHeight = 0;
      if (this._itemsRef.length > 0) this._layoutFrom(0);
    }

    afterRemove(removedIdx) {
      this._layout.splice(removedIdx, 1);
      for (let c = 0; c < this.columnCount; c++) {
        const arr = this._colItems[c];
        let w = 0;
        for (let r = 0; r < arr.length; r++) {
          if (arr[r] === removedIdx) continue;
          if (arr[r] > removedIdx) arr[r]--;
          arr[w++] = arr[r];
        }
        arr.length = w;
      }
      this._recalcColHeights();
      if (removedIdx < this._itemsRef.length) {
        this._layoutFrom(removedIdx);
      } else {
        this.totalHeight = Math.max(...this._colHeights);
      }
    }

    _recalcColHeights() {
      for (let c = 0; c < this.columnCount; c++) {
        const arr = this._colItems[c];
        if (arr.length === 0) { this._colHeights[c] = 0; continue; }
        const lastIdx = arr[arr.length - 1];
        const lo = this._layout[lastIdx];
        if (lo && lastIdx < this._itemsRef.length) {
          const h = this.cache.getHeight(this._itemsRef[lastIdx]?.id);
          this._colHeights[c] = lo.top + h + this.gap;
        }
      }
    }

    _layoutFrom(startIdx) {
      const cw = this.columnWidth;
      if (cw <= 0) return;
      for (let c = 0; c < this.columnCount; c++) {
        const arr = this._colItems[c];
        let cut = arr.length;
        while (cut > 0 && arr[cut - 1] >= startIdx) cut--;
        arr.length = cut;
      }
      this._recalcColHeights();

      const n = this._itemsRef.length;
      for (let i = startIdx; i < n; i++) {
        const it = this._itemsRef[i];
        if (!it) continue;
        let bestCol = 0;
        for (let c = 1; c < this.columnCount; c++) {
          if (this._colHeights[c] < this._colHeights[bestCol]) bestCol = c;
        }
        const h = this.cache.getHeight(it.id);
        const top = this._colHeights[bestCol];
        const left = bestCol === 0 ? 0 : bestCol * (cw + this.gap);
        this._layout[i] = { col: bestCol, top, left };
        this._colItems[bestCol].push(i);
        this._colHeights[bestCol] = top + h + this.gap;
      }
      this.totalHeight = Math.max(...this._colHeights);
    }

    remeasure(itemIdx) {
      const lo = this._layout[itemIdx];
      if (!lo) return false;
      const oldTop = lo.top;
      const oldTotal = this.totalHeight;
      this._colHeights[lo.col] = oldTop;
      const arr = this._colItems[lo.col];
      let cut = arr.length;
      while (cut > 0 && arr[cut - 1] >= itemIdx) cut--;
      arr.length = cut;
      this._layoutFrom(itemIdx);
      return Math.abs(this.totalHeight - oldTotal) > 1;
    }

    /**
     * 查找当前 scrollTop 位置最靠前的可见项（滚动锚定用）
     * v2 改为线性扫描 —— 全量渲染后没有"可视区"概念，但锚定补偿仍需要
     * 找到 top <= scrollTop 的最靠前 item（O(n)，但只在 RO 触发时跑，可接受）
     */
    findAnchor(scrollTop) {
      let best = null;
      for (let i = 0; i < this._layout.length; i++) {
        const lo = this._layout[i];
        if (!lo) continue;
        if (lo.top > scrollTop) break;
        const offset = scrollTop - lo.top;
        if (!best || offset < best.offset) {
          best = { idx: i, top: lo.top, offset };
        }
      }
      return best;
    }

    getLayoutById(id) {
      const idx = this._itemsRef.findIndex((it) => it && it.id === id);
      return this._layout[idx] ?? null;
    }

    /** v2 新增：按 idx 取 layout（避免 _itemsRef.findIndex 重复扫描） */
    getLayoutByIdx(idx) {
      return this._layout[idx] ?? null;
    }

    /** v2 新增：按 id 取 idx */
    getIdxById(id) {
      return this._itemsRef.findIndex((it) => it && it.id === id);
    }

    clear() {
      this._colItems = Array.from({ length: this.columnCount }, () => []);
      this._colHeights = new Array(this.columnCount).fill(0);
      this._layout = [];
      this.totalHeight = 0;
    }
  }

  // ──────────────────────────────────────────────
  // WaterfallEngine — 主引擎（v2 content-visibility 重构）
  // ──────────────────────────────────────────────

  class WaterfallEngine {
    /**
     * @param {object} opts
     * @param {HTMLElement} opts.container
     * @param {number} [opts.columnCount=2]
     * @param {number} [opts.gap=8]
     * @param {number} [opts.estimatedItemHeight=300]  默认预估高度（content-visibility 占位）
     * @param {number} [opts.loadMoreThreshold=600]
     * @param {function} opts.itemRenderer
     * @param {function} [opts.itemUpdater]
     * @param {function} [opts.onLoadMore]
     * @param {function} [opts.onRender]
     */
    constructor(opts) {
      this.container = opts.container;
      this.columnCount = opts.columnCount ?? 2;
      this.gap = opts.gap ?? 8;
      this.loadMoreThreshold = opts.loadMoreThreshold ?? 600;
      this._itemRenderer = opts.itemRenderer;
      this._itemUpdater = opts.itemUpdater || ((el, item) => {
        const t = el.querySelector('.card-title');
        if (t) t.textContent = item.title ?? '';
      });
      this._onLoadMore = opts.onLoadMore || null;
      this._onRender = opts.onRender || null;

      /** @type {object[]} */
      this._items = [];
      /** @type {Map<string|number, HTMLElement>} id → el */
      this._elMap = new Map();
      this._loading = false;
      this._done = false;
      this._destroyed = false;
      this._scrollTicking = false;
      this._scrollTop = 0;

      this._cache = new SizeCache(opts.estimatedItemHeight ?? 300);
      this._layoutEngine = new LayoutEngine({
        columnCount: this.columnCount,
        gap: this.gap,
        sizeCache: this._cache,
        itemsRef: this._items,
      });

      this._measureContainer();
      this._bindEvents();
      this._initRO();
    }

    // ════════════════════════════════════════════
    // 公开 API
    // ════════════════════════════════════════════

    appendItems(batch) {
      if (!batch || batch.length === 0) return;
      const t0 = performance.now();
      const startIdx = this._items.length;
      this._items.push(...batch);
      this._layoutEngine.append(batch);

      // 全量渲染新增项 —— content-visibility 让浏览器跳过视口外的 layout/paint
      const colW = this._layoutEngine.columnWidth;
      const frag = document.createDocumentFragment();
      for (let i = startIdx; i < this._items.length; i++) {
        const item = this._items[i];
        const lo = this._layoutEngine.getLayoutByIdx(i);
        if (!item || !lo) continue;
        const el = this._itemRenderer(item);
        this._applyLayout(el, item, lo, colW);
        this._elMap.set(item.id, el);
        this._ro.observe(el);
        frag.appendChild(el);
      }
      this.container.appendChild(frag);
      this.container.style.height = this._layoutEngine.totalHeight + 'px';

      this._emitRender(performance.now() - t0);
    }

    setItems(items) {
      // 清空
      this._items.length = 0;
      this._elMap.clear();
      this.container.innerHTML = '';
      this._cache.clear();
      this._layoutEngine.clear();

      if (items && items.length > 0) this._items.push(...items);
      this._layoutEngine.replace();

      // 全量渲染
      const colW = this._layoutEngine.columnWidth;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < this._items.length; i++) {
        const item = this._items[i];
        const lo = this._layoutEngine.getLayoutByIdx(i);
        if (!item || !lo) continue;
        const el = this._itemRenderer(item);
        this._applyLayout(el, item, lo, colW);
        this._elMap.set(item.id, el);
        this._ro.observe(el);
        frag.appendChild(el);
      }
      this.container.appendChild(frag);
      this.container.style.height = this._layoutEngine.totalHeight + 'px';

      this._done = false;
      this._scrollTop = 0;
      window.scrollTo(0, 0);
      this._checkLoadMore();
      this._emitRender(0);
    }

    updateItem(id, data) {
      const idx = this._layoutEngine.getIdxById(id);
      if (idx === -1) return;
      Object.assign(this._items[idx], data);
      if (data.estHeight != null) {
        this._cache.setEstimate(id, data.estHeight);
        const lo = this._layoutEngine.getLayoutByIdx(idx);
        if (lo) {
          this._layoutEngine._colHeights[lo.col] = lo.top;
          const arr = this._layoutEngine._colItems[lo.col];
          let cut = arr.length;
          while (cut > 0 && arr[cut - 1] >= idx) cut--;
          arr.length = cut;
          this._layoutEngine._layoutFrom(idx);
          this._applyAllLayout();
        }
      }
      const el = this._elMap.get(id);
      if (el) this._itemUpdater(el, this._items[idx]);
    }

    removeItem(id) {
      const idx = this._layoutEngine.getIdxById(id);
      if (idx === -1) return;
      const el = this._elMap.get(id);
      if (el) {
        this._ro.unobserve(el);
        if (el.parentNode) el.parentNode.removeChild(el);
        this._elMap.delete(id);
      }
      this._items.splice(idx, 1);
      this._cache.delete(id);
      this._layoutEngine.afterRemove(idx);
      this._applyAllLayout();
    }

    refreshLayout() {
      this._cache.invalidateAll();
      this._measureContainer();
      this._layoutEngine.clear();
      this._layoutEngine.replace();
      this._applyAllLayout();
      // 重观察所有卡片（invalidate 后 RO 会重新测）
      for (const el of this._elMap.values()) {
        this._ro.observe(el);
      }
    }

    scrollToItem(id, align = 'start') {
      const lo = this._layoutEngine.getLayoutById(id);
      if (!lo) return;
      const vh = window.innerHeight;
      let target = lo.top;
      if (align === 'center') target -= vh / 2;
      else if (align === 'end') target -= vh;
      window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    getItemCount() { return this._items.filter(Boolean).length; }
    setDone() { this._done = true; }

    destroy() {
      this._destroyed = true;
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      window.removeEventListener('scroll', this._scrollHandler);
      window.removeEventListener('resize', this._resizeHandler);
      if (this._loadMoreTimer) clearTimeout(this._loadMoreTimer);
      this._elMap.clear();
      this._cache.clear();
      this._layoutEngine.clear();
      this.container.innerHTML = '';
      this._items = [];
    }

    // ════════════════════════════════════════════
    // 内部
    // ════════════════════════════════════════════

    /** 给单个 el 设位置 + 宽度 + 内联 contain-intrinsic-size（按 estHeight 占位） */
    _applyLayout(el, item, lo, colW) {
      el.dataset.wfId = item.id;
      el.style.position = 'absolute';
      el.style.width = colW + 'px';
      el.style.left = lo.left + 'px';
      el.style.top = lo.top + 'px';
      // 每张卡片按自己的 estHeight 设 contain-intrinsic-size 占位
      // 'auto <h>' 让浏览器记忆上次渲染高度，下次跳过 layout 时用记忆值
      const estH = item.estHeight ?? this._cache.getHeight(item.id) ?? 240;
      el.style.containIntrinsicSize = `auto ${estH}px`;
      this._itemUpdater(el, item);
    }

    /** 全量重新 apply layout（resize / remeasure / remove 后调用） */
    _applyAllLayout() {
      const colW = this._layoutEngine.columnWidth;
      for (let i = 0; i < this._items.length; i++) {
        const item = this._items[i];
        const lo = this._layoutEngine.getLayoutByIdx(i);
        if (!item || !lo) continue;
        const el = this._elMap.get(item.id);
        if (!el) continue;
        el.style.left = lo.left + 'px';
        el.style.top = lo.top + 'px';
      }
      this.container.style.height = this._layoutEngine.totalHeight + 'px';
    }

    _bindEvents() {
      this._scrollHandler = () => {
        this._scrollTop = window.scrollY || 0;
        if (this._scrollTicking) return;
        this._scrollTicking = true;
        requestAnimationFrame(() => {
          this._scrollTicking = false;
          if (this._destroyed) return;
          this._checkLoadMore();
        });
      };
      window.addEventListener('scroll', this._scrollHandler, { passive: true });

      this._resizeHandler = () => {
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
          if (this._destroyed) return;
          this.refreshLayout();
        }, 150);
      };
      window.addEventListener('resize', this._resizeHandler);
    }

    /** RO 监听所有卡片 —— content-visibility 让视口外卡片永不触发 */
    _initRO() {
      this._ro = new ResizeObserver((entries) => {
        if (this._destroyed) return;
        let minIdx = Infinity;
        for (const entry of entries) {
          const el = entry.target;
          const id = el.dataset.wfId;
          if (id == null) continue;
          const newH = entry.contentRect.height;
          if (this._cache.setMeasured(id, newH)) {
            const idx = this._layoutEngine.getIdxById(id);
            if (idx !== -1 && idx < minIdx) minIdx = idx;
          }
        }
        if (minIdx === Infinity) return;

        // 滚动锚定补偿：图片 onload 导致上方卡片高度变化时防跳
        const anchor = this._layoutEngine.findAnchor(this._scrollTop);
        this._layoutEngine.remeasure(minIdx);

        if (anchor && anchor.idx < this._items.length) {
          const anchorId = this._items[anchor.idx]?.id;
          const newLayout = this._layoutEngine.getLayoutById(anchorId);
          if (newLayout) {
            const delta = newLayout.top - anchor.top;
            if (Math.abs(delta) > 1) {
              const target = this._scrollTop + delta;
              if (target >= 0 && Math.abs(target - this._scrollTop) > 2) {
                this._scrollTop = target;
                window.scrollTo(0, target);
              }
            }
          }
        }
        this._applyAllLayout();
      });
    }

    _measureContainer() {
      this._layoutEngine.containerWidth = this.container.clientWidth;
    }

    _checkLoadMore() {
      if (this._loading || this._done || !this._onLoadMore) return;
      const scrollH = document.documentElement.scrollHeight;
      const remain = scrollH - (this._scrollTop + window.innerHeight);
      if (remain < this.loadMoreThreshold) {
        this._loading = true;
        clearTimeout(this._loadMoreTimer);
        this._loadMoreTimer = setTimeout(() => {
          if (this._destroyed || this._done) return;
          Promise.resolve(this._onLoadMore())
            .then(() => { this._loading = false; })
            .catch(() => { this._loading = false; });
        }, 200);
      }
    }

    _emitRender(renderTime) {
      if (!this._onRender) return;
      this._onRender({
        visibleCount: this._elMap.size,
        total: this._items.filter(Boolean).length,
        poolActive: this._elMap.size,
        poolIdle: 0,
        renderTime: renderTime || 0,
      });
    }
  }

  global.WaterfallEngine = WaterfallEngine;

})(window);
