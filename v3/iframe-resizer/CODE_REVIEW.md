# iframe-resizer — Code Review

> 范围:`iframe-resizer-mono` v5.5.9 全部包(`core` / `parent` / `child` / `react` / `vue` / `angular` / `jquery` / `common` / `legacy`)
> 方法:静态阅读 `packages/` 全部源码 + 关键测试 + `rollup.config.mjs` + `example/`
> 评级:🟥 高 / 🟧 中 / 🟨 低 — 风险与改进项

> **整体评价**:
> 这是我见过的**写得最"专业"的开源前端库之一**。架构清晰、协议稳定、测试完备、向后兼容做得足、可观测性内置。但同时它也是一份**"为了兼容 5 年前的 API 而不得不复杂"的代码**,且 5.x 起明显在**给商业化让路**。下面分类说明。

---

## 1. 架构与设计 🟢

### 优点

1. **协议抽象做得到位**。`MESSAGE_ID` + 文本协议 + 同源直调 / 跨域 postMessage 双通道,这是 iframe 通信最经典的设计。`isMessageForUs` 用 `slice(0, MESSAGE_ID_LENGTH)` 提前过滤,避免误处理别家的 postMessage。
2. **观测器矩阵选型合理**。`MutationObserver` + `ResizeObserver` + `IntersectionObserver`(`overflow` + `visibility`) + `PerformanceObserver`,覆盖了"内容可能怎么变"的所有主要场景,没有自己写 setInterval 轮询,也没有引入 polling。
3. **可降级路径清晰**。`getAutoSize` 一连串 `switch (true) { case … }` 显式列出所有 fallback 路径,代码读起来像设计文档。
4. **配置中心化**。`packages/core/values/defaults.js` 单一对象,改默认值只在一处。
5. **测试分层合理**。纯函数(Jest) + 集成(Karma+Jasmine) + 端到端(Playwright)三层,边界情况覆盖到位(`timeout.test.js` 用 fake timers 测了 9 个 case)。
6. **多框架薄壳 + 单一 core**。`@iframe-resizer/parent` / `react` / `vue` / `angular` / `jquery` 都只是把 `core` 包成习惯 API,业务逻辑只有一份。

### 观察

- **`packages/core/index.js` 是 1386 行的"上帝文件"**。把"消息处理 + 尺寸设置 + 选项处理 + setup 流程"全塞到一个文件、一个 `default (options) => (iframe) => {…}` 闭包里。`index.js` 既要做"父端通用 setup" 又要做"消息处理 + size 设置 + scroll 处理 + close 处理",职责过多,内部按功能可以拆出 `setup.js` / `message.js` / `resize.js` / `scroll.js` / `lifecycle.js`。
- **包边界松散**。`packages/parent/umd.js` 直接 `import { deprecateFunction } from '../core/console'`,跨包引用 core 内部文件,而不是通过 `@iframe-resizer/core` 公开 API。看似小事,但万一 core 重构就会断。
- **同名包暴露同名对象**:`iframe.iframeResizer` 和 `iframe.iFrameResizer` 都挂同一个 `resizer`(`packages/core/index.js:1097-1098`)。这种 V4 兼容在 README 提到了,但任何新代码都不该再写 `iFrameResizer`。

---

## 2. 兼容性与协议 🟧

### 风险

1. **协议字段顺序与默认值是硬约束**。`createOutgoingMsg`(`packages/core/index.js:912-960`)返回的数组每个位置都有意义,包括 `'8'`、`'32'`、`true` 等"占位字段",注释里直接写 "Backwards compatibility"。意思是这条协议**永远不能改**。任何 fork 想升级,都要么完整保留字段顺序,要么做一个版本号 + 双协议。
2. **`'8'` 之类 magic value 满天飞**。`createOutgoingMsg` 里 `'8'` / `'32'` / `true` 没注释,新人接手必须靠 git blame 才能理解。
3. **大量 deprecation 提示散布在主流程中**。`packages/core/index.js` 里 `updateOptionName`、`checkOptions`、`processOptions` 等地方都 `advise(...)`,每次 setup 都会 `console.warn`。这意味着:
   - 用户在生产里也会看到 deprecation 噪音
   - 想 fork 商业化的开发者必须全删干净
4. **`v5.5.9` 仍然支持 `window.iFrameResize` 旧全局名**(`packages/parent/umd.js` / `iife.js`),这本身合理,但因此代码里出现 "iFrame" 和 "iframe" 两种命名混用 —— 搜索体验极差。
5. **`setupIframeObject` 里的 `removeListeners()` 标记为"next version 移除"**,但又给了完整实现;这种"半成品 deprecate"会让用户干脆忽略警告。

### 建议

- 抽出一个 `wireProtocol.js` 集中定义字段顺序 + 类型,加显式注释"DO NOT REORDER"
- 把 `createOutgoingMsg` 中所有魔数替换为常量 `PADDING_V1 = '8'` / `INTERVAL_V1 = '32'`
- deprecation 提示加 `if (process.env.NODE_ENV !== 'production')` 等价判断(GPL 免费版可关掉)
- 把 `sizeWidth / sizeHeight / autoResize` 三个老选项默认设为 `undefined` 并在 `processOptions` 中静默映射为新 `direction`,避免打扰

---

## 3. 安全性 🟧

### 风险与发现

1. **`targetOrigin` 默认为 `'*'` 当 `checkOrigin` 关闭时**(`packages/core/index.js:1215-1262`)
   ```js
   function setTargetOrigin() {
     settings[iframeId].targetOrigin =
       settings[iframeId].checkOrigin === true
         ? getTargetOrigin(settings[iframeId].remoteHost)
         : '*'
   }
   ```
   这是 postMessage 的反模式。父页面默认走 `*` 意味着任何嵌入的第三方 iframe 都能被攻击者利用,通过 parent 的转发接口 postMessage 出去。**生产环境必须显式设 `checkOrigin: [...allowed origins]`**,但默认 `true` 是个好的默认。

2. **跨域消息可被同源函数直调,绕过 origin 校验**
   `trigger` 流程:
   ```js
   if (sameOrigin) {
     try {
       iframe.contentWindow.iframeChildListener(MESSAGE_ID + msg)
       return
     } catch (error) { … }
   }
   postMessageTarget.postMessage(MESSAGE_ID + msg, targetOrigin)
   ```
   如果父页面和子页面**同源**(部署在同域),`sameOrigin` 走 true,`postMessage` 走函数,`targetOrigin` 形同虚设 —— 同源攻击在子页面的 JS 已经在父页面同域上执行时,完全有办法伪造消息。`checkOrigin` 实际只防"跨域伪装",不防"同源注入"。

3. **`CHILD_READY_MESSAGE` 不带 origin 校验**(`packages/core/index.js:715-718`)
   ```js
   if (msg === CHILD_READY_MESSAGE) {
     iFrameReadyMsgReceived(event.source)
     return
   }
   ```
   任何跨域子 iframe 都能触发这个"准备就绪"信号,虽然只触发 `init` 重发,不算严重,但**没做 origin 校验**会触发 `init` 风暴。建议至少加 `event.source === window` 或在 origin 白名单中。

4. **child 端 `data` 用 `JSON.parse`(`packages/child/index.js:1598-1599`)**
   `parseFrozen = (data) => freeze(parse(data))` —— 没有 try/catch 保护。被 `errorBoundary` 包了一层,但错误会以 `advise` 形式输出,可能让攻击者通过精心构造的 `onMessage` 反复触发错误日志。
5. **`[iFrameSizer]` 消息头长度只有 12 字符**。极小概率被同名应用冲突,但 `isMessageForUs` 严格按长度切片 + `settings[id] in {…}` 二次校验,实际是安全的。

### 建议

- 强制 `targetOrigin` 默认值改为"`auto` 解析 `iframe.src`",只有用户显式传 `'*'` 才允许
- `CHILD_READY_MESSAGE` 处理时加 `event.source === settings[id].postMessageTarget` 校验
- `JSON.parse` 外层加 `try/catch`,错误时 `advise` 但不污染 console
- 在 README 安全章节里明确说明"同源部署时 `checkOrigin` 不防 XSS"

---

## 4. 性能与可观测性 🟢(主体) / 🟧(细节)

### 优点

- `requestAnimationFrame` 节流,`sendPending` 帧合并,`pending` 标志避免重复调度
- `MutationObserver` 用 `pending` + `setTimeout` 背压,EventLoop 忙时延后
- `PerformanceObserver` 自检 `getMaxElement` 耗时,均值 > 4ms 主动建议用户加 `data-iframe-size` —— 这是我见过最优雅的"性能自检"模式

### 细节问题

1. **`packages/child/observers/perf.js:38-39`**:
   ```js
   if (timings.length < MIN_SAMPLES) return
   if (detail.hasTags && detail.len < 25) return
   ```
   注释里 `hasTags` 时只看 `len < 25` 才采样,而 `getMaxElement` 在 `hasTags` 时遍历的也是 `taggedElements`。逻辑上正确,但**阈值硬编码**到常量(25)在大型应用(上千元素带 tag)会被绕过自检,小型应用(<25)反过来被频繁检查。

2. **`packages/child/observers/mutation.js:8-10`**:
   ```js
   const DELAY = 16
   const DELAY_MARGIN = 2
   const DELAY_MAX = 200
   ```
   60fps 假设是 16ms,但 120Hz 屏幕下每帧仅 8ms,`DELAY` 设 16 会让高频设备**触发不到节流**。应该用 `1000 / (window.devicePixelRatio > 1 ? 120 : 60)` 之类。

3. **`packages/child/observers/overflow.js:33-35`**:
   ```js
   const isOverflowed = (edge, rootBounds) =>
     edge === 0 || edge > rootBounds[side]
   ```
   `edge === 0` 的判断针对"元素 top = 0, 在 root 顶部"的情况,但实际可能漏掉"元素完全在 root 内部、但 width/height 撑出 root"的场景。**该用 `boundingClientRect[side] > rootBounds[side] || boundingClientRect[otherSide] < rootBounds[otherSide]`**。

4. **`packages/child/index.js:1180`**:
   ```js
   const selector = `* ${Array.from(IGNORE_TAGS).map(addNot).join('')}`
   const getAllElements = (node) => node.querySelectorAll(selector)
   ```
   每次调用都 `Array.from(IGNORE_TAGS).map(...).join(...)`,但 `IGNORE_TAGS` 是模块级常量,生成的 selector 字符串也应该是常量。**这部分应该提到模块顶层**,省掉每次 `getAllElements` 调用的 O(n) 字符串拼接。

5. **`packages/child/observers/resize.js`**:
   `observed` 是模块级 `WeakSet`,所有 iframe 共享。如果一个页面嵌入多个 iframe,这些 iframe 的 `body` 会被多个 ResizeObserver 实例重复监听。**应该按 observer 实例隔离**,而非模块级共享。

### 建议

- `getAllElements` 的 selector 提到模块顶层 `const ALL_ELEMENTS_SELECTOR = ...`
- `perf.js` 阈值按设备像素比动态调整,或读 `navigator.hardwareConcurrency`
- `overflow.js` 用完整边界比较而非仅 `edge > rootBounds[side]`
- `resize.js` 的 `observed` 改成闭包内的 `new WeakSet()`

---

## 5. 错误处理与边界 🟧

### 优点

- `isolateUserCode(fn, ...args) = setTimeout(()=>fn(...args), 0)` 隔离用户回调
- `errorBoundary` 包了 `sendSize` / `iframeListener` 关键路径
- `unique.js` 用 `CSS.escape` 处理 id 中的特殊字符
- `setupIframeObject` 时 `if (iframe.parentNode)` 检查避免 React 卸载时 `remove()` 抛错

### 缺陷

1. **`packages/core/index.js:1034-1036`**:
   ```js
   default:
     iframe.scrolling = settings[iframeId]
       ? settings[iframeId].scrolling
       : 'no'
   ```
   这段把 `scrolling` option 写到 `iframe.scrolling` 属性上,但 `scrolling` 是个被 HTML 规范废弃的属性(在 HTML5 中是"no longer conforming"),用 `style.overflow` 控制更可靠。`style.overflow` 已经在前面设置过了,这里再多此一举。
2. **`packages/core/index.js:1194-1197`**:
   ```js
   default:
     throw new TypeError(
       iframeId,
       `Direction value of "${direction}" is not valid`,
     )
   ```
   `TypeError` 构造器只接受一个 message 参数,这里把 `iframeId` 当成 message 用了,实际抛出的 message 是 `"<iframeId string>"`,提示完全错乱。

3. **`packages/parent/factory.js:48`**:
   ```js
   if (typeof window === UNDEFINED) return [] // don't run for server side render
   ```
   SSR 时返回 `[]`,但没给出 `console.warn`,React/Vue 用户在 SSR 阶段会看到无反应,排查困难。

4. **`packages/parent/factory.js:33-36`** 处理未挂载的 iframe:
   ```js
   case !element.isConnected:
     setupDisconnectedIframe(element)
     iFrames.push(element)
     break
   ```
   通过 `MutationObserver` 监听 `body.childList` 等待 iframe 挂载。但**没有超时**,如果用户写错 DOM 结构导致 iframe 始终不挂,`MutationObserver` 永远跑着,内存泄漏。

5. **`packages/child/index.js:1041`** `checkReadyYet`:
   ```js
   let readyChecked = false
   function checkReadyYet(readyCallback) {
     if (document.readyState === 'complete') isolateUserCode(readyCallback)
     else if (!readyChecked)
       addEventListener(document, READY_STATE_CHANGE, () =>
         checkReadyYet(readyCallback),
       )
     readyChecked = true
   }
   ```
   `readyChecked` 是闭包级布尔,只在 `firstRun = false` 后才被设过 `true` 一次;但每次 `init` 都会重置(其实不会,因为 `init` 只走一次)。**逻辑没问题但读起来费解**,建议用注释解释。

### 建议

- `setupDisconnectedIframe` 加超时,失败时 `advise` 提示用户
- `factory.js` SSR 返回 `[]` 时,生产模式下 `console.info("iframeResize() skipped during SSR")`
- `throw new TypeError(iframeId, message)` 改为 `throw new TypeError(\`[${iframeId}] ${message}\`)`
- 废弃 `iframe.scrolling` 属性,统一用 `style.overflow`

---

## 6. 测试覆盖 🟧

### 现状

- **Jest**:`core/timeout.test.js`(9 case) + `parent/factory.test.js`(9 case) + `common/utils.test.js` + `child/{read,from-string,deprecate,format-advise}.test.js`
- **Karma**:`spec/parentSpec.js`、`childSpec.js`(14KB)等
- **Playwright**:`e2e/`

### 缺口

1. **`packages/child/index.js`(1800 行)几乎没有单元测试**。`getAutoSize` 这个最复杂的尺寸算法函数,完全靠 Karma 端到端覆盖。重构风险大。
2. **`packages/child/observers/*` 没有任何单测**。每个 observer 的"何时触发"、"何时 throttle"、"何时 ignore"都靠 e2e,改一行就可能漏。
3. **`packages/core/index.js` 1386 行的 `default export` 零单测**。`trigger` / `iframeListener` / `setSize` / `closeIframe` 等核心函数没有任何 mock 测试。
4. **`getAutoSize` 的 10+ 个 switch case 没有 case-by-case 测试**。`hasTags` / `hasOverflow` / `firstRun` / `boundingSize === 0` / `prevBoundingSize === 0` / `triggerLocked && size unchanged` 等等,全是黑盒依赖浏览器 layout。
5. **没有 "license key 校验" 的测试**。`setMode` 是混淆代码,key 偏移表变动后无回归保护。
6. **跨域模拟**只靠 Karma + iframe 真实加载,缺少"postMessage 伪造"级别的单元测试。

### 建议

- 把 `getAutoSize` 拆成纯函数,输入 `{ boundingSize, scrollSize, prevBoundingSize, prevScrollSize, hasOverflow, hasTags, firstRun, triggerLocked, getOffset }` 输出 `{ size, source }`,加 20+ 单元测试
- 抽 `iframeListener` 出来做 mock `event`,覆盖 `isMessageFromIframe` / `isMessageForUs` / `isMessageFromMetaParent` 三个判定分支
- 把 `mode.js` 的 `setMode` 用一个公共 "fixed license → expected mode" 表测试,确保混淆后行为不变

---

## 7. 业务模型与可维护性 🟧

### 观察

1. **`packages/common/mode.js` 是**整个仓库中**唯一被有意混淆**的文件**,里面嵌着商业授权校验、过期提示、key 偏移表、付费 modal 加载逻辑。
   - 优点:商业策略集中,后端无依赖,前端可控
   - 缺点:
     - GPL-3.0 协议理论上要求衍生作品也开源 —— 但只要你的 fork 不打包混淆版,法律上可解
     - `purge()` / `throw` 在 `mode < 0` 时生效,意味着**未授权的 fork 在生产里会异常**,这种"硬开关"对社区不友好
     - 任何试图去掉授权校验的开发者必须重写整个 `mode.js` + `checkMode` 链路
2. **`packages/common/modal.js`** 动态从 jsDelivr 加载 `iframe-resizer.modal.js`,只有未授权时才注入。**这是商业化和开源之间的妥协设计**,生产模式禁用可减少 16% 包体积。
3. **`packages/legacy/`** 完整保留 V4 monolith 入口,只为"升级期用户"服务。这种"legacy 永远跟最新版"的做法在大型库很常见,但**让仓库变胖**,且 `legacy/js/iframeResizer.js` 等是 V4 时代的代码,可能依赖了 V4 的 child 协议,需要新测试覆盖。
4. **`auto-console-group` 是个外部依赖**,v5.5.9 用 `1.3.0`。这个库专门做"彩色 console 分组",我担心:
   - bundle size(`common/console.js` 里到处 `import { … } from 'auto-console-group'`)
   - 长期维护性(项目相对小众)

### 建议

- `mode.js` 抽成一个 `LicenseGate` 抽象,GPL 用户 fork 时只需替换 `LicenseGate` 实现
- `legacy/` 包移出主仓库,放到 `iframe-resizer/legacy-v4` 单独维护
- 评估 `auto-console-group` 是否可换为内置实现(几十行代码就够)

---

## 8. 框架适配质量 🟨

### React (`@iframe-resizer/react`)

- `useEffect(()=>{…}, [])` 只跑一次,`disconnect()` 在 cleanup。✅ 正确
- `useImperativeHandle` 暴露 `getRef / getElement / resize / moveToAnchor / sendMessage`。注意**没有暴露 `close` / `disconnect`**,在 `react/index.d.ts` 里有注释:"TODO: Add support for React.forwardRef() in next major version (Breaking change)"。这是个**已知未完成项**。
- 强制 `onBeforeClose` 返回 `false`,让 React 接管 DOM 卸载。✅ 合理但需要文档说明。
- `eslint-disable-next-line react-hooks/exhaustive-deps` 抑制了 `[]` 依赖警告,因为 options 不会变化。✅ 合理

### Vue (`@iframe-resizer/vue`)

- `index.js` 只有 7 行,逻辑在 `iframe-resizer.vue` 单文件组件。
- `rollup-plugin-vue` 6.0.0 编译。✅
- 没看到测试 ❌

### Angular (`@iframe-resizer/angular`)

- `iframe-resizer.directive.ts` 161 行,标准 `@Input options` + `@Output onReady/onMessage/...` 模式。
- `onBeforeClose` 同样返回 `false`。✅
- 强制 `waitForLoad: true`,**这是 Angular 的特殊处理**,因为 Angular 生命周期比 iframe 加载慢,waitForLoad 防止"先创建后初始化"。
- 没看到测试 ❌

### jQuery (`@iframe-resizer/jquery`)

- 32 行,纯粹 `$.fn` 插件。
- `iFrameResize` / `iframeResize` 双名兼容(老 API)。
- `plugin.test.js` 只测了"插件加载" ❌ 覆盖严重不足

### 建议

- 框架包应该有对应 `__tests__/` 或 `*.test.js`
- React 包加快照测试 + ref forwarding 测试
- Vue 包加至少一个 vue-test-utils 测试
- Angular 包加 Karma + Jasmine 测试(spec/ 里可以放)

---

## 9. 构建 / 发布 🟢

### 优点

- Rollup 多入口,UMD/ESM/CJS/IIFE 一应俱全
- `createBanner` 注入版本 + 许可证 banner
- `terser` 在生产模式下压缩,`pluginsProd` vs `pluginsBase` 区分
- `BETA` / `DEBUG` / `TEST` 环境变量支持不同发布模式
- `bin/publish.sh` 自动发布 `latest` / `beta` 双 tag

### 细节

- `rollup.config.mjs:36-42` 的 `filterDeps`:
  ```js
  const filterDeps = (contents) => {
    const pkg = JSON.parse(contents)
    delete pkg.dependencies.react
    delete pkg.dependencies.vue
    delete pkg.private
    return JSON.stringify(pkg, null, 2)
  }
  ```
  发布时去掉 react / vue 依赖 —— 期望使用方自带。但 README 没强调这一点,**用户安装 React 包后必须自己装 react**。

- `package.json` `engines.node` 要求 `>= 20.0.0`,这很激进 —— 企业用户还在用 Node 16 的会装不上。

### 建议

- 在 React/Vue 包 README 顶部加 "**PEER DEPENDENCY**: `react@>=18` / `vue@>=3.5`"
- `engines.node` 改为 `>=18`(LTS),减少兼容面

---

## 10. 文档 🟧

### 现状

- `README.md`:通用介绍,链接到官网
- `packages/README.md`:包目录说明
- 官方文档在 `https://iframe-resizer.com`(仓库只放 source)
- `LICENSE` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md` 齐全

### 缺口

- **没有 JSDoc**。`createOutgoingMsg`、`iframeListener`、`getAutoSize` 等核心函数零注释,新人接手全靠阅读整段代码。
- **没有 ARCHITECTURE.md / 设计文档**。`packages/TEMPLATE.md` 是新包创建模板,但没有"为什么这么设计"。
- **`example/`** 只有 html / react / vue,**没有 angular 示例**,**没有 jquery 示例**(只 README 提到)。
- **`spec/`** 集成测试代码里**没有 README** 解释 spec 各文件用途。
- **CONTRIBUTING.md** 提到 "run `npm test`",但 setup 流程(下载 Chromium、运行 karma)门槛较高。

### 建议

- 给所有"非平凡"函数加 JSDoc(`/** ... */`)
- 写一份 ARCHITECTURE.md(本文档的精简版)
- `spec/README.md` 解释每个 spec 文件 + 推荐用 chrome headless 跑
- 给 Angular / jQuery 各加一个最小 example

---

## 11. Top-10 优先级建议(按 ROI 排序)

| # | 建议 | 收益 | 成本 |
|---|---|---|---|
| 1 | `getAutoSize` 拆纯函数 + 写 20 个单测 | 防回归 ✅ | 中 |
| 2 | `factory.js` SSR 加 `console.info` + 超时机制 | 调试体验 ✅ | 低 |
| 3 | `getAllElements` selector 提到模块顶层 | 性能 ✅ | 极低 |
| 4 | `createOutgoingMsg` 魔数替换为命名常量 | 可读性 ✅ | 低 |
| 5 | `TypeError` 第二个参数 bug 修复 | 报错信息 ✅ | 极低 |
| 6 | `CHILD_READY_MESSAGE` 加 origin/source 校验 | 安全 ✅ | 低 |
| 7 | React 包 `forwardRef` 支持 | API 完整 ✅ | 中 |
| 8 | `overflow.js` 完整边界比较 | 准确性 ✅ | 低 |
| 9 | 框架包补单测 | 信心 ✅ | 中 |
| 10 | `mode.js` 抽 `LicenseGate` 抽象 | 可 fork 性 ✅ | 中 |

---

## 12. 结语

`iframe-resizer` 是一个**"基础设施级别"**的开源项目:它解决了一个跨域浏览器 API 的具体痛点,5 年维护稳定向后兼容,文档完善,商业化路径清晰。代码风格现代化(全 ESM、纯函数 + 闭包、观察者模式 + 帧合并),问题主要在:

1. **核心文件过大**(`core/index.js` 1386 行 + `child/index.js` 1800 行),拆分后单测覆盖率能大幅提升
2. **协议字段"硬化"** 带来 `createOutgoingMsg` 中魔数问题,需要命名常量注释
3. **安全默认值** 应该更严格(`targetOrigin` 关闭 `checkOrigin` 时不要 `'*'`)
4. **框架包测试覆盖不足**,尤其是 Angular 和 jQuery

如果你想基于它 fork 改:
- **别动 `mode.js`** — 那是商业逻辑,改它要么付费要么自己实现
- **可以改 `core/` 和 `child/`** — 协议、观测器、size 算法都是干净的代码
- **拆 `getAutoSize`** 是性价比最高的改动,会让整个仓库的可维护性上一个台阶
