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
