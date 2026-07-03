/**
 * SdkInjector —— beforeParse 默认实现
 *
 * 面试金句：老 Vue2 项目里没有 A+ 埋点 / SSO / AB 实验。
 * 引擎在 HTML 解析阶段统一注入，老代码一行不改就自动有了。
 *
 * 注入 4 件事（对应面试文档 5.3）：
 *   1. data-track 全局点击监听 → window.parent.__RUM__.track(...)
 *   2. A+ SDK script
 *   3. window.__USER__（登录态）
 *   4. window.__AB__（实验分组）
 *
 * 坑#2 解法（top.postMessage 跨域）：注入脚本里把 window.top 重定向到 window.parent，
 * 老代码 top.postMessage(...) 实际走 parent.postMessage，同源不出错。
 */

import type { ParseContext } from './types'

export function injectSdk(dom: Document, ctx: ParseContext): void {
  const head = dom.head
  if (!head) return

  // 1. RUM 桥：把子应用里的 track/error 调用透到主应用 __RUM__
  const rum = dom.createElement('script')
  rum.textContent = `
    (function(){
      var sink = window.parent && window.parent.__RUM__;
      window.__RUM__ = {
        track: function(e,p){ try{ sink && sink.track(e,p) }catch(_){} },
        metric: function(n,v){ try{ sink && sink.metric(n,v) }catch(_){} },
        error: function(err,m){ try{ sink && sink.error(err,m) }catch(_){} }
      };
      // 坑#2：老代码 top.postMessage(...) 跨域会报错，代理 top 指向 parent
      try { Object.defineProperty(window, 'top', { value: window.parent, configurable: true }); } catch(_){}
      // 自动埋点：data-track 的元素点击透传
      document.addEventListener('click', function(e){
        var t = e.target && e.target.closest && e.target.closest('[data-track]');
        if (t) window.__RUM__.track(t.dataset.track || 'unknown');
      }, true);
    })();
  `
  head.insertBefore(rum, head.firstChild)

  // 2. ModelScope 风格高度上报桥：__SANDBOX__.reportHeight(h) → parent.postMessage
  //    配合 auto-measure 片段：DOMContentLoaded + ResizeObserver 自动量 body 高度上报
  //    引擎端（index.ts）有 WeakMap<contentWindow,iframe> 反查 + RAF+100ms 节流 + ceil+1px 抖动过滤
  //
  //    wujie 模式跳过此段：iframe 隐藏（visibility:hidden + 0 尺寸），body 永远空，
  //    measure 上报会误导引擎把 iframe 设成 0 高。wujie 模式下子应用 DOM 在主文档，
  //    高度由主文档自然决定，不需要同步。
  if (ctx.mode !== 'wujie') {
    const height = dom.createElement('script')
    height.textContent = `
      (function(){
        var throttle = 0, lastH = 0, raf = 0;
        window.__SANDBOX__ = window.__SANDBOX__ || {};
        window.__SANDBOX__.reportHeight = function(h){
          h = Math.max(0, h|0);
          if (Math.abs(h - lastH) <= 1) return;            // 抖动过滤
          lastH = h;
          var now = Date.now();
          if (now - throttle < 100) {                       // 100ms 节流
            if (!raf) raf = requestAnimationFrame(function(){
              raf = 0; post(h);
            });
            return;
          }
          post(h);
        };
        function post(h){
          throttle = Date.now();
          try { parent.postMessage({type:'sandbox:height', height: h}, '*'); }catch(_){}
        }
        function measure(){
          var b = document.body;
          if (!b) return;
          // ⚠️ 只读 body.scrollHeight：documentElement.scrollHeight 在 iframe 有 min-height 时
          //   返回的是 iframe 视口高（min-height 兜底值）而非内容高 → 会把 iframe 锁死在 min-height
          var h = b.scrollHeight;
          if (h > 0) window.__SANDBOX__.reportHeight(h);
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', measure);
        } else { measure(); }
        window.addEventListener('load', measure);
        // body 高度变化监测：
        //   1) ResizeObserver 监听当前 body（图片懒加载/异步渲染触发）
        //   2) MutationObserver 监听 documentElement 子树 —— Gradio/SvelteKit hydration 会整个替换 body，
        //      老 body 上的 RO 失效，必须检测替换后重新挂 RO
        //   3) 1s 定时轮询兜底（防 RO/MO 在极端情况下漏触发）
        var ro = null;
        function attachRO(){
          if (!document.body) return;
          if (ro) { try { ro.disconnect(); } catch(_){} }
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(function(){ measure(); });
            ro.observe(document.body);
          }
        }
        attachRO();
        document.addEventListener('DOMContentLoaded', attachRO);
        if (typeof MutationObserver !== 'undefined') {
          new MutationObserver(function(){ attachRO(); measure(); }).observe(document.documentElement, { childList: true, subtree: false });
        }
        setInterval(measure, 1000);
      })();
    `
    // 注意：rum 必须保持是 head 的第一个 script（SandboxCore 测试断言 firstChild.textContent），
    // 所以 height 插到 rum 之后而非之前
    head.insertBefore(height, rum.nextSibling)
  }

  // 2. A+ SDK（mock url，生产是集团统一 CDN）
  const aplus = dom.createElement('script')
  aplus.src = '/mock-internal-sdk/aplus.js'
  aplus.setAttribute('data-mock', 'true')
  aplus.onerror = () => ctx.rum.error(new Error('aplus load failed'), { appName: ctx.appName })
  head.appendChild(aplus)

  // 3+4. 登录态 + AB 分组（小数据，HTML 解析时同步可用）
  // ⚠ 安全：JSON.stringify 后必须转义 < / U+2028 / U+2029，
  //   否则 user.displayName = '</script><img onerror=...>' 会截断脚本块（OWASP XSS）。
  const data = dom.createElement('script')
  data.textContent = `
    window.__USER__ = ${safeInlineJson(ctx.user ?? null)};
    window.__AB__ = ${safeInlineJson(ctx.abConfig ?? {})};
  `
  head.appendChild(data)
}

/**
 * 把任意值序列化成可安全内嵌在 <script>...</script> 的 JSON 文本。
 *  - `<` → \u003c 让 `</script>` 注入失效
 *  - U+2028 / U+2029 是 JS 行分隔符，旧引擎会认为脚本被换行符截断
 *  - `>` 一并转义（防御性，部分 lint 规则会标记未配对的 `>`）
 */
function safeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
