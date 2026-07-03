/**
 * WujieSandbox —— iframe JS 沙箱 + DOM 投影到主文档
 *
 * 核心思路（wujie 真路线）：
 *   1. iframe 跑子应用 JS（同源，window/document/location/history 天然隔离）
 *   2. iframe 隐藏（visibility:hidden + 0 尺寸），但 display 不能 none（rAF 会暂停）
 *   3. 注入一段 patch 脚本到 dom.head 最前面（子应用脚本解析前执行），劫持：
 *      - document.createElement / createTextNode / createDocumentFragment → 在主文档创建并打标
 *      - document.body (getter) → 主文档 host 元素
 *      - document.getElementById / querySelector / querySelectorAll → 查主文档 host
 *      - window.scrollY / pageYOffset / innerHeight / innerWidth (getter) → 读 parent 对应值
 *      - document.documentElement (getter) → parent.document.documentElement
 *      - window.addEventListener / removeEventListener（scroll/resize）→ 转发到 parent
 *      - window.scrollTo → parent.scrollTo
 *      - window.ResizeObserver → parent.ResizeObserver（跨 realm 观察主文档元素）
 *
 * 关键 insight：劫持 document.getElementById 让其返回主文档 host 内真实元素。
 *   `container.appendChild(frag)` 自然在主文档元素之间工作 → 不需要劫持 Element.prototype.appendChild。
 *
 * 不解决的（POC 范围外）：
 *   - ShadowDOM CSS 隔离（第一阶段把子应用 <style> 注入主文档 <head>，承认泄漏）
 *   - Element.prototype.appendChild/removeChild/insertBefore 通用劫持（vue2/jquery/react 用得到，第二阶段）
 *   - getBoundingClientRect patch（content-visibility 引擎不调用，第二阶段）
 */

import type { WujieContext } from './types'

/**
 * 创建主文档 host 元素 —— 接收子应用投影的 DOM。
 * 调用方（index.ts activate）负责把它附加到沙箱 container，并在 destroy 时清理。
 */
export function createHostElement(opts: {
  appName: string
  container: HTMLElement
}): HTMLElement {
  const host = document.createElement('div')
  host.dataset.wujieHost = opts.appName
  host.style.cssText = 'width:100%;min-height:600px;display:block'
  opts.container.appendChild(host)
  return host
}

/**
 * 把 patch 脚本注入到 dom.head 最前面（先于 SdkInjector 注入的脚本，先于子应用脚本）。
 * 脚本在 iframe context 执行，通过 parent[hostKey] 找到主文档 host。
 */
export function installWujiePatches(dom: Document, ctx: WujieContext): void {
  const head = dom.head
  if (!head) return

  const script = dom.createElement('script')
  script.textContent = buildPatchScript(ctx.hostKey)
  // insertBefore firstChild 保证 patch 在所有 head 子节点前执行
  head.insertBefore(script, head.firstChild)
}

/**
 * 清理主文档上的 host 元素和 parent window 上的全局引用。
 * 在 destroy(appName) 和 lru:evict 时调用。
 */
export function uninstallWujiePatches(ctx: WujieContext): void {
  try {
    delete (window as unknown as Record<string, unknown>)[ctx.hostKey]
  } catch { /* ignore */ }
  if (ctx.hostElement.parentNode) {
    ctx.hostElement.parentNode.removeChild(ctx.hostElement)
  }
}

/**
 * 构造 patch 脚本源码。参数化 hostKey 以支持多 wujie 应用并发。
 *
 * 注意：脚本在 iframe context 中运行。所有 parent 访问包 try/catch 防 unload 时崩溃。
 */
function buildPatchScript(hostKey: string): string {
  return `
(function(){
  'use strict';
  var HOST_KEY = ${JSON.stringify(hostKey)};
  var parent, pdoc, host;
  try { parent = window.parent; pdoc = parent.document; host = parent[HOST_KEY]; } catch(_) { return; }
  if (!host) return;

  // 标记：所有通过 patched createElement 创建的元素带 data-wujie="1"
  // （RO 监听时可用于过滤；hash 检查避免重复打标）
  function brand(el) {
    try { el.setAttribute('data-wujie', '1'); } catch(_) {}
    return el;
  }

  // ───── 写路径：DOM 创建/查询全部走主文档 ─────

  var origCreateElement = document.createElement.bind(document);
  document.createElement = function(tag){
    try { return brand(pdoc.createElement(tag)); }
    catch(_) { return origCreateElement(tag); }
  };

  var origCreateTextNode = document.createTextNode.bind(document);
  document.createTextNode = function(text){
    try { return pdoc.createTextNode(text); }
    catch(_) { return origCreateTextNode(text); }
  };

  var origCreateFragment = document.createDocumentFragment.bind(document);
  document.createDocumentFragment = function(){
    try { return pdoc.createDocumentFragment(); }
    catch(_) { return origCreateFragment(); }
  };

  // document.body getter → 主文档 host
  // 注意：用 try/catch 包 defineProperty，部分严格模式下不可配置会抛
  try {
    Object.defineProperty(document, 'body', {
      get: function(){ return host; },
      configurable: true,
    });
  } catch(_) {}

  // document.documentElement → 主文档 documentElement
  // 子应用读 document.documentElement.scrollHeight 时实际读主文档（虚拟列表 _checkLoadMore）
  try {
    Object.defineProperty(document, 'documentElement', {
      get: function(){ return pdoc.documentElement; },
      configurable: true,
    });
  } catch(_) {}

  // ───── iframe body → host 实时投影 ─────
  // 关键：HTML parser 创建的元素（如 wf-container）进入 iframe 真实 body（不是 patched getter），
  // 因为 parser 不走 patched document.body.appendChild。必须用 MutationObserver 监听 iframe 真实 body
  // 子节点变化，实时 adopt 到 host。子应用脚本执行时（脚本解析触发），microtask 已刷新 → host 有元素。

  // 保留原 body getter 用于拿到真实 body（绕过 patch）
  var origBodyGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'body').get;

  function adoptAll() {
    var realBody = origBodyGetter.call(document);
    if (!realBody) return;
    var children = realBody.children;
    var adopted = false;
    // 倒序 adopt 保持顺序（appendChild 到 host 反转 → 用 insertBefore 到首部）
    for (var i = children.length - 1; i >= 0; i--) {
      var node = children[i];
      if (node.tagName === 'SCRIPT') continue;  // script 不投影，由 parser 自己执行
      // 跨 document appendChild 浏览器自动 adopt；用主文档 host 接收
      try { host.insertBefore(node, host.firstChild); adopted = true; } catch(_) {}
    }
    return adopted;
  }

  // adopt 完成后给 parent 派发 resize 事件：
  // 子应用 init 时（patch 还在 head 第一位执行，body 解析未完，wf-container 未 adopt）
  // 读到的 container.clientWidth=0 → columnWidth=0 → 所有卡片宽 0。
  // adopt 完成后 host 内 container 才有真实宽度。
  // 注意：patched window.addEventListener 把 resize 转发到 parent（让虚拟列表/_scrollHandler 工作），
  // 所以 dispatch 必须发到 parent，不是 iframe window。
  function notifyResize() {
    try { parent.dispatchEvent(new Event('resize')); } catch(_) {
      try { parent.dispatchEvent(new UIEvent('resize')); } catch(__) {}
    }
  }

  // MO 监听真实 body 的子节点变化（parser 加元素时触发 microtask）
  try {
    var realBody0 = origBodyGetter.call(document);
    if (realBody0) {
      var mo = new MutationObserver(function(){
        if (adoptAll()) notifyResize();
      });
      mo.observe(realBody0, { childList: true, subtree: false });
      // 立即 adopt 一次（patch 执行时 body 可能已有部分子节点）
      if (adoptAll()) notifyResize();
    } else {
      // body 还没解析，等 DOMContentLoaded
      document.addEventListener('DOMContentLoaded', function(){
        if (adoptAll()) notifyResize();
      });
    }
  } catch(_) {}

  // getElementById / querySelector / querySelectorAll → 查主文档（host 优先，fallback 真实 body）
  // 注意：子应用脚本执行时，元素可能还在 adopt 过程中（MO microtask 未刷新），
  //       fallback 查真实 body 提高鲁棒性
  var origGetById = document.getElementById.bind(document);
  document.getElementById = function(id){
    try {
      var sel = '#' + (window.CSS && CSS.escape ? CSS.escape(id) : id);
      var el = host.querySelector(sel);
      if (el) return el;
      // fallback: 真实 body 里找（adopt 未完成时）
      var realBody = origBodyGetter.call(document);
      if (realBody) {
        el = realBody.querySelector(sel);
        if (el) return el;
      }
      return pdoc.getElementById(id);
    } catch(_) { return null; }
  };
  var origQuerySelector = document.querySelector.bind(document);
  var origQuerySelectorAll = document.querySelectorAll.bind(document);
  document.querySelector = function(sel){
    try {
      var el = host.querySelector(sel);
      if (el) return el;
      var realBody = origBodyGetter.call(document);
      if (realBody) { el = realBody.querySelector(sel); if (el) return el; }
      return pdoc.querySelector(sel);
    } catch(_) { return null; }
  };
  document.querySelectorAll = function(sel){
    try {
      var hostNodes = host.querySelectorAll(sel);
      if (hostNodes.length > 0) return hostNodes;
      var realBody = origBodyGetter.call(document);
      if (realBody) {
        var bodyNodes = realBody.querySelectorAll(sel);
        if (bodyNodes.length > 0) return bodyNodes;
      }
      return pdoc.querySelectorAll(sel);
    } catch(_) { return []; }
  };

  // ───── 读路径：scroll/viewport 全部读 parent ─────

  function defineWindowGetter(prop, getter) {
    try {
      Object.defineProperty(window, prop, { get: getter, configurable: true });
    } catch(_) {
      try { window.__defineGetter__(prop, getter); } catch(__) {}
    }
  }

  defineWindowGetter('scrollY', function(){ try { return parent.scrollY; } catch(_) { return 0; } });
  defineWindowGetter('pageYOffset', function(){ try { return parent.scrollY; } catch(_) { return 0; } });
  defineWindowGetter('scrollX', function(){ try { return parent.scrollX; } catch(_) { return 0; } });
  defineWindowGetter('pageXOffset', function(){ try { return parent.scrollX; } catch(_) { return 0; } });
  defineWindowGetter('innerHeight', function(){ try { return parent.innerHeight; } catch(_) { return 0; } });
  defineWindowGetter('innerWidth', function(){ try { return parent.innerWidth; } catch(_) { return 0; } });

  // ───── 事件：scroll/resize 注册到 parent（核心：让虚拟列表 _scrollHandler 工作） ─────

  var forwardedListeners = []; // [type, fn, opts] 三元组，removeEventListener 时反查
  var FORWARD_TYPES = { scroll: true, resize: true };

  var origAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = function(type, fn, opts){
    if (FORWARD_TYPES[type]) {
      try {
        parent.addEventListener(type, fn, opts);
        forwardedListeners.push([type, fn, opts]);
        return;
      } catch(_) {}
    }
    return origAddEventListener(type, fn, opts);
  };

  var origRemoveEventListener = window.removeEventListener.bind(window);
  window.removeEventListener = function(type, fn, opts){
    if (FORWARD_TYPES[type]) {
      try { parent.removeEventListener(type, fn, opts); } catch(_) {}
      // 清理记录
      for (var i = forwardedListeners.length - 1; i >= 0; i--) {
        var e = forwardedListeners[i];
        if (e[0] === type && e[1] === fn) { forwardedListeners.splice(i, 1); break; }
      }
      return;
    }
    return origRemoveEventListener(type, fn, opts);
  };

  // scrollTo → parent.scrollTo（虚拟列表 scrollToItem 用）
  window.scrollTo = function(){
    try { return parent.scrollTo.apply(parent, arguments); } catch(_) {}
  };

  // ───── ResizeObserver：跨 realm 观察主文档元素 ─────
  // Chromium 支持 iframe 内 new RO observe 主文档元素；FF/Safari 未验证（POC 仅 Chromium）
  try { window.ResizeObserver = parent.ResizeObserver; } catch(_) {}

  // ───── CSS 注入：把子应用 <style> 块搬到主文档 <head> ─────
  // POC 阶段允许 CSS 泄漏（单 wujie 应用可接受）。第二阶段升 ShadowDOM。
  // 用 MutationObserver 监听 iframe head 新增的 <style> / <link rel="stylesheet">，
  // clone 一份到主文档 head。
  try {
    var mo = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          var tag = n.tagName;
          if (tag === 'STYLE') {
            var clone = pdoc.createElement('style');
            clone.textContent = n.textContent;
            clone.setAttribute('data-wujie-css', '1');
            pdoc.head.appendChild(clone);
          } else if (tag === 'LINK' && (n.rel === 'stylesheet' || n.type === 'text/css')) {
            var lc = pdoc.createElement('link');
            lc.rel = 'stylesheet';
            lc.href = n.href;
            lc.setAttribute('data-wujie-css', '1');
            pdoc.head.appendChild(lc);
          }
        }
      }
    });
    mo.observe(document.head, { childList: true, subtree: false });
    // 标记：destroy 时通过 host.dataset 派生清理（cleanup 函数遍历主文档 head 删 data-wujie-css 节点）
  } catch(_) {}

  // 标记完成（调试用）
  try { window.__WUJIE_PATCHED__ = true; } catch(_) {}

  // ───── uninstall：把所有劫持还原 ─────
  // 池里的 iframe 复用时（vue2/jquery 接手 wujie 用过的 iframe），
  // patch 残留在 contentWindow 会污染下一个子应用（document.createElement 调主文档、
  // body getter 返回 host 已被销毁等）。IframePool.resetIframe 必须调 __WUJIE_UNINSTALL__。
  window.__WUJIE_UNINSTALL__ = function(){
    try {
      // 还原 document 方法
      if (origCreateElement) document.createElement = origCreateElement;
      if (origCreateTextNode) document.createTextNode = origCreateTextNode;
      if (origCreateFragment) document.createDocumentFragment = origCreateFragment;
      if (origGetById) document.getElementById = origGetById;
      if (origQuerySelector) document.querySelector = origQuerySelector;
      if (origQuerySelectorAll) document.querySelectorAll = origQuerySelectorAll;
      // 还原 document.body / documentElement getter（deleteProperty 让原生 getter 复活）
      try { delete document.body; } catch(_) {}
      try { delete document.documentElement; } catch(_) {}
      // 还原 window getter（用 deleteProperty）
      ['scrollY','pageYOffset','scrollX','pageXOffset','innerHeight','innerWidth'].forEach(function(p){
        try { delete window[p]; } catch(_) {}
      });
      // 还原 addEventListener / removeEventListener / scrollTo
      if (origAddEventListener) window.addEventListener = origAddEventListener;
      if (origRemoveEventListener) window.removeEventListener = origRemoveEventListener;
      try { delete window.scrollTo; } catch(_) {}
      // RO 不能精确还原（可能被多次覆盖），用 parent.RO 兜底（旧子应用读到 parent.RO 也能跑）
      try { window.ResizeObserver = parent.ResizeObserver; } catch(_) {}
      try { delete window.__WUJIE_PATCHED__; } catch(_) {}
      try { delete window.__WUJIE_UNINSTALL__; } catch(_) {}
    } catch(_) {}
  };
})();
`
}
