# 10 · Step 1 · snippet 生成器

> Web 链路的最起点：把 `bones.json` 编译为可以直接塞进 `index.html` 的自包含 HTML 片段（含 `<style>` + `<div#__skeleton>` + `<script>` IIFE）。

---

## 1. 目标

输入 `bones.json` + 模板变量 → 输出 `{name}.snippet.html` 字符串，满足：

1. **自包含**：内联 CSS + DOM + 拆除 IIFE，可直接 `innerHTML` 或 `index.html` 注入
2. **零运行依赖**：snippet 加载到浏览器后**不依赖**任何 JS bundle，IIFE 自带 `__SKELETON_READY__` 幂等保护 + `MutationObserver` 拆除 + `MAX_WAIT` 兜底
3. **CSS 已裁剪 + 已去重**：经 [02 BGv2 §11](./02-最佳生成算法.md) 的 `styleCache` + `css-tree`，单 snippet ≤ 6 KB
4. **暗色 / 多断点感知**：CSS 内含 `{{DARK_SELECTOR}} .bp-*` 规则；多断点合并为 `@media`

---

## 2. 前置依赖

- [02-最佳生成算法.md](./02-最佳生成算法.md)：算法实现已存在（`packages/smarty/src/generator/`）
- [01-架构与模型.md §3](./01-架构与模型.md)：`SkeletonDSL` schema

---

## 3. 关键设计

### 3.1 snippet 模板

```html
<style id="__bp_s">
/* 1. 覆盖层基础样式 */
#__skeleton{position:fixed;inset:0;z-index:9998;pointer-events:none;overflow:hidden;background:#ffffff}
#__skeleton .sk-root{position:relative;width:100%;height:100%}
.sk-bone{position:absolute}

/* 2. 默认动画（pulse / shimmer 二选一，由 config 决定） */
@keyframes __sk_p{0%,100%{opacity:.85}50%{opacity:.45}}
.sk-bone{animation:__sk_p 1.8s ease-in-out infinite}

/* 3. styleCache flush 出的 bone class */
{{STYLE_CACHE_RULES}}

/* 4. teardown（CSS-only fade-out，来自 smarty-skeleton index.less） */
#__skeleton.out{animation:__sk_out 150ms forwards}
@keyframes __sk_out{to{opacity:0}}

/* 5. CLS 锚定：撑开 root 防回弹 */
{{ROOT_SELECTOR}}:empty{min-height:{{ROOT_MIN_H}}px}

/* 6. 暗色 */
{{DARK_SELECTOR}} #__skeleton{background:#111111}
{{DARK_SELECTOR}} .sk-bone{filter:invert(.92)}

/* 7. 多断点（仅 ssr 类，由 §3.3 合并写入） */
{{MEDIA_RULES}}
</style>

<div id="__bp" aria-hidden="true">
  <div class="sk-root">
    {{BONES_HTML}}
  </div>
</div>

<script>(function(){
  if(window.__SKELETON_READY__)return;
  window.__SKELETON_READY__=true;
  var p=document.getElementById("__skeleton");
  var s=document.getElementById("__skeleton_s");
  if(!p)return;
  var done=false;
  function dismiss(){
    if(done)return;done=true;
    p.classList.add('out');
    p.addEventListener('animationend',function(){p.remove();s&&s.remove();},{once:true});
  }
  var root=document.querySelector('{{ROOT_SELECTOR}}');
  if(!root){dismiss();return;}
  var obs=new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var added=muts[i].addedNodes;
      for(var j=0;j<added.length;j++){
        if(added[j].nodeType===1){obs.disconnect();dismiss();return;}
      }
    }
  });
  obs.observe(root,{childList:true,subtree:true});
  setTimeout(function(){obs.disconnect();dismiss();},{{MAX_WAIT}});
})();</script>
```

### 3.2 模板变量

| 变量 | 默认 | 来源 |
|---|---|---|
| `{{STYLE_CACHE_RULES}}` | — | BGv2 输出的 `dsl.css` |
| `{{BONES_HTML}}` | — | BGv2 `bonesToHtml(dsl.bones)` 输出 |
| `{{ROOT_SELECTOR}}` | `#root` | `config.ssg.rootSelector` |
| `{{DARK_SELECTOR}}` | `.dark` | `config.darkSelector` |
| `{{MAX_WAIT}}` | `5000` | `config.ssg.maxWait` |
| `{{ROOT_MIN_H}}` | `max(b.y+b.h)` | 按当前断点 bones 推算（CLS 锚定） |
| `{{MEDIA_RULES}}` | — | §3.3 多断点合并 |

### 3.3 多断点合并

多断点 DSL：

```jsonc
{
  "kind": "ssr",
  "width": 1280,
  "bones": [/* 1280 主断点 */],
  "breakpoints": {
    "375":  { /* 嵌套 DSL */ },
    "768":  { /* 嵌套 DSL */ }
  }
}
```

`renderSnippet()` 把所有断点的 bone class 合并到主 styleCache，差异部分（位置/尺寸）用 `@media (max-width)` 包裹：

```css
.bp-7 { left:5%; top:80px; width:30%; height:48px }      /* 1280 主 */
@media (max-width:375px) {
  .bp-7 { left:8%; top:64px; width:84%; height:40px }    /* 375 覆盖 */
}
@media (min-width:376px) and (max-width:768px) {
  .bp-7 { left:6%; top:72px; width:60%; height:44px }    /* 768 覆盖 */
}
```

实现思路：先以最大断点为 base，把其它断点 diff 出来写 `@media`。

### 3.4 局部 vs 全屏 Skeleton 的兼容

- snippet 走 `position:fixed;inset:0` 全屏覆盖 → 仅适用于 page 级 ssr
- 局部组件用 [13-step4-SWC-runtime-inject.md](./13-step4-SWC-runtime-inject.md) 的运行时 `<Skeleton>`，**不走 snippet 路径**
- snippet 的 `.sk-root` 容器是 `position:relative;width:100%;height:100%`，bone 坐标是相对它的百分比/像素

---

## 4. 代码骨架

```ts
// packages/smarty/src/web/snippet.ts
import { type SkeletonDSL } from '../core/schema'
import { computeRootMinHeight } from './layout-utils'
import { bonesToHtml, mergeBreakpoints } from './render-html'
import { pruneCss } from '../generator/cleanup-css'

export interface SnippetOptions {
  rootSelector: string         // 默认 '#root'
  darkSelector: string         // 默认 '.dark'
  maxWait: number              // 默认 5000
  rootMinHeight?: number       // 默认 auto = computeRootMinHeight(dsl)
  animate?: 'pulse' | 'shimmer' | 'solid'
}

export function renderSnippet(dsl: SkeletonDSL, opts: SnippetOptions): string {
  const bonesHtml = bonesToHtml(dsl.bones)           // 已经经过 styleCache，bones 都用 className
  const mediaRules = dsl.breakpoints ? mergeBreakpoints(dsl) : ''
  const rootMinH = opts.rootMinHeight ?? computeRootMinHeight(dsl)
  const animationKeyframes = pickAnimation(opts.animate ?? 'pulse')

  const css = pruneCss(
    [BASE_CSS, animationKeyframes, dsl.css ?? '', mediaRules].join('\n'),
    {/* keepRoot via in-memory DOM */}
  )

  return TEMPLATE
    .replace('{{STYLE_CACHE_RULES}}', dsl.css ?? '')
    .replace('{{BONES_HTML}}', bonesHtml)
    .replace('{{MEDIA_RULES}}', mediaRules)
    .replace(/\{\{ROOT_SELECTOR\}\}/g, opts.rootSelector)
    .replace(/\{\{DARK_SELECTOR\}\}/g, opts.darkSelector)
    .replace('{{ROOT_MIN_H}}', String(rootMinH))
    .replace('{{MAX_WAIT}}', String(opts.maxWait))
}

function computeRootMinHeight(dsl: SkeletonDSL): number {
  return dsl.bones.reduce((m, b) => Math.max(m, b.y + b.h), 0)
}
```

`bonesToHtml`：

```ts
// packages/smarty/src/web/render-html.ts
import type { Bone } from '../core/schema'

export function bonesToHtml(bones: Bone[]): string {
  return bones.map(boneToHtml).join('')
}

function boneToHtml(b: Bone): string {
  const cls = b.className ? `bp-bone ${b.className}` : 'bp-bone'
  const style = b.className ? '' : ` style="${inlineStyle(b)}"`   // styleCache 命中走 class
  switch (b.type) {
    case 'text':
      return `<div class="${cls} bp-text"${style} data-lines="${b.lines}"></div>`
    case 'list':
      // 列表项展开（运行时若拿到真实 list.length，可重渲染）
      return Array.from({ length: b.count }, (_, i) =>
        `<div class="${cls}" style="top:${b.y + i * b.itemHeight}px">
           ${bonesToHtml(b.itemBones)}
         </div>`).join('')
    default:
      return `<div class="${cls}"${style}></div>`
  }
}
```

### 4.1 `data-skeleton-text="gradient"` 文本渲染

文本 bone 不靠 `<div>` 多个矩形，而是直接靠 background-image：

```css
.sk-text {
  background-image:
    linear-gradient(
      transparent calc((1em - var(--sk-text-h, 0.7em))/2),
      var(--sk-color, #f0f0f0) calc((1em - var(--sk-text-h, 0.7em))/2),
      var(--sk-color, #f0f0f0) calc((1em + var(--sk-text-h, 0.7em))/2),
      transparent calc((1em + var(--sk-text-h, 0.7em))/2)
    );
  background-size: 100% var(--sk-text-lh, 1em);
  background-repeat: repeat-y;
}
```

---

## 5. 文件改动清单

| 路径 | 操作 | 说明 |
|---|---|---|
| `packages/smarty/src/web/snippet.ts` | 新增 | 本文核心 |
| `packages/smarty/src/web/render-html.ts` | 新增 | `bonesToHtml` |
| `packages/smarty/src/web/layout-utils.ts` | 新增 | `computeRootMinHeight` 等 |
| `packages/smarty/src/web/snippet.template.ts` | 新增 | snippet HTML 模板字符串 |
| `packages/smarty/src/generator/cleanup-css.ts` | 新增 | css-tree 裁剪（见 [02 §11](./02-最佳生成算法.md)） |
| `packages/smarty/test/snippet.test.ts` | 新增 | 单元测试 |
| `packages/smarty/test/fixtures/*.bones.json` | 新增 | 测试 fixture |

---

## 6. 验收

| 检查 | 方法 |
|---|---|
| snippet ≤ 6 KB（中等页面 ~150 bone） | unit test `dashboard-stats.bones.json` → `renderSnippet()` byteLength |
| `__SKELETON_READY__` 幂等：snippet 两次插入只触发一次 IIFE | DOM test in happy-dom |
| `MutationObserver` 仅元素节点触发 dismiss（避免空 div 误触发） | happy-dom 注入空 div → 不触发；注入 `<section>` → 触发 |
| `MAX_WAIT` 兜底：无 observer 触发也能 5s 后消失 | jest fake timer |
| 多断点 `@media` 合并：1280 主 + 375 覆盖，相同属性不重复 | snapshot test |
| 暗色规则注入 | 校验生成的 CSS 包含 `.dark #__skeleton` |
| CLS 锚定 `:empty{min-height}` 等于 `max(y+h)` | unit test |
| HTML 通过 `html-validate` 校验 | CI |

---

## 7. 已知坑 & 测试用例

1. **`</script>` 注入风险**：snippet 若被嵌进 `<script type="application/json">`，IIFE 体内不能出现 `</script>` 字面量。模板中已避免；如有需自定义脚本，必须用 `<\/script>` 转义。
2. **CSS 重复 keyframes 名**：`__sk_p` / `__sk_out` 是全局名，若业务也定义同名 keyframes 会冲突。已用 `__bp_` 前缀降低概率；未来若需进一步隔离，加 build-time 随机后缀。
3. **`{{ROOT_SELECTOR}}` 是字符串替换**：选择器内不能有 `}}`、`{{`、模板分隔符冲突字符。Vite plugin 已校验。
4. **多断点 base 选择**：本设计取最大断点为 base，移动端为主项目可改取 `375` 为 base 以减少 `@media` 覆盖块数（配置项 `ssg.breakpointBase`）。
5. **fixture**：`packages/smarty/test/fixtures/page-home.bones.json` 是 e2e 主用例，必保。
