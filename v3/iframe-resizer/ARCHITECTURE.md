# iframe-resizer — 功能与实现解析

> 项目版本:`iframe-resizer-mono` v5.5.9
> 仓库:https://github.com/davidjbradshaw/iframe-resizer
> License:GPL-3.0(同时存在按席位授权的商业版,见 `packages/common/mode.js` 中的 `setMode`)

---

## 1. 它解决什么问题

浏览器 `<iframe>` 自带一个长期痛点:**iframe 的内容高度/宽度是独立文档,父页面无法精确知道里面内容占了多大**。常见症状:

- 内容变多时,父页面里出现双重滚动条
- 内容变少时,父页面里出现大片空白
- 跨域 iframe 无法直接读取 `contentDocument.body.scrollHeight`
- iframe 内部 DOM/CSS 变化不会通知父页面
- 双向通信、滚动同步、in-page 锚点跳转,实现起来很琐碎

`iframe-resizer` 的目标就是一句话:

> **让 iframe 自适应其内容尺寸,并在内容变化时持续保持贴合,同时提供一套配套的跨域通信 / 滚动 / 鼠标 / 生命周期 API。**

---

## 2. 提供的功能(自上而下)

按用户视角,能力可拆成 4 层:

### 2.1 核心自适应
- 把 iframe 的 `height`/`width` 自动设成其内容尺寸
- 同时支持高(WIDTH)宽(HEIGHT)及方向:`vertical` / `horizontal` / `both` / `none`
- 内容变化自动感知:DOM 增删、样式变化、图片/字体加载、可见性变化都能触发重算
- 高度/宽度变化容忍值 `tolerance` —— 抖动 < N px 不重排

### 2.2 跨域 / 同源双通道
- 同源:直接调用 `iframe.contentWindow.iframeChildListener(msg)`
- 跨域:`postMessage`,带 `targetOrigin` 白名单(`checkOrigin`)
- `checkOrigin` 支持布尔(用 `iframe.src` 同源校验)或字符串数组(可信域列表)
- 全部通信都带消息头 `[iFrameSizer]` 前缀,避免误处理其他 postMessage

### 2.3 双向通信 & 滚动 API
- 父 → 子:`iframeResizer.sendMessage(msg)`,`moveToAnchor(anchor)`,`scrollTo/By/ToOffset`
- 子 → 父:`parentIframe.sendMessage(msg)`,`scrollTo/By/ToOffset`,`autoResize(bool)`,`close()`,`reset()`,`setOffsetSize(n)`
- 父页面获取子页面位置信息:`onMessage`,`getPageInfo` / `getParentProps`
- 子页面获取父页面位置/视口:`getParentProps` 回调
- in-page anchor:iframe 内部点 `#xxx` 时,自动转发给父页面滚动到对应锚点(在嵌套 iframe 时逐级冒泡)

### 2.4 扩展能力
- 鼠标进入/离开 iframe 事件(`onMouseEnter` / `onMouseLeave`),把屏幕坐标透传给父
- iframe 同步 `<title>` 到父页面(`syncTitle`)
- 标签化"待测量元素":给元素加 `data-iframe-size` 属性,直接以其为尺寸锚点(性能更稳)
- 忽略元素 `data-iframe-ignore`(其子节点不参与尺寸计算)
- 性能自监控:`PerformanceObserver` 监测 `getMaxElement` 耗时,>4ms 给出优化建议
- 检测会"卡死" iframe 的 CSS:`min/max-height/width` 设置在 `html`/`body` 上
- 检测到 `sandbox` 属性缺少 `allow-same-origin` + `allow-scripts` 时提示

---

## 3. 仓库结构

```
iframe-resizer/
├── packages/
│   ├── core/        # 核心连接器 (connectResizer), 父页面 API 入口
│   │   ├── index.js            # 默认导出: (options) => (iframe) => {…}
│   │   ├── console.js          # 基于 auto-console-group 的彩色日志
│   │   ├── timeout.js          # "iframe 无响应"警告定时器
│   │   ├── unique.js           # 检测重复 iframe id
│   │   └── values/{defaults,page,settings}.js
│   ├── parent/      # 父页面入口 (UMD + ESM + CJS)
│   │   ├── umd.js              # 浏览器 <script> 引入, 全局 window.iframeResize
│   │   ├── esm.js              # ES Module 入口
│   │   ├── iife.js             # js/iframe-resizer.parent.js 打包用
│   │   ├── factory.js          # 参数归一化(选择器 / 元素 / iFrames 数组)
│   │   └── index.d.ts
│   ├── child/       # 子页面入口(注入 iframe 内部)
│   │   ├── index.js            # 主体: 初始化 + 观测器 + 公开方法
│   │   ├── read.js             # 解析 child 端 data
│   │   ├── check-blocking-css.js
│   │   ├── console.js, from-string.js, listeners.js
│   │   └── observers/
│   │       ├── mutation.js     # DOM 增删观测
│   │       ├── resize.js       # ResizeObserver (body + 非 static 子元素)
│   │       ├── overflow.js     # IntersectionObserver, 标记 data-iframe-overflowed
│   │       ├── visibility.js   # IntersectionObserver, 检测标签页隐藏
│   │       ├── perf.js         # PerformanceObserver, 监测计算耗时
│   │       └── utils.js
│   ├── react/       # <IframeResizer> React 组件
│   ├── vue/         # Vue 组件
│   ├── angular/     # Angular directive
│   ├── jquery/      # $.fn.iframeResize 插件
│   ├── common/      # 跨包共享: consts, utils, listeners, mode, pubSub…
│   └── legacy/      # 旧版 monolithic 包, 5.0 之前用户兼容用
├── example/         # html / react / vue 三个示例
├── spec/            # Karma + Jasmine 集成测试
├── rollup.config.mjs  # 多入口 UMD/ESM/CJS/IIFE 构建
└── package.json
```

---

## 4. 工作机制详解

### 4.1 整体时序(父页面 / 子页面 / 双方协议)

```
        Parent Page                          Child Page
        -----------                          ----------
iframeResize(options)        ───►
  ├─ factory 归一化              加载 <script> @iframe-resizer/child
  ├─ core/connectResizer        child 立即 postMessage("[iFrameResizerChild]Ready")
  ├─ 监听 window.message        父页面收到 CHILD_READY_MESSAGE
  ├─ 触发 init (createOutgoingMsg)
  │     │
  │     └─ postMessage("[iFrameSizer]<id>:8:false:false:32:true:auto:…")
  │                                收到 init 消息
  │                                ├─ 读配置(parentId, calcMode, targetOrigin…)
  │                                ├─ checkVersion / checkBoth / checkMode
  │                                ├─ setMargin / setBodyStyle
  │                                ├─ stopInfiniteResizingOfIframe
  │                                │   (html/body height = auto !important)
  │                                ├─ attachObservers
  │                                │   ├─ MutationObserver
  │                                │   ├─ IntersectionObserver (overflow)
  │                                │   ├─ PerformanceObserver
  │                                │   ├─ ResizeObserver
  │                                │   └─ IntersectionObserver (visibility)
  │                                ├─ setupInPageLinks
  │                                ├─ setupEventListeners (afterprint/beforeprint)
  │                                ├─ setupMouseEvents
  │                                └─ 暴露 window.parentIframe API
  │
  │                                postMessage("[iFrameSizer]<id>:H:W:init:v5.5.9:mode")
  │
  │ ◄─── 父页面 iframeListener 接收
  │       ├─ checkOrigin 校验
  │       ├─ 解析 (id, height, width, type, msg)
  │       ├─ iframe.style.height = height + padding/border
  │       ├─ iframe.style.width  = width
  │       └─ 触发 onResized 回调
  │
  ├─ 后续 DOM 变化 → ResizeObserver / MutationObserver 触发
  │   └─ 子页面重新计算 H/W → 发送消息
  │
  └─ 双向 sendMessage / scrollTo / onMouseEnter / … 通过同样协议往返
```

### 4.2 消息协议(自定义文本协议)

`[iFrameSizer]<id>:<size>:<event>[:<msg>]`

- **头**:`[iFrameSizer]` 常量,父/子都先切片判断是否自家消息(`isMessageForUs`)
- **分隔符**:`:` (`SEPARATOR` 常量)
- **子→父**(init 消息):`id:8:sizeWidth:log:32:true:autoResize:bodyMargin:heightCalcMode:bodyBackground:bodyPadding:tolerance:inPageLinks:resizeFrom:widthCalcMode:mouseEvents:offsetHeight:offsetWidth:sizeHeight:license:version:mode:sizeSelector:logExpand`
- **子→父**(size 消息):`id:H:W:eventType[:msg]`
- **父→子**(init 消息):以同样文本格式反向传 23 字段配置
- 这种自研协议比 JSON 更省字节,作者在注释里写明:**改动协议会破坏向后兼容**,所以维持不变。

> 兼容做法:同源时直接函数调用 `iframe.contentWindow.iframeChildListener(MESSAGE_ID + msg)`,跨域时用 `postMessage`,两边都走同一份"消息文本"。

### 4.3 父页面:核心 `createResizer(options)(iframe)`

入口是 `packages/core/index.js` 导出的 `default (options) => (iframe) => {…}`。每次调用 `iframeResize(options, target)` 都返回一个新的闭包实例。流程:

1. **`ensureHasId`** —— 没有 id 就生成一个 `iFrameResizer0` 这种。
2. **`startLogging`** —— 解析 `log` / `logExpand`,url 里 `ifrlog` 关键字开启折叠日志。
3. **`processOptions`** —— 把用户 options 合并到 `settings[id]`,归一化 `direction`、`offsetSize`、`targetOrigin`。
4. **`setScrolling`** —— 设 `scrolling` 属性 + `overflow` 样式。
5. **`setupIframeObject`** —— 给 `iframe.iframeResizer` 挂上 `{ close, disconnect, resize, moveToAnchor, sendMessage }`。
6. **`init` (三种触发器)**:
   - `sendInit` —— 异步 init(`setTimeout`)
   - `addLoadListener` —— iframe `load` 事件触发 init
   - `iFrameReadyMsgReceived` —— 收到子页面 `[iFrameResizerChild]Ready` 立即 init
   任一成功即触发 `createOutgoingMsg(id)` 拼出配置字符串后 `trigger(INIT, msg, id)`。
7. **`trigger`**:同源走 `iframe.contentWindow.iframeChildListener` 同步函数,跨域走 `postMessage`。
8. **接收端** `iframeListener`:所有 `message` 事件统一进 `screenMessage` → `eventMsg`,按 `type` 派发:`init` / `resize` / `close` / `scrollTo` / `inPageLink` / `pageInfo` / `parentInfo` / `reset` / `autoResize` / `title` / `mouseEnter` / `mouseLeave` …
9. **`setSize`**:把 `messageData.height` 写到 `iframe.style.height`,按 `box-sizing: border-box` 时再加上 padding/border。
10. **`warnOnNoResponse`**:5s 内子页面没回 `init` 就警告(检查 sandbox / checkOrigin / waitForLoad 等常见坑)。
11. **`tabVisible`**:`document.visibilitychange` 时给所有 `autoResize && !firstRun` 的 iframe 重新发 resize 消息。

### 4.4 子页面:`iframeResizerChild()`

`packages/child/index.js` 在脚本加载时**自执行**。流程:

1. **注册监听器**:
   - `window.message` → `received(event)`
   - `document.readystatechange` → `ready()`
   - `window.pagehide` → `onPageHide`(持久化场景不 tearDown)
   - 暴露 `window.iframeChildListener(data) = setTimeout(received, 0)` —— 给同源父页面调用

2. **`ready()`**:页面 `complete` 时往 `parent` 和 `top` 各发一条 `[iFrameResizerChild]Ready`(用于支持 child 脚本晚于父页面加载的异步场景)。

3. **`receiver`** 收到 `init` 消息:
   - `readDataFromParent(data)` —— 解析 23 个字段(parentId、bodyMargin、heightCalcMode、tolerance、offset、license、version、mode 等)
   - `readDataFromPage()` —— 读子页面 `window.iframeResizer = {…}` 暴露的可选配置(`onMessage`, `onReady`, `onBeforeResize`, `targetOrigin`, `ignoreSelector`, `sizeSelector` …)
   - `checkVersion` / `checkBoth` / `checkMode` / `checkCrossDomain` / `checkHeightMode` / `checkWidthMode` / `checkQuirksMode` / `checkAndSetupTags` / `checkBlockingCSS` / `setMargin` / `setBodyStyle*` / `stopInfiniteResizingOfIframe` / `injectClearFixIntoBodyElement` / `applySelectors` / `attachObservers` / `setupInPageLinks` / `setupEventListeners` / `setupMouseEvents` / `setupOnPageHide` / `setupPublicMethods`

4. **观测器矩阵(精妙之处)**:
   | 观测器 | 监听目标 | 触发 |
   |---|---|---|
   | `MutationObserver` | `body` 子树 | 任何 DOM 增删/属性变化 → 计算新尺寸 |
   | `ResizeObserver` | `body` + 所有非 `position: static` 元素 | 元素 box 变化 → 计算新尺寸 |
   | `IntersectionObserver` (root = html) | 所有非 head/meta/script 等标签 | 元素 `bottom` > html 高度 → 标 `data-iframe-overflowed`,在所有候选中挑最远那个 |
   | `IntersectionObserver` (threshold 0) | `document.documentElement` | 整个页面可见性变化 |
   | `PerformanceObserver` | `mark` | 计算 `getMaxElement` 耗时,均值 > 4ms 提示加 `data-iframe-size` 锚点 |

5. **核心算法 — `getAutoSize(getDimension)`** (`packages/child/index.js` ~1207 行起):
   经典尺寸选取:`boundingClientRect` vs `documentElement.scroll + offset` 哪一个更可靠,有 10+ 个 `case` 分支处理:
   - `hasTags` → 直接用 `data-iframe-size` 标记的元素
   - `hasOverflow` → 用溢出元素的最大 `bottom/right`
   - 第一次初始化 → `boundingClientRect` (内联 layout)
   - 数值稳定 / 不变 → 沿用 `boundingClientRect`
   - `html` 高度变小、`html` == `scroll` 等场景都各自处理
   - 最后 `+ offsetSize`(用户配置的额外 padding),再 `Math.max(x, MIN_SIZE=1)`

6. **节流**:`sendPending` 标志 + `requestAnimationFrame`,**每帧最多重算一次**,避免高频 mutation 风暴。
   `triggerLocked` 同样用 rAF 互斥,防止"算完 → 发消息 → 收到 → 算 → 发…"无限循环。

7. **`sizeIframe`**:
   - 计算新尺寸
   - 跟上次比,差值 ≤ `tolerance` → 标 `NO_CHANGE` 不发
   - 否则通过 `dispatchMessage` 发到父页面

8. **`dispatchMessage`**:
   - `mode < -1` 静默不发送(过期/无效 key)
   - 同源直接 `window.parent.iframeParentListener(MESSAGE_ID + message)`
   - 跨域 `target.postMessage(MESSAGE_ID + message, targetOrigin)`
   - 记录 `performance.now()` 算耗时,日志里打印

9. **公开 API**:`window.parentIframe = Object.freeze({ autoResize, close, getId, getParentOrigin, getParentProps, moveToAnchor, reset, setOffsetSize, scrollBy/To/ToOffset, sendMessage, setHeightCalculationMethod, setWidthCalculationMethod, setTargetOrigin, resize, size })`。
   - 任何调用都通过 `sendMessage` 路由到父页面执行,自己永远不直接操作 iframe 元素

### 4.5 许可 / 模式系统 — `packages/common/mode.js`

源码中这一段是**唯一被混淆**的文件 —— 因为它实现商业授权校验:

```js
const l = (l) => { /* FNV-1a 风格哈希 */ }
const p = (l) => l.replace(/[A-Za-z]/g, /* ROT13-19 */)
const x = ['spjluzl', 'rlf', 'clyzpvu']  // 解混淆后 = ['license', 'key', 'expiry']
const y = [ /* 5 段脱敏的英文段落 */ ]   // 解混淆后:提示语
const z = ['NWSc3', 'zvsv', 'wyv', 'ibzpulzz', 'vlt']  // = ['GPLv3', 'live', 'test', 'expired', '...']
const t = Object.fromEntries(/* 8 段已知 key 哈希的偏移表 */)
```

`setMode(options)` 流程:
1. 取 `options.license || options.key || options.expiry`
2. 用 `l()` 算哈希
3. 查表 `t` 得 `v`(0..3)
4. 校验哈希与明文一致性 (`u[2] === l(u[0]+u[1])`)
5. 返回 `mode ∈ {-2, -1, 0, 1, 2, 3, 4}`,含义:

| mode | 含义 | 行为 |
|---|---|---|
| ≥1 | 商业 key 有效 | 隐藏 banner、关闭 `consoleGroup` |
| 0 | GPL / 免费 | 静默,只打 `vInfo` |
| -1 | 试用 | 打 `vInfo`,启动期提示 |
| -2 | 过期 / 非法 | 抛错并 `purge` 日志、加载 `iframe-resizer.modal.js` 弹付费窗 |

**`purge` 行为是这套商业模式的"杀手锏"**:核心代码里 `mode < 0` 触发的 `purge()`、`throw`、`checkOrigin` 强制开启等,都是围绕模式数字做的"压力测试"。这意味着你 fork 后想商用,核心 `mode.js` 必须替换。

> 题外话:这是教科书级别的"硬编码"商业策略示范 —— 把付费校验、过期文案、key 偏移表都集中在单一文件内,前端代码混淆但后端不依赖,升级容易。

### 4.6 框架适配

| 框架 | 适配点 | 备注 |
|---|---|---|
| **vanilla** (`@iframe-resizer/parent`) | `iframeResize(options, target)` 接受 `CSS selector` / `HTMLElement` / `undefined`(扫所有 iframe) | 工厂包,挂 `iframe.iframeResizer` |
| **React** (`@iframe-resizer/react`) | `<IframeResizer {...props} ref={…} />` | `useEffect` 一次性绑定,卸载时 `disconnect()`;`useImperativeHandle` 暴露 `sendMessage/moveToAnchor/resize` |
| **Vue** (`@iframe-resizer/vue`) | `Vue.component('IframeResizer', ...)` | 单文件组件 + rollup-plugin-vue 编译 |
| **Angular** (`@iframe-resizer/angular`) | `[iframe-resizer]` 指令,`@Input options`、`@Output onReady/onMessage/...` | `ngAfterViewInit` 调 `connectResizer`,`ngOnDestroy` 调 `disconnect` |
| **jQuery** (`@iframe-resizer/jquery`) | `$(selector).iframeResize(options)` | 把 `connectResizer` 包成 `$.fn` 插件 |

React 包有个小坑:`onBeforeClose` 永远返回 `false`,因为 React 接管了 DOM 生命周期,不能直接 `iframe.remove()`,需要上层通过 `setState` 卸载。

### 4.7 错误处理

- 几乎所有用户回调都用 `isolateUserCode(fn, ...args) = setTimeout(()=>fn(...args), 0)`,用户抛错不会污染主流程
- 涉及 size 计算的 `sendSize` 用 `errorBoundary` 包了一层,子页面任何错都会被捕获并 `advise` 到日志
- `querySelectorAll('iframe#xxx')` 用 `CSS.escape(id)` 防止 id 里含特殊字符
- `throw new TypeError(...)` 用于"配置错就早失败",比如非 iframe 元素、未知 direction、license key 非法
- `warn` 类的提示走 `auto-console-group` 分组日志,默认折叠

### 4.8 性能优化(作者的"set theory"思路)

README 里那句"uses Set Theory to ensure it only checks the page elements that effect the sizing":

1. **`IGNORE_TAGS` 黑名单 + `getAllElements`**:`document.querySelectorAll('* :not(head):not(body):not(meta):not(base):not(title):not(script):not(link):not(style):not(map):not(area):not(option):not(optgroup):not(template):not(track):not(wbr):not(nobr)')` — 把"永远不会撑大 body 的元素"先排除。
2. **`MutationObserver` 节流**:用 `pending` 标志 + `requestAnimationFrame` 把同一帧内的所有 mutation 合并成一次尺寸重算。
3. **EventLoop 背压**:`processMutations` 检测 `delay > 16ms*N`(60fps × N),就用 `setTimeout` 推迟一帧,降低长任务卡死。
4. **`getMaxElement` 仅在 `hasTags` 或 `hasOverflow` 时才全量遍历**;否则直接用 `boundingClientRect` / `scrollHeight` 即可,O(1) 拿到尺寸。
5. **`WeakSet` / `Set`**:`observed: WeakSet`(避免阻止元素被 GC);`addedNodes: Set` 合并同一节点的多次增删。
6. **`PerformanceObserver` 自检**:均值 > 4ms 时建议用户加 `data-iframe-size`,**让用户主动收紧搜索范围**,而非把 O(n) 一直跑下去。
7. **`sendPending` 帧合并**:同帧内所有触发源只算一次。
8. **`observer.observe(body)`** 一次,新增节点通过 `mutation` + `addObservers` 再挂,避免给每个新元素单独建 observer。
9. **publish 订阅架构**(`packages/common/pubSub.js`)解耦多个观测源。

---

## 5. 一个完整示例(取自 `example/html/index.html`)

```js
const iframes = iframeResize({
  inPageLinks: true,
  license: 'GPLv3',
  log: true,
  waitForLoad: true,
  onResized(messageData)  { /* height 改变时 */ },
  onMouseEnter(messageData){ /* 鼠标进 iframe */ },
  onMouseLeave(messageData){ /* 鼠标出 iframe */ },
  onMessage(messageData)  { /* 子页面发来消息 */ },
  onAfterClose(id)        { /* iframe 被关闭 */ },
  onScroll(messageData)   { /* 父页面被滚动 */ },
})
```

子页面 (`child/frame.content.html`):
```html
<script src="@iframe-resizer/child"></script>
<script>
  window.parentIframe.sendMessage('Hello from iframe!')
  window.parentIframe.scrollToOffset(0, 0)
  window.iframeResizer = {
    license: 'GPLv3',
    onMessage: (msg) => console.log('got:', msg),
    onBeforeResize: (n) => n + 20, // 自己再加 20px 留白
    targetOrigin: '*',
  }
</script>
```

整个交互流程就跑起来了。

---

## 6. 测试 / 质量保障

- **Jest**:`packages/*/*.test.js`,覆盖 `utils`、`unique`、`timeout`(超时警告)、`factory`(disconnected iframe 容错)、`read`、`deprecate`、`format-advise` 等纯函数 + 边界
- **Karma + Jasmine**:`spec/*.js`,跑真实 Chrome 测端到端(`childSpec.js` 14KB,覆盖面很广)
- **Playwright**:`e2e/` 下,跨浏览器真机验证
- **ESLint + airbnb + adjunct + sonarjs + security + xss 等**几十套规则,极度严格
- **Rollup 多格式产物**:每个包都同时产出 UMD / ESM / CJS,自动 `auto-console-group` 注入
- **License banner**:每个产物顶部带版本 + 许可 banner

---

## 7. 总结:它的设计哲学

1. **自适应尺寸的难点不在算法,在观测** — 用 4 个浏览器原生 Observer(Mutation / Resize / Intersection × 2 / Performance)组合 + 帧合并节流,把"哪些元素尺寸变了"这个问题交给浏览器本身
2. **同源/跨域一条协议** — 用同样消息文本 + 双通道,简化心智模型
3. **配置向后兼容** — 协议和选项的字段顺序、默认值都钉死(用了 `'8'` `'32'` `true` 这种 magic value 留位)
4. **把商业化做在模式上** — `setMode` 单一文件集中处理 key 校验、过期、试用,前端代码不依赖外部付费服务
5. **多框架统一** — 一份 core + 各框架薄壳包(React/Vue/Angular/jQuery),所以升级时核心只维护一份
6. **保守 + 防御式** — `try/catch` 包裹所有用户回调,`setTimeout(0)` 隔离用户代码,默认值宁可冗余也不缺漏
