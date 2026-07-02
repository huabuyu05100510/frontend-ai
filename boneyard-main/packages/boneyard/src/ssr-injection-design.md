# Boneyard SSR 注入详细设计方案

> 扫描 /Users/didi/Documents/code 下的 skeleton 项目后更新
> 参考项目：smarty-skeleton-toolchain / smarty-skeleton-v1/v2 / visual-skeleton-plugin / Trinity Chrome Extension

---

## 一、设计目标

| 目标 | 说明 |
|------|------|
| 首次访问零闪烁 | HTML 返回时骨架立即可见，不依赖 JS bundle 加载 |
| 零跨团队耦合 | 服务端团队安装中间件一次，永不维护骨架逻辑 |
| 前端团队全权 | CLI 生成、骨架格式升级、bones 文件更新，均由前端完成 |
| 渐进增强 | 无服务端中间件时降级为现有行为，不破坏现有功能 |

---

## 二、整体架构

```
构建阶段（前端团队）
  boneyard build → *.bones.json            (现有)
                 → bones/manifest.json     (新增)
                 → bones/{name}.snippet.html (新增)

服务端（一次性安装 @boneyard/middleware）
  启动时：读 manifest.json → 预加载所有 snippet 到内存
  请求时：路由匹配 → 在 </body> 前注入 snippet + bridge script 引用

  serve /boneyard-bridge.js（内置在 npm 包，前端零维护）

浏览器时序：
  HTML 解析
  → <style> 生效 → <div id="__bp"> 渲染（骨架可见）
  → IIFE 同步执行 → MutationObserver 注册到 #root
  → JS bundle 下载 + 解析
  → React 挂载 → Observer 触发 → CSS fade-out → DOM 清除
  → boneyard-bridge.js (defer) 加载 → 预加载所有 snippet → 接管 SPA 路由切换
```

---

## 三、数据格式

### manifest.json（CLI 自动生成）

```json
{
  "version": 1,
  "routes": {
    "/":            { "snippet": "home",         "rootSelector": "#root" },
    "/user/:id":    { "snippet": "user-profile", "rootSelector": "#root" },
    "/search":      { "snippet": "search",       "rootSelector": "#root" },
    "/dashboard/*": { "snippet": "dashboard",    "rootSelector": "#root" }
  }
}
```

路由支持 `path-to-regexp` 语法（`:param`、`*` 通配符）。

### {name}.snippet.html（CLI 由 `snippet.ts` 生成）

> **关于 renderBones() 复用的澄清（决议 A）**
> snippet **不是** 直接由 `renderBones()` 输出，而是由新增的 `snippet.ts / renderSnippet()` 生成：
> 内部调用 `renderBones()` 得到骨架 div（`<div class="boneyard">...<div class="boneyard-bone">`），
> 再由 `renderSnippet()` 包裹覆盖层 `#__bp`、teardown CSS、IIFE，并做占位符替换。
> 详见 §四。下面 `{{RENDER_BONES_HTML}}` 即 `renderBones()` 的原样输出。

> **坐标约束（决议 B / Q3）**
> `renderBones()` 的 `bone.x/w` 是**相对容器**的百分比，圆形像素尺寸基于 `skel.width`。
> 因此 SSR 注入**仅支持页面级 / 全视口 Skeleton**：覆盖层 `#__bp` 占满视口，
> 内层复用 `renderBones()` 的 `.boneyard`（`position:relative;width:100%`）作为坐标基准容器，
> 让百分比回到该容器而非视口。局部卡片级 Skeleton 仍走现有运行时 JS 渲染，不进 SSR 通道。

```html
<style id="__bp_s">
#__bp{position:fixed;inset:0;z-index:9998;pointer-events:none;overflow:hidden}
/* 内层为 renderBones() 的 .boneyard 容器（position:relative;width:100%），坐标基准回到容器 */
#__bp .boneyard{position:relative;width:100%;height:100%}
.boneyard-bone{position:absolute;background:#f0f0f0;animation:__bp_p 1.8s ease-in-out infinite}
/* ★ CSS-only teardown（来自 smarty-skeleton index.less 的启发） */
#__bp.out{animation:__bp_out 150ms forwards}
@keyframes __bp_p{0%,100%{opacity:.85}50%{opacity:.45}}
@keyframes __bp_out{to{opacity:0}}
/* ★ CLS 锚定：值由 CLI 按注入断点 max(y + h) 推算（见 §四 / §八） */
{{ROOT_SELECTOR}}:empty{min-height:{{ROOT_MIN_H}}px}
/* 暗色模式：选择器可配置，默认 .dark（决议 C） */
{{DARK_SELECTOR}} #__bp .boneyard-bone{background:#222222}
</style>
<div id="__bp" aria-hidden="true">
  {{RENDER_BONES_HTML}}  <!-- renderBones() 原样输出，含 .boneyard 容器 -->
</div>
<script>(function(){
  /* ★ 注入幂等保护（来自 visual-skeleton-plugin 的 __FLAG__ 模式） */
  if(window.__BP_READY__)return;
  window.__BP_READY__=true;

  var p=document.getElementById('__bp');
  var s=document.getElementById('__bp_s');
  if(!p)return;

  var done=false;
  /* ★ CSS-only fade：加 class 触发 @keyframes，不依赖 JS transition */
  function dismiss(){
    if(done)return;done=true;
    p.classList.add('out');
    p.addEventListener('animationend',function(){p.remove();s&&s.remove();},{once:true});
  }

  /* ★ rootSelector 由 CLI 模板替换（决议 Q4），默认 #root */
  var root=document.querySelector('{{ROOT_SELECTOR}}');
  if(!root){dismiss();return;}

  /* ★ subtree:true + 仅元素节点才 dismiss，避免 React 插入空根 div 时过早白屏（决议 Q6） */
  var obs=new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var added=muts[i].addedNodes;
      for(var j=0;j<added.length;j++){
        if(added[j].nodeType===1){obs.disconnect();dismiss();return;}
      }
    }
  });
  obs.observe(root,{childList:true,subtree:true});

  /* ★ 兜底计时器：Observer 永不触发时强制消失（决议 Q5），默认 5000ms，可配 */
  setTimeout(function(){obs.disconnect();dismiss();},{{MAX_WAIT}});
})();</script>
```

**设计要点：**
- `position:fixed` 覆盖全视口，不依赖容器位置；内层 `.boneyard` 仍为相对定位，保持坐标基准
- `pointer-events:none` 不拦截用户交互
- `__BP_READY__` 幂等保护，防止 HMR / 中间件重复注入
- fade-out 改为 CSS `animation + forwards` — **无需 JS transition，浏览器直接驱动**
- `aria-hidden="true"` 无障碍访问
- `{{ROOT_SELECTOR}}` / `{{DARK_SELECTOR}}` / `{{ROOT_MIN_H}}` / `{{MAX_WAIT}}` 均为 CLI 生成时替换的模板变量

---

## 四、CLI 构建扩展

### 新增生成步骤

```
完成现有 *.bones.json 生成后（新增 snippet.ts / renderSnippet()）：
  for each (skeletonName, routePath):
    1. 读取 {name}.bones.json
    2. resolveResponsive(bones, defaultBreakpoint)   ← 默认断点（桌面项目可配 1280，见 §七）
    3. renderBones(result)               ← 复用现有函数，输出骨架 div 字符串
    4. renderSnippet(renderBonesHtml, {                ← 新增：包裹覆盖层 + teardown + IIFE
         rootSelector, darkSelector, maxWait,
         rootMinHeight: computeRootMinHeight(result),  ← max(y + h)（决议 Q9）
       })
       → 替换 {{RENDER_BONES_HTML}} / {{ROOT_SELECTOR}} / {{DARK_SELECTOR}}
                / {{ROOT_MIN_H}} / {{MAX_WAIT}}
    5. 写入 bones/{name}.snippet.html

  6. 收集 (routePath → snippetName) → 写入 bones/manifest.json
```

**`renderSnippet()` 与 `renderBones()` 的分工（决议 A）：**
- `renderBones()`（[runtime.ts](packages/boneyard/src/runtime.ts)）保持不变，只负责骨架 div。
- `snippet.ts / renderSnippet()` 新增，负责覆盖层、teardown CSS、IIFE、模板变量替换。
- `computeRootMinHeight(result)` = `max(bone.y + bone.h)`（当前注入断点），写入 `{{ROOT_MIN_H}}`（决议 Q9：812px 仅为示例值）。

**snippet CSS 按需裁剪（借鉴 page-skeleton 的 `css-tree` 思路，瘦身）：**
- snippet 内联的 CSS 应只保留"骨架自身用到的"规则。`renderSnippet()` 生成 CSS 后，用 `css-tree` 解析为 AST，剔除其中 selector 不会命中 snippet DOM（`#__bp`/`.boneyard`/`.boneyard-bone`/teardown keyframes 之外）的规则，再 `csso`/minify。
- 文本类 bone 采用 `linear-gradient` 渲染（见架构总纲 §6.1）时，配合 `styleCache` 把相同行高/颜色的渐变规则合并为一个 class，避免每个文本 bone 各写一份。
- 目标：单路由 snippet 内联 CSS 控制在数百字节级，降低首屏 HTML 体积。

**模板变量默认值（已定）：**

| 变量 | 默认 | 来源 |
|------|------|------|
| `{{ROOT_SELECTOR}}` | `#root` | `--root-selector` |
| `{{DARK_SELECTOR}}` | `.dark` | `--dark-selector`（沿用 MEMORY.md 暗色约定） |
| `{{MAX_WAIT}}` | `5000` | `--max-wait`（ms） |
| `{{ROOT_MIN_H}}` | `auto` = `max(y+h)` | `--root-min-height` |
| `defaultBreakpoint` | `375` | `--default-breakpoint`（桌面项目设 1280） |

### 新增 CLI 参数

```bash
boneyard build ... --preload                  # 生成 snippet + manifest（默认开启）
boneyard build ... --root-selector "#__next"  # Next.js（写入 {{ROOT_SELECTOR}}）
boneyard build ... --dark-selector "[data-theme=dark]"  # 暗色选择器（默认 .dark，决议 C）
boneyard build ... --preload-color "#e8e8e8"  # 自定义骨架颜色
boneyard build ... --default-breakpoint 1280  # 注入断点（默认 375；桌面项目设 1280，决议 Q11）
boneyard build ... --max-wait 5000            # 骨架兜底消失超时（决议 Q5）
boneyard build ... --root-min-height auto     # auto=按 max(y+h) 推算 | <number> 手动覆盖（决议 Q9）
```

---

## 五、服务端中间件 @boneyard/middleware

### 最终注入内容（中间件自动处理）

```html
<!-- 注入到 </body> 前 -->
<style id="__bp_s">...骨架 CSS + teardown keyframes...</style>
<div id="__bp" aria-hidden="true">...骨架 div...</div>
<script>(function(){ /* __BP_READY__ guard + MutationObserver IIFE */ })();</script>
<script src="/boneyard-bridge.js" defer></script>
```

### 响应流拦截核心逻辑（决议 Q2 / E：支持流式 SSR + 压缩/Content-Length 正确性）

**关键约束（决议 E）：**
- 中间件必须位于压缩中间件**之前**（在 gzip/br 之前拿到明文 HTML）；否则 `</body>` 出现在压缩字节流中，`indexOf` 无法匹配。
- 注入会改变响应体长度，因此必须**移除上游 `Content-Length`**，改走分块传输（`Transfer-Encoding: chunked`）。
- 仅处理 `Content-Type: text/html` 的响应，其余透传。

**改为 Transform Stream 逐块扫尾（决议 Q2：支持 React 18 `renderToPipeableStream` / Next App Router）：**

```js
// 不再全量 buffer。只保留一个跨 chunk 的滑动尾巴，找到第一个 </body> 注入一次后即透传。
function createInjectStream(snippet) {
  let injected = false
  let tail = ''                         // 跨 chunk 边界保留的尾部（< '</body>'.length）
  const MARK = '</body>'
  return new Transform({
    transform(chunk, _enc, cb) {
      if (injected) return cb(null, chunk)
      const text = tail + chunk.toString('utf8')
      const idx = text.indexOf(MARK)
      if (idx !== -1) {
        injected = true
        this.push(text.slice(0, idx) + snippet + text.slice(idx))
        tail = ''
      } else {
        // 输出除尾部外的内容，保留可能跨界的 MARK 前缀
        const keep = MARK.length - 1
        this.push(text.slice(0, Math.max(0, text.length - keep)))
        tail = text.slice(Math.max(0, text.length - keep))
      }
      cb()
    },
    flush(cb) {
      // 整个流都没有 </body>（极少见）：把剩余尾部直接输出，不注入
      if (!injected && tail) this.push(tail)
      cb()
    },
  })
}
```

**流式场景的可选增强：** 对完全流式渲染，可改为在 `<head>` 注入 `style + 占位 div`、`<script defer>`，
保证首个 chunk 到达即可见骨架，不依赖 `</body>`（其在最后一个 chunk 才出现）。

### 框架适配器

```js
// Express / Fastify
app.use(require('@boneyard/express')({ bonesDir: './public/bones' }))

// Next.js middleware.ts (Edge Runtime)
import { bonesMiddleware } from '@boneyard/next'
export const middleware = bonesMiddleware({ bonesDir: './public/bones' })
export const config = { matcher: ['/((?!api|_next|.*\\..*).*)'] }

// Cloudflare Workers
import { createBonesHandler } from '@boneyard/cloudflare'
export default { fetch: createBonesHandler({ bonesDir: '/bones' }) }

// Webpack / Vite（SSG-lite，构建时直接内联）
// — craPlugin.ts 模式（来自 smarty-skeleton-toolchain 启发）
// HtmlWebpackPlugin.getHooks → 修改 HTML emit，不需要运行时中间件
```

### 中间件同时 serve /boneyard-bridge.js

```js
app.get('/boneyard-bridge.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(BRIDGE_JS_CONTENT)  // 内置在 npm 包，随版本升级
})
```

---

## 六、SPA Bridge（服务端维护，前端零维护）

**体积拆分（决议 Q12）：** bridge 分两部分，按需加载：
- **首屏核心 IIFE**（仅 `dismiss` + Observer + 兜底超时）：已内联在 snippet.html 的 `<script>` 中（见 §三），约 0.4KB gzip，所有项目都需要。
- **SPA bridge（本节）**：`manifest` 加载、rIC 预加载、`pathMatch`、`history` 拦截，约 1.5–2KB gzip（含迷你匹配器）。**非 SPA / MPA 项目无需引入**，中间件可按配置不注入 `<script src="/boneyard-bridge.js">`。

**与 snippet 内联 script 的关系（决议 Q1）：** SPA 路由切换时，bridge **不复用** snippet 里的 `<script>`（`innerHTML` 注入的 `<script>` 不会执行）。bridge 只缓存 `#__bp` 这个 **div**（不含 script），Observer/dismiss 逻辑完全由 bridge 自身在 JS 中运行（见下方 `showSkeleton`）。

`/boneyard-bridge.js` 由 `@boneyard/middleware` 内置 serve，完整逻辑：

```js
(function () {
  var BASE = '/bones/';
  var snippetCache = {};
  var routeMap = [];
  var MAX_WAIT = 5000;   // 骨架兜底消失超时（决议 Q5，可由 manifest.json 覆盖）

  /* ★ requestIdleCallback polyfill（来自 smarty-skeleton 的 40ms budget 模式） */
  var rIC = window.requestIdleCallback || function (cb) {
    var start = Date.now();
    return setTimeout(function () {
      cb({ didTimeout: false, timeRemaining: function () { return Math.max(0, 40 - (Date.now() - start)); } });
    }, 1);
  };

  // 1. 加载 manifest
  fetch(BASE + 'manifest.json')
    .then(function (r) { return r.json(); })
    .then(function (manifest) {
      routeMap = Object.entries(manifest.routes).map(function (e) {
        return { pattern: e[0], name: e[1].snippet, root: e[1].rootSelector || '#root' };
      });

      // 2. 空闲时预加载所有 snippet（确保路由切换时同步注入）
      var names = [...new Set(routeMap.map(function (r) { return r.name; }))];
      var i = 0;
      function loadNext(idle) {
        if (i >= names.length) return;
        // 超时或仍有剩余时间则继续
        if (idle.didTimeout || idle.timeRemaining() > 5) {
          var name = names[i++];
          fetch(BASE + name + '.snippet.html')
            .then(function (r) { return r.text(); })
            .then(function (html) {
              var tmp = document.createElement('div');
              tmp.innerHTML = html;
              snippetCache[name] = {
                style: tmp.querySelector('style')?.textContent || '',
                html:  tmp.querySelector('#__bp')?.outerHTML  || '',
              };
            })
            .finally(function () { rIC(loadNext, { timeout: 2000 }); });
        } else {
          rIC(loadNext, { timeout: 2000 });
        }
      }
      rIC(loadNext, { timeout: 2000 });
    });

  // 3. 路由匹配（决议 Q7：内置迷你匹配器，支持 :param 与 * 通配符，不引 path-to-regexp）
  var _reCache = {};
  function compile(pattern) {
    if (_reCache[pattern]) return _reCache[pattern];
    // /user/:id → ^/user/[^/]+$ ；/dashboard/* → ^/dashboard/.*$
    var src = '^' + pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')   // 转义正则元字符（保留 : 与 *）
      .replace(/\\\*/g, '.*')                    // * → .*
      .replace(/:([A-Za-z0-9_]+)/g, '[^/]+')     // :param → [^/]+
      + '/?$';
    return (_reCache[pattern] = new RegExp(src));
  }
  function pathMatch(pattern, pathname) {
    return compile(pattern).test(pathname);
  }
  function matchRoute(pathname) {
    for (var i = 0; i < routeMap.length; i++) {
      if (pathMatch(routeMap[i].pattern, pathname)) return routeMap[i];
    }
    return null;
  }

  // 4. 注入骨架
  function showSkeleton(pathname) {
    var route = matchRoute(pathname);
    if (!route || !snippetCache[route.name]) return;

    /* ★ 连续快速导航保护：清理上一个 overlay */
    var old = document.getElementById('__bp');
    if (old) old.remove();
    var oldS = document.getElementById('__bp_s');
    if (oldS) oldS.remove();
    window.__BP_READY__ = false;  // 重置幂等标志

    var cached = snippetCache[route.name];

    var styleEl = document.createElement('style');
    styleEl.id = '__bp_s';
    styleEl.textContent = cached.style;
    document.head.appendChild(styleEl);

    /* ★ 决议 Q1：用 createElement 构建 overlay（cached.html 仅含 #__bp div，不含 script）；
       Observer/dismiss 逻辑全部由本函数在 JS 中运行，不依赖 snippet 内联 script。 */
    var tmp = document.createElement('div');
    tmp.innerHTML = cached.html;          // 仅 div，无 script，innerHTML 安全
    var overlay = tmp.firstElementChild;
    document.body.appendChild(overlay);

    var done = false;
    function dismiss() {
      if (done) return; done = true;
      overlay.classList.add('out');
      overlay.addEventListener('animationend', function () {
        overlay.remove();
        styleEl.remove();
      }, { once: true });
    }

    // 5. 监听 React 挂载（与 snippet 一致：subtree + 仅元素节点 + 兜底超时）
    var root = document.querySelector(route.root);
    if (!root) { dismiss(); return; }
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) { obs.disconnect(); dismiss(); return; }
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); dismiss(); }, MAX_WAIT);  // 决议 Q5
  }

  // 6. 拦截 SPA 导航
  var origPush = history.pushState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    showSkeleton(location.pathname);
  };
  window.addEventListener('popstate', function () {
    showSkeleton(location.pathname);
  });
})();
```

---

## 七、多视口处理

| 方案 | 默认 | 说明 |
|------|------|------|
| 注入 `defaultBreakpoint` 断点 | ✓ 默认 | 由 `--default-breakpoint` 配置：移动端项目用 375，桌面端项目用 1280（决议 Q11） |
| Cookie 视口记忆 `__bvp` | 推荐增强 | 首次按 `defaultBreakpoint`，第二次起精确匹配 |
| Client Hints `Sec-CH-Viewport-Width` | 可选提前启用 | 支持的浏览器首次即精确；需服务端下发 `Accept-CH: Viewport-Width`（决议 Q11） |

**默认断点（决议 Q11）：** `defaultBreakpoint` 默认 `375`（保持现有行为），桌面为主的站点应显式设为 `1280`，避免桌面用户首次看到窄骨架。`--default-breakpoint` 可配。

**Cookie 方案：**

```js
// JS bundle 执行后写入（一次性）
document.cookie = '__bvp=' + window.innerWidth + ';path=/;max-age=31536000';
```

服务端读 `__bvp` cookie → `resolveResponsive(bones, bvp)` → 注入对应断点的 snippet；无 cookie 时回退 `defaultBreakpoint`。

**Client Hints（可选提前启用）：** 中间件下发 `Accept-CH: Viewport-Width`（及 `Critical-CH`），支持的浏览器在**首次**请求即带 `Sec-CH-Viewport-Width`，无需等第二次访问即可精确匹配断点。不支持的浏览器自动回退 cookie / `defaultBreakpoint`。

---

## 八、CLS 锚定（来自 Trinity Extension 的启发）

Trinity 的 Zero-CLS Anchoring 会给容器注入 `min-height` / `max-height` 防止骨架消失时发生 CLS。

在本方案中，骨架使用 `position:fixed` 覆盖层，不占文档流，骨架消失时不会引发 CLS。

但 `#root` 在 React 首次 render 前高度为 0，页面可能出现高度塌陷 → 内容渲染后回弹 CLS。

**改进：snippet 同时注入 `#root` 的 `min-height` 锚定：**

```html
<!-- snippet.html 额外注入（值由 CLI 推算，见 §四 computeRootMinHeight） -->
<style>
  /* ★ CLS 锚定：撑开 #root 高度，防止内容渲染时回弹 */
  {{ROOT_SELECTOR}}:empty { min-height: {{ROOT_MIN_H}}px }
</style>
```

`:empty` 伪类仅在 `#root` 为空时生效，React 挂载第一个子元素后自动失效，无需 JS 清除。

**值来源（决议 Q9）：** 不写死 812px。CLI 取**当前注入断点**骨架的 `max(bone.y + bone.h)` 作为 `{{ROOT_MIN_H}}`，并随 `defaultBreakpoint` 变化；`--root-min-height <number>` 可手动覆盖。这样在 1280px 宽屏注入 1280 断点时不会用 375 的高度产生大片空白。

---

## 九、降级策略

| 场景 | 行为 |
|------|------|
| 未安装中间件 | 现有 JS 渲染骨架行为，完全无损 |
| manifest.json 不存在 | 中间件跳过所有请求，透传 |
| 路由无匹配 snippet | 中间件跳过，透传 |
| MutationObserver 未触发 | `setTimeout(dismiss, MAX_WAIT)` 兜底强制消失（默认 5000ms，见 §三 / 决议 Q5） |
| 快速连续路由切换 | bridge.js 清理上一个 overlay 后再注入新的 |
| HMR / 双重注入 | `window.__BP_READY__` 幂等保护 |

---

## 十、包结构

```
packages/
  boneyard/                  ← 现有（扩展 CLI）
    src/
      runtime.ts             ← renderBones() 复用（不变）
      snippet.ts             ← 新增：生成完整 snippet.html

packages/
  middleware/                ← 新增 @boneyard/middleware
    src/
      core.ts                ← 注入逻辑（框架无关）
      bridge.js              ← SPA bridge（内置，随包版本升级）
      express.ts             ← Express / Fastify 适配器
      next.ts                ← Next.js Edge middleware 适配器
      cloudflare.ts          ← Cloudflare Workers 适配器
      webpack-plugin.ts      ← 构建时 HTML 注入（SSG-lite，HtmlWebpackPlugin）
      vite-plugin.ts         ← Vite transformIndexHtml hook
```

---

## 十一、跨团队职责边界

| 动作 | 负责方 | 频率 |
|------|--------|------|
| 跑 CLI 生成 bones + snippet + manifest | 前端团队 | 每次发版 |
| 部署 `/public/bones/` 静态文件 | 前端团队 | 随前端部署 |
| 安装 `@boneyard/middleware` | 服务端团队 | **一次** |
| bridge.js 逻辑升级 | boneyard 团队（npm） | 随版本透明升级 |
| 理解骨架格式 / bridge 逻辑 | 服务端团队 | **永不需要** |
| 前端维护任何 bridge 代码 | 前端团队 | **零** |

---

## 十二、渐进迁移路径

```
阶段 0  现有功能（JS 渲染骨架）
阶段 1  CLI --preload 生成 snippet + manifest，可本地验证
阶段 2  安装 @boneyard/middleware，首次访问骨架生效
阶段 3  Cookie __bvp 视口记忆，桌面端断点精确匹配（可选）
阶段 4  Webpack/Vite plugin 走 SSG-lite 路径（纯静态托管，可选）
```

---

## 十三、Babel/SWC 插件自动注入（来自 cra-demo/loaders/injectSkeletonLoader.js）

### 问题
现有 boneyard 需要用户手动导入 `registry.js`：
```js
import './bones/registry'  // 忘记导入则骨架失效
```

### 发现的模式
`cra-demo/loaders/injectSkeletonLoader.js` 是一个 Webpack Babel Loader，在编译期：
1. 用 Babel AST 扫描所有 JSX 文件
2. 找到 `<SmartySkeleton id="xxx">` 元素
3. 读取 `src/skeletons/xxx.bin`
4. 自动注入 `placeholder={base64Data}` prop

**开发者写：**
```jsx
<SmartySkeleton id="user-card">...</SmartySkeleton>
```
**编译后变为：**
```jsx
<SmartySkeleton id="user-card" placeholder="AABB...base64...">...</SmartySkeleton>
```

### 对 boneyard 的启发：Vite/SWC Transform 插件

同样的思路应用于 boneyard：

```jsx
// 开发者写（无需任何 import）
<Skeleton name="home" loading={isLoading}>
  <MyPage />
</Skeleton>

// Vite transform 后自动变为
<Skeleton name="home" loading={isLoading} initialBones={__BONES_home}>
  <MyPage />
</Skeleton>
// 顶部自动注入：
// import __BONES_home from './bones/home.bones.json'
```

### 实现方式

```ts
// vite-plugin-boneyard-inject.ts
export function boneyardInjectPlugin(options): Plugin {
  return {
    name: 'boneyard-inject',
    transform(code, id) {
      if (!id.endsWith('.tsx') && !id.endsWith('.jsx')) return
      if (!code.includes('<Skeleton')) return

      // 用正则或 Babel AST 找到所有 <Skeleton name="xxx">
      // 检查是否已有 initialBones prop
      // 若无：读取 bones/xxx.bones.json，注入 initialBones
      return transformSkeletonProps(code, id, options.bonesDir)
    }
  }
}
```

### 优势
- **零侵入**：开发者不写任何 import，不需要 registry.js
- **Tree-shakable**：每个组件只打包自己需要的 bones，不加载无关骨架
- **构建时验证**：骨架文件不存在时给出编译警告

---

## 十四、Runtime Dev Save — 浏览器端实时保存

### 问题

现有 Vite 插件是**服务端 push 模式**：

```
Vite Plugin → Playwright headless → 访问页面 → 捕获 DOM → 写文件
```

缺陷：
- 无法处理复杂登录态（Playwright 需额外配置 cookies）
- 无法访问动态路由（不知道真实参数）
- 无法捕获需要用户操作才能出现的 UI 状态

### 新增：浏览器 push 模式（Runtime Dev Save）

```
开发者正常浏览 → Skeleton 组件捕获 → POST /__boneyard__/save → 写文件
```

两种模式**并存互补**：

| 模式 | 触发方式 | 适用场景 |
|------|----------|----------|
| Playwright capture | HMR / `boneyard build` | CI、首次批量生成、无 auth 页面 |
| Runtime Dev Save | 开发者实际浏览 | 需要登录、动态路由、复杂交互 |

---

### Vite Plugin：新增 `/__boneyard__/save` 端点

在 `configureServer` 中注册中间件：

```ts
// vite.ts configureServer 中新增
srv.middlewares.use('/__boneyard__/save', async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return
  }

  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString() })
  req.on('end', async () => {
    try {
      const { name, result, width } = JSON.parse(body) as {
        name: string
        result: SkeletonResult   // 当前视口的捕获结果
        width: number            // 视口宽度
      }

      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const outputDir = detectOutDir(srv.config.root)
      const outPath = resolve(outputDir, `${safeName}.bones.json`)

      // 读取现有 bones（保留其他断点）
      let existing: ResponsiveBones = { breakpoints: {} }
      if (existsSync(outPath)) {
        try { existing = JSON.parse(readFileSync(outPath, 'utf-8')) } catch {}
      }

      // 合并当前断点
      existing.breakpoints[width] = result
      existing._sourceFile = getSourceFile(srv.config.root, name)  // 反查文件
      existing._sourceMtime = existing._sourceFile
        ? statSync(resolve(srv.config.root, existing._sourceFile)).mtimeMs
        : undefined

      mkdirSync(outputDir, { recursive: true })
      writeFileSync(outPath, JSON.stringify(existing, null, 2))

      // 更新 knownBones + 重新生成 registry
      knownBones[safeName] = existing
      regenerateRegistry(outputDir, srv.config.root)

      // 通知 HMR 热更新 registry
      const registryPath = join(outputDir, `registry.${detectRegistryExtension(srv.config.root)}`)
      srv.watcher.emit('change', registryPath)

      log(`saved ${safeName} @ ${width}px  (runtime capture)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name: safeName, width }))
    } catch (e: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
  })
})
```

---

### Skeleton 组件：dev 模式自动 POST

在 `react.tsx`（以及 vue/svelte 等）的 `snapshotBones()` 调用完成后：

```ts
// react.tsx — snapshotBones 成功后
if (import.meta.env?.DEV && result) {
  // 静默 POST，不影响渲染
  fetch('/__boneyard__/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: skeletonName,
      result,
      width: containerRef.current?.offsetWidth ?? window.innerWidth,
    }),
  }).catch(() => { /* dev save 失败不影响功能 */ })
}
```

**`import.meta.env.DEV`** 在生产构建时被 Vite tree-shake 掉，产物中不含任何 `/__boneyard__/save` 调用。

---

### 多断点积累策略

每次浏览器访问只捕获当前视口宽度。多断点通过**多次浏览**积累：

```
开发者在 375px 窗口访问 /user/123
  → POST { name: "user-profile", width: 375, result: {...} }
  → user-profile.bones.json 写入 breakpoints.375

开发者拉宽到 1280px 再次访问
  → POST { name: "user-profile", width: 1280, result: {...} }
  → user-profile.bones.json 合并 breakpoints.1280（保留 375）
```

需要一次性捕获所有断点时，仍然运行 `boneyard build`（Playwright 批量）。

---

### 完整开发工作流

```
pnpm dev
  └─ Vite 插件注册 /__boneyard__/save 端点

开发者登录 → 导航到 /dashboard/org-123
  └─ <Skeleton name="dashboard"> 加载
  └─ snapshotBones() 执行
  └─ POST /__boneyard__/save → 服务端写文件
  └─ registry.js HMR 热更新

开发者导航到 /user/456
  └─ <Skeleton name="user-profile"> 加载
  └─ 同上...

结果：src/bones/ 目录下自动积累各页面的 bones.json
     开发者 commit 时 boneyard check 验证同步状态
     CI boneyard build 确保所有断点完整
```

---

### boneyard.config.json 新增配置

```json
{
  "devSave": {
    "enabled": true,          // 默认 true（dev 模式）
    "endpoint": "/__boneyard__/save",
    "mergeBreakpoints": true  // false = 每次覆盖全部断点
  }
}
```

---

## 十五、CLI 自动扫描端点设计

### 现状

CLI 已有 `discoverRoutes()` 扫描文件系统路由（Next.js / SvelteKit / Nuxt / Remix），
但存在三个缺口：

| 缺口 | 说明 |
|------|------|
| 动态路由跳过 | `[id]`、`:param` 无法直接访问，需要真实参数 |
| 无 Skeleton 的页面也会访问 | 没有过滤"是否有 `<Skeleton>`"，浪费 Playwright 时间 |
| Vite SPA 无文件路由 | 单页应用无 `pages/` 目录，无法自动发现路由 |

---

### 改进一：Source 交叉验证过滤

**原理：** 先静态扫描源码，只访问**含有 `<Skeleton>` 组件的页面**，跳过无关页面。

```
扫描阶段（无需浏览器）：
  1. grep -r 'data-boneyard' src/          ← 找出所有含 Skeleton 的文件
     或 AST 解析 <Skeleton name="xxx">
  2. 文件路径 → 推导路由（与 discoverRoutes 同样的规则）
  3. 得到 "有效路由集合"

访问阶段：
  discoverRoutes() 的结果 ∩ 有效路由集合 → 只访问这些页面
```

**实现：** 新增 `discoverSkeletonRoutes(srcDir)` 函数：

```js
function discoverSkeletonRoutes(srcDir) {
  // 扫描所有 TSX/JSX/Vue/Svelte 文件
  const files = walkDir(srcDir)
    .filter(f => /\.(tsx|jsx|ts|js|vue|svelte)$/.test(f))

  const routeSet = new Set()
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    // 检查是否包含 Skeleton 组件
    if (!content.includes('data-boneyard') && !/<Skeleton\b/.test(content)) continue
    // 推导路由（复用现有规则）
    const route = fileToRoute(file, srcDir)
    if (route) routeSet.add(route)
  }
  return routeSet
}
```

---

### 改进二：动态路由 fixture URL 配置

动态路由（`/user/[id]`）无法自动访问，需要用户提供一个示例 URL。
在 `boneyard.config.json` 中扩展：

```json
{
  "routes": {
    "/user/[id]":         "/user/123",
    "/product/[slug]":    "/product/demo-item",
    "/dashboard/[orgId]": "/dashboard/my-org"
  }
}
```

**CLI 处理逻辑：**
```
discoverRoutes() 发现 /user/[id]
  → 查找 config.routes["/user/[id]"]
  → 找到 "/user/123"
  → 加入访问队列：http://localhost:3000/user/123
  → 捕获时 manifest.json 记录路由模式为 "/user/:id"（不是具体 URL）
```

---

### 改进三：Vite SPA 路由发现

Vite SPA 无文件路由，需要扫描 React Router / Vue Router 配置：

```
策略 1：扫描 createBrowserRouter 定义
  grep 'path:' src/router.tsx → 提取路径字符串

策略 2：扫描 <Route path="..."> JSX
  grep -E '<Route.*path=' src/ → 提取 path 属性

策略 3：降级 — 只访问根路径
  所有 SPA 骨架在同一个 / 页面捕获，用户导航后触发 SPA 路由
```

**自动检测 SPA 框架：**
```js
function detectSPARoutes(cwd) {
  // React Router createBrowserRouter
  const routerFiles = glob('src/**/{router,routes,App}.{tsx,jsx,ts,js}', cwd)
  for (const file of routerFiles) {
    const content = readFileSync(file, 'utf-8')
    const paths = [...content.matchAll(/path:\s*['"]([^'"]+)['"]/g)]
      .map(m => m[1])
      .filter(p => !p.includes(':') && !p.includes('*'))  // 跳过动态
    if (paths.length) return paths
  }
  return ['/']  // 降级
}
```

---

### 改进四：扫描进度与报告

```
boneyard build 输出：

  💀 boneyard build
  ──────────────────────────────────────────────────
  scanning source files...
    found 8 skeleton components across 5 pages
    /                  → home, hero-banner (2 skeletons)
    /user/123          → user-profile (dynamic: /user/[id])
    /search            → search-results
    /dashboard         → dashboard-widget, stats-card
    skipped 12 pages   (no <Skeleton> components)

  breakpoints  375, 768, 1280
  output       src/bones
```

---

### boneyard.config.json 完整扩展

```json
{
  "routes": {
    "/user/[id]":      "/user/123",
    "/post/[slug]":    "/post/hello-world"
  },
  "scan": {
    "src": "./src",
    "include": ["**/*.tsx", "**/*.jsx", "**/*.vue"],
    "exclude": ["**/*.test.*", "**/*.stories.*", "node_modules"]
  }
}
```

---

## 十六、代码提交骨架同步阻断

### 问题

开发者修改了组件 fixture，但忘记重新运行 `boneyard build`，
导致提交的骨架与实际 UI 不匹配，直到下次 build 才发现。

### 现有基础

`_hash` 已存储在 bones.json（fixture innerHTML 的 MD5），由 CLI 在 Playwright 捕获时写入：
```json
{
  "breakpoints": { ... },
  "_hash": "a3f2c1d8e4b7..."   ← 已有，fixture 渲染后 HTML 的 hash
}
```

### 扩展：增加 `_sourceFile` 字段

在生成 bones 时，额外记录来源文件、**源码内容 hash**、浅层依赖与构建时间：

```json
{
  "breakpoints": { ... },
  "_hash": "a3f2c1d8e4b7...",          // 已有：fixture 渲染后 HTML 的 hash
  "_sourceFile": "src/components/UserCard.tsx",
  "_sourceHash": "9b1c0f...",           // 新增：_sourceFile + _sourceDeps 源码内容 hash（决议 D）
  "_sourceDeps": [                       // 新增：浅层依赖文件（决议 Q10）
    "src/components/UserAvatar.tsx",
    "src/fixtures/user.ts"
  ],
  "_sourceMtime": 1718000000000,        // 仅作本地快速预筛，不作为 CI 判定依据（决议 D）
  "_builtAt": 1718000500000
}
```

CLI 修改（`capturePage` 结束时）：
```js
// 已有：collected[name]._hash = pageHashes[name]
// 新增：
collected[name]._sourceFile  = relativeSourcePath   // 通过 Skeleton name 反查文件
collected[name]._sourceDeps  = shallowImports(sourceFile) // 解析 import，记录浅层依赖
collected[name]._sourceHash  = hashFiles([sourceFile, ...collected[name]._sourceDeps])
collected[name]._sourceMtime = statSync(sourceFile).mtimeMs
collected[name]._builtAt     = Date.now()
```

**为何用内容 hash 而非 mtime（决议 D）：** `git clone` / `checkout` 会重写文件 mtime，使 CI 上刚检出的源文件"看起来比 bones 新"，导致 `check --ci` 误报 STALE。改为比对 `_sourceHash`（源码内容）从根本上消除该问题；mtime 仅用于本地 `check` 的快速预筛（hash 计算前先看 mtime 是否变化，未变则跳过）。

**`_sourceDeps` 解决 fixture 依赖链（决议 Q10）：** `<Skeleton fixture={<MyFixture/>}>` 中 `MyFixture` 改动也能被检出。当前实现做**浅层**依赖（直接 import），多层依赖为已知限制，文档中标注。

---

### `boneyard check` 命令

新增 CLI 子命令，无需 Playwright，纯文件系统检查：

```bash
boneyard check              # 检查所有骨架
boneyard check --staged     # 只检查 git staged 的文件
boneyard check --ci         # CI 模式：结构化输出 + 非零退出码
```

**检查逻辑：**

```
1. 扫描源文件 → 找出所有 <Skeleton name="xxx">
   → Map<name, sourceFilePath>

2. 对每个 name：
   a. bones.json 不存在 → ❌ MISSING
   b. 读取 bones.json._sourceFile + _sourceDeps + _sourceHash
   c. 本地快速预筛：所有相关文件 mtime ≤ _sourceMtime → 直接判 UP TO DATE（跳过 hash）
   d. 否则重算 hashFiles([_sourceFile, ..._sourceDeps])：
      ≠ _sourceHash → ❌ STALE（源码内容已变）
      = _sourceHash → ✓ UP TO DATE
   e. （CI 模式 --ci 跳过 c 的 mtime 预筛，直接走 d 的内容比对，避免 checkout 误报）

3. 结果汇总：
   - 有 MISSING 或 STALE → exit 1
   - 全部 UP TO DATE     → exit 0
```

**输出示例：**

```
boneyard check

  checking 6 skeletons...

  ✓  home               up to date
  ✓  hero-banner        up to date
  ❌  user-profile       STALE  (src/components/UserCard.tsx modified 2h ago)
  ❌  search-results     MISSING (no bones file found)
  ✓  dashboard-widget   up to date
  ✓  stats-card         up to date

  2 skeleton(s) need rebuilding. Run:
    npx boneyard-js build

  exit 1
```

---

### Git Pre-commit Hook

#### 方式一：`boneyard init-hooks`（一键安装）

```bash
npx boneyard-js init-hooks
```

自动写入 `.git/hooks/pre-commit`：

```sh
#!/bin/sh
# boneyard pre-commit hook — auto-installed by boneyard-js
npx boneyard-js check --staged
if [ $? -ne 0 ]; then
  echo ""
  echo "  Commit blocked: skeleton files are out of sync."
  echo "  Run: npx boneyard-js build"
  echo ""
  exit 1
fi
```

#### 方式二：Husky 集成

```json
// package.json
{
  "lint-staged": {
    "src/**/*.{tsx,jsx}": "boneyard-js check --staged"
  }
}
```

#### 方式三：直接 husky hook

```bash
# .husky/pre-commit
npx boneyard-js check --staged
```

---

### `--staged` 模式实现

只检查 **当前 git staged 中涉及的 Skeleton 组件**，不全量扫描：

```js
// 获取 staged 文件列表
const { execSync } = require('child_process')
const stagedFiles = execSync('git diff --cached --name-only')
  .toString().trim().split('\n')
  .filter(f => /\.(tsx|jsx|ts|js|vue|svelte)$/.test(f))

// 只检查 staged 文件中包含 <Skeleton> 的
const affectedNames = extractSkeletonNames(stagedFiles)

// 对 affectedNames 执行 check 逻辑
```

---

### CI 集成

```yaml
# .github/workflows/ci.yml
- name: Check skeleton sync
  run: npx boneyard-js check --ci

# --ci 模式输出 JSON，便于 GitHub Actions Annotations
```

```json
// --ci 输出格式
{
  "stale": ["user-profile"],
  "missing": ["search-results"],
  "ok": ["home", "hero-banner", "dashboard-widget", "stats-card"],
  "exitCode": 1
}
```

GitHub Actions 读取后可以输出 PR 注释：
```
⚠️ Skeleton out of sync: user-profile, search-results
Run `npx boneyard-js build` and commit the updated bones files.
```

---

### 完整工作流

```
开发者修改 UserCard.tsx（含 <Skeleton name="user-profile">）
  ↓
git add UserCard.tsx
  ↓
git commit
  ↓
pre-commit hook: boneyard check --staged
  → 重算 hashFiles([UserCard.tsx, ...deps]) ≠ user-profile._sourceHash
  → exit 1，阻断提交
  ↓
开发者运行：npx boneyard-js build
  ↓
git add src/bones/user-profile.bones.json
  ↓
git commit → ✓ 通过
```

---

## 十七、来自竞品分析的改进点汇总

| 改进 | 来源 | 对应修改 |
|------|------|----------|
| `window.__BP_READY__` 幂等保护 | visual-skeleton-plugin `__LEAF_SKELETON_READY__` | snippet IIFE + bridge.js |
| CSS-only fade-out（`animation + forwards`） | smarty-skeleton `index.less` fade-out keyframe | 替换 JS transition |
| `#root:empty { min-height }` CLS 锚定 | Trinity Zero-CLS Anchoring | snippet 额外注入 |
| rIC polyfill（40ms setTimeout budget） | smarty-skeleton `requestIdleCallbackWithPolyfill.ts` | bridge.js 预加载 |
| Webpack plugin build-time HTML 注入 | `smarty-skeleton-toolchain` `craPlugin.ts` | webpack-plugin.ts |
| 连续导航上一个 overlay 清理 | devtools toolbar `Restore All` pattern | bridge.js showSkeleton() |

---

## 十八、设计疑问与待确认事项（含决议）

> 本节 Q1–Q12 为初版自检疑问，现已逐条决议（见各条 ✅）；A–E 为交叉比对真实代码（[runtime.ts](packages/boneyard/src/runtime.ts) / [shared.ts](packages/boneyard/src/shared.ts)）后新增的疑问与决议。

### 🔴 Critical — 功能不正确

#### Q1. bridge.js 中 `innerHTML` 注入的 `<script>` 不会执行（§六）

```js
var tmp = document.createElement('div')
tmp.innerHTML = cached.html  // snippet 包含 <script>
document.body.appendChild(tmp.firstElementChild)
```

通过 `innerHTML` 注入的 `<script>` 标签浏览器不会执行。新 overlay 的 IIFE（MutationObserver 注册）永远不会运行，骨架无法自动消失。

**✅ 决议（见 §六）：** bridge `showSkeleton()` 改用 `createElement` 构建 overlay，缓存只存 `#__bp` div（不含 script），Observer / dismiss 逻辑全部在 bridge JS 内运行，不再依赖 snippet 内联 script。

---

#### Q2. Streaming SSR 完全不兼容（§五）

`wrapResponse` 全量 buffer 找 `</body>`，但 React 18 `renderToPipeableStream` / Next.js App Router 是分块流式输出 — `</body>` 在最后一个 chunk 才出现。这种情况下要么 buffer 爆内存，要么注入时机异常。

**✅ 决议（见 §五）：** 改为 Transform Stream 逐块扫尾，支持 React 18 / Next App Router 流式 SSR；并明确中间件须置于压缩之前、移除上游 `Content-Length` 走分块传输。完全流式场景可选 `<head>` 注入。

---

#### Q3. `position:fixed` overlay 与局部 Skeleton 坐标不匹配（§三）

现有 bones 坐标是"相对于 `<Skeleton>` 容器"的百分比 + 绝对像素。snippet 用 `position:fixed;inset:0` 覆盖全视口，如果 `<Skeleton>` 只是页面中间某张卡片（非全屏），骨架偏移量会完全对不上。

**✅ 决议（见 §三 决议 B）：** 明确 SSR 注入仅支持页面级 / 全视口 Skeleton；`#__bp` 覆盖层内嵌 `renderBones()` 的 `.boneyard`（`position:relative;width:100%`）作为坐标基准，局部卡片级 Skeleton 继续走运行时 JS 渲染。

---

### 🟡 Design Gap — 影响可靠性

#### Q4. snippet.html IIFE 中 selector 硬编码为 `#root`（§三）

```js
.observe(document.querySelector('#root'), {childList:true})
```

snippet.html 是静态 HTML 字符串，selector 固定。但 manifest.json 中每个路由有独立的 `rootSelector`（如 Next.js 的 `#__next`）。

**✅ 决议（见 §三 / §四）：** 通过模板变量 `{{ROOT_SELECTOR}}` 在 CLI 生成时替换（`--root-selector`），单一模板，无需为每个框架维护不同副本。

---

#### Q5. MutationObserver 无超时兜底，骨架可能永不消失（§三 / §九）

降级表格写"MutationObserver 未触发 → 可加兜底计时器"，但 snippet.html 代码里没有任何 `setTimeout`。React 18 并发模式下 `#root` childList 变化时机与预期不同时，骨架会永远留在页面。

**✅ 决议（见 §三 / §六）：** snippet 与 bridge 均加 `setTimeout(dismiss, {{MAX_WAIT}})` 兜底，默认 5000ms，`--max-wait` 可配。

---

#### Q6. MutationObserver dismiss 触发时机可能过早（§三）

`childList:true` 不含 `subtree:true`。React 首次往 `#root` 插入空根 div 时即触发，此时页面内容可能还未渲染完，骨架过早消失出现白屏。

**✅ 决议（见 §三 / §六）：** Observer 改为 `{childList:true,subtree:true}`，且仅当 `addedNodes` 含元素节点（`nodeType===1`）才 dismiss，避免空根 div 触发的过早白屏。

---

#### Q7. `pathMatch` 函数未定义（§六）

```js
if (pathMatch(routeMap[i].pattern, pathname)) return routeMap[i]
```

bridge.js 中 `pathMatch` 没有实现，注释仅说"简单前缀，可替换为 path-to-regexp"。但 `/user/:id` 对 `/user/123` 简单前缀匹配不成立（模式字符串本身不是合法前缀）。

**✅ 决议（见 §六）：** 内置迷你匹配器，将 `:param`→`[^/]+`、`*`→`.*` 编译为缓存的 `RegExp`，不引 `path-to-regexp`，体积可控。

---

### 🟠 Correctness — 局部问题

#### Q8. 章节编号重复

文档存在**两个"十六"**：§十六 CLI 自动扫描端点设计 和 §十六 代码提交骨架同步阻断。§十四 竞品汇总排在 §十六 之后，整体顺序混乱。

**✅ 已修正：** 按物理顺序重排为 十三 Babel/SWC → 十四 Runtime Dev Save → 十五 CLI 扫描 → 十六 check 阻断 → 十七 竞品汇总 → 十八 本节，消除重复的两个"十六"。

---

#### Q9. `#root:empty { min-height }` 的值来源不明（§八）

```html
<style>
  #root:empty { min-height: 812px }
</style>
```

812px 是示例还是 CLI 自动推算？若自动推算：取哪个断点的骨架总高度？用 375px 断点高度在 1280px 宽屏上会产生大量空白。

**✅ 决议（见 §四 / §八）：** `computeRootMinHeight` 按当前注入断点 `max(y + h)` 推算写入 `{{ROOT_MIN_H}}`；`--root-min-height <number>` 可手动覆盖。

---

#### Q10. `_sourceMtime` 只追踪直接文件，无法检测 fixture 依赖链（§十六 check）

```js
collected[name]._sourceFile = relativeSourcePath  // 只记录直接含 <Skeleton> 的文件
```

若 `<Skeleton fixture={<MyFixture />}>` 的 `MyFixture` 组件被修改，`check` 不会检测到 stale。

**✅ 决议（见 §十六）：** 新增 `_sourceDeps[]` 记录浅层依赖并纳入 `_sourceHash` 比对；多层（传递）依赖为已知限制并在文档标注。

---

### 🔵 待澄清

#### Q11. 桌面端首次访问体验（§七）

方案承认"首次 375px，第二次起精确匹配"。桌面用户首次看到 375px 窄骨架布局体验较差。

**✅ 决议（见 §七）：** 新增 `--default-breakpoint`（桌面项目设 1280）；并把 `Accept-CH: Viewport-Width` 列为可选提前启用，支持的浏览器首次即精确。

---

#### Q12. bridge.js 体积预估

bridge.js 含 manifest fetch、rIC polyfill、路由匹配、snippet 注入、history 拦截，逻辑不少。

**✅ 决议（见 §六）：** 拆为首屏核心 IIFE（约 0.4KB gzip，随 snippet 内联）+ 异步 SPA bridge（约 1.5–2KB gzip，含迷你匹配器）；非 SPA / MPA 项目不注入后者。

---

### 🟣 新增疑问（交叉比对真实代码后发现）

#### A. "复用 renderBones()" 被高估（§三 / §四）

`renderBones()`（[runtime.ts](packages/boneyard/src/runtime.ts) 第 32–41 行）实际输出 `<div class="boneyard" style="position:relative;width:100%">` + `.boneyard-bone` + `@keyframes boneyard-pulse`，与初版 snippet 的 `#__bp / .bn / position:fixed / __bp_p` 完全不是同一套，"复用"被高估。

**✅ 决议：** 新增 `snippet.ts / renderSnippet()`：内部调用 `renderBones()` 得骨架 div，再包裹覆盖层 / teardown CSS / IIFE / 模板替换。`renderBones()` 不变。snippet 的 bone 类名统一为 `.boneyard-bone`。

---

#### B. `fixed` 覆盖层破坏坐标基准与圆形尺寸（§三，深化 Q3）

bone 的 `x/w` 是相对容器的百分比，圆形像素尺寸基于 `skel.width`（`capturedPxW=(b.w/100)*skel.width`）。直接把容器换成 `position:fixed;inset:0` 会让百分比基准变成视口、圆形变形。

**✅ 决议：** 覆盖层 `#__bp` 只负责定位，内层保留 `renderBones()` 的 `.boneyard`（`position:relative;width:100%`）作为基准容器，圆形像素逻辑沿用 `renderBones()` 现有行为；并限定 SSR 仅用于页面级 Skeleton（见 §三 决议 B）。

---

#### C. 暗色 CSS 的生成与选择器（§三 vs MEMORY）

snippet 硬编码 `html.dark`，但 `renderBones()` 不输出任何暗色 CSS，且 `MEMORY.md` 规定暗色仅用 `.dark` class。部分应用用 `[data-theme=dark]`。

**✅ 决议：** 暗色 CSS 由 `renderSnippet()` 生成，选择器用模板变量 `{{DARK_SELECTOR}}`（`--dark-selector`，默认 `.dark`），暗色 bone 颜色取 `DEFAULTS.web.dark`（[shared.ts](packages/boneyard/src/shared.ts)）。

---

#### D. `_sourceMtime` 在 CI 上不可靠（§十六，深化 Q10）

`git clone` / `checkout` 会重写 mtime，使刚检出的源文件看起来比 bones 新，`check --ci` 误报 STALE。

**✅ 决议：** `check` 改为基于已有 `_hash` 思路新增的 `_sourceHash`（源码内容 hash）比对；mtime 仅作本地快速预筛，`--ci` 模式跳过 mtime 直接走内容比对。

---

#### E. `Content-Length` / 压缩编码正确性（§五，深化 Q2）

全量 buffer 注入会使上游 `Content-Length` 失效，且若位于 gzip/br 之后，`</body>` 在压缩字节流中无法匹配。

**✅ 决议：** 中间件必须置于压缩中间件之前；注入后移除 `Content-Length`、走分块传输；仅处理 `text/html`。配合 Q2 的 Transform Stream 实现。
