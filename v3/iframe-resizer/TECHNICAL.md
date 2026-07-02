# iframe-resizer — 技术方案详解

> 本文不是"它是什么",而是"**它怎么用代码做到**"。
> 每一节都给出关键源文件 + 行号引用 + 真实代码片段。
> 适合:要做技术评审、二次开发、做类似产品的人。

---

## 0. 一句话技术架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Parent Page (core + parent)                                         │
│  ┌──────────────────────┐    message event    ┌──────────────────┐  │
│  │ iframeListener()     │◄────────────────────┤  iframe (child)  │  │
│  │   - checkOrigin      │  text protocol:     │                  │  │
│  │   - setSize          │   [iFrameSizer]      │ MutationObserver │  │
│  │   - trigger(out)     │   <id>:<h>:<w>:<ev>  │ ResizeObserver   │  │
│  │                      │                      │ IntersectionObs×2│  │
│  │ trigger()  ──────────┼──► postMessage() ────┤ PerfObserver     │  │
│  │                      │  or same-origin call │                  │  │
│  └──────────────────────┘                      │ getAutoSize()    │  │
│                                                │ sendSize()       │  │
│  ┌──────────────────────┐                      │ parentIframe API │  │
│  │ warnOnNoResponse(5s) │                      └──────────────────┘  │
│  │ tabVisible resync    │                                             │
│  └──────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘
```

**核心契约**:
1. **协议**:双方都用同一条文本消息(消息头 `[iFrameSizer]` + 字段分隔符 `:`),**不升级、不修改字段顺序**,向后兼容
2. **通道**:同源用 `iframe.contentWindow.iframeChildListener` 同步函数调用(快、无序列化),跨域用 `window.postMessage`(带 `targetOrigin` 校验)
3. **状态**:`settings[id]` 在父端作为单一来源,`let` 散落在闭包内作为子端状态
4. **观测**:浏览器 5 个原生 Observer 组合,无 polling
5. **节流**:`requestAnimationFrame` 帧合并,`pending` 标志防重入

---

## 1. 消息协议 — 文本协议的反向选择

### 1.1 为什么不直接用 JSON

`packages/core/index.js:912-960` `createOutgoingMsg` 跟 `packages/child/index.js:1540-1584` `dispatchMessage`,用的是**自研文本协议**:

```js
// 父→子 init 消息
return [
  id,
  '8',                          // [1] PaddingV1 占位 (backwards compat)
  sizeWidth,                    // [2]
  log,                          // [3]
  '32',                         // [4] IntervalTimer 占位 (backwards compat)
  true,                         // [5] EnablePublicMethods 占位
  autoResize,                   // [6]
  bodyMargin,                   // [7]
  heightCalculationMethod,      // [8]
  bodyBackground,               // [9]
  bodyPadding,                  // [10]
  tolerance,                    // [11]
  inPageLinks,                  // [12]
  CHILD,                        // [13] resizeFrom (恒为 'child')
  widthCalculationMethod,       // [14]
  mouseEvents,                  // [15]
  offsetHeight,                 // [16]
  offsetWidth,                  // [17]
  sizeHeight,                   // [18]
  license,                      // [19]
  page.version,                 // [20]
  mode,                         // [21]
  '',                           // [22] sizeSelector 占位
  logExpand,                    // [23]
].join(SEPARATOR)               // SEPARATOR = ':'
```

完整消息 = `MESSAGE_ID + 上面的字符串` = `[iFrameSizer]<id>:8:false:false:32:true:true:0:auto:null:null:0:false:child:auto:false:0:0:true:GPLv3:v5.5.9:0::false`

**优势**:
- **字节数减半**(vs JSON,数字/布尔都没引号)
- **解析是 O(1) 切片** + `split(SEPARATOR)`,不需要 JSON.parse
- **schema 永远是数组**,无字段名变化
- **占位字段永远不能动** —— 注释里明写 "DO NOT REORDER"

**代价**:
- 所有数字/布尔在 wire 上是字符串,接收端要做 `Number()` / `getBoolean()` 强转
- `onMessage` 走 JSON,因为 payload 可能是任意对象 —— 所以一个仓库里**有两种消息编码**并存

### 1.2 消息类型派发

父端 `eventMsg` (`packages/core/index.js:573-675`) 是核心 dispatch,接收 `[iFrameSizer]<id>:H:W:type[:msg]`,按 `type` 分发:

| `type` 常量 | 含义 | 处理 |
|---|---|---|
| `INIT` | 首次握手 | `setSize` + `checkSameDomain` + `checkVersion` + `onReady` |
| `CLOSE` | 子页请求关闭 | `closeIframe()`(触发 `onBeforeClose`/`onAfterClose`) |
| `MESSAGE` | `parentIframe.sendMessage` | 解析后 `on('onMessage', {iframe, message})` |
| `MOUSE_ENTER` / `MOUSE_LEAVE` | 鼠标进出 iframe | 把 `screenX/Y` 透传给父回调 |
| `BEFORE_UNLOAD` | 子页 pagehide | 标 `initialised = false` |
| `AUTO_RESIZE` | 开关自动 resize | 更新本地 `settings[id].autoResize` |
| `SCROLL_BY` / `SCROLL_TO` / `SCROLL_TO_OFFSET` | 子页控制父页滚动 | `window.scrollBy` / 维护 `page.position` + `window.scrollTo` |
| `PAGE_INFO` / `PARENT_INFO` | 子页请求父页位置/视口信息 | 启动 `ResizeObserver` + `scroll` 监听器,持续推送 |
| `PAGE_INFO_STOP` / `PARENT_INFO_STOP` | 停推 | `observer.disconnect()` |
| `IN_PAGE_LINK` | 子页找不到锚点,转发给父 | `findTarget` |
| `TITLE` | 子页 `<title>` 变化 | `iframe.title = document.title` |
| `RESET` | 子页请求重置尺寸 | `resetIframe` |
| 其他 | 视为"尺寸更新"消息 | `setSize` |

**所有"尺寸更新"消息的 default 分支处理逻辑**:
```js
// packages/core/index.js:651-674
default:
  if (width === 0 && height === 0) {
    warn('Unsupported message ... iframe-resizer version mismatch')
    return
  }
  if (width === 0 || height === 0) {
    log('Ignoring message with 0 height or width')
    return
  }
  if (document.hidden) {
    log('Page hidden - ignored resize request')   // Firefox 修正
    return
  }
  resizeIframe()                                  // 真正干活
```

### 1.3 消息头快速过滤

`packages/core/index.js:183-185`:
```js
const isMessageForUs = (msg) =>
  MESSAGE_ID === `${msg}`.slice(0, MESSAGE_ID_LENGTH) &&
  msg.slice(MESSAGE_ID_LENGTH).split(SEPARATOR)[0] in settings
```

**两段判断**:
1. `slice(0, 12) === '[iFrameSizer]'` 排除所有别家的 postMessage
2. `settings[id]` 必须存在 —— 排除"iframe 已经被关闭但还有未到达的消息"

**子端** `packages/child/index.js:1675-1677` 也有同样函数。

### 1.4 `CHILD_READY_MESSAGE` 异步握手

子脚本可以异步加载,父可能比子更早 init。子端在 `ready()` (`packages/child/index.js:1740-1757`) 主动 postMessage 一条 `[iFrameResizerChild]Ready`:

```js
const sendReady = (target) =>
  target.postMessage(
    CHILD_READY_MESSAGE,
    window?.iframeResizer?.targetOrigin || '*',  // 信任用户配置
  )

function ready() {
  if (document.readyState === 'loading' || !firstRun || sent) return
  sendReady(parent)
  if (parent !== top) sendReady(top)              // 双发:支持嵌套 iframe
  sent = true
}
```

父端 `iframeListener` (line 715-718) 收到这条消息就调用 `initChild()`:
```js
if (msg === CHILD_READY_MESSAGE) {
  iFrameReadyMsgReceived(event.source)
  return
}
```

`iFrameReadyMsgReceived` (`packages/core/index.js:691-692`) 给所有已注册的 iframe 调 `iframeReady(source)({ initChild, postMessageTarget })`,仅当 `source === postMessageTarget` 时才真正 `initChild()`。

---

## 2. 同源 vs 跨域双通道

`packages/core/index.js:866-910` `trigger(calleeMsg, msg, id)` 是父→子的统一发送函数:

```js
function postMessageToIframe() {
  const { iframe, postMessageTarget, sameOrigin, targetOrigin } = settings[id]

  if (sameOrigin) {
    try {
      // 通道 A: 同源直接函数调用
      iframe.contentWindow.iframeChildListener(MESSAGE_ID + msg)
      logSent(`Sending message to iframe ${id} via same origin`)
      return
    } catch (error) {
      if (calleeMsg in INIT_EVENTS) {
        settings[id].sameOrigin = false                  // 失败回退
        log(id, 'New iframe does not support same origin')
      } else {
        warn(id, 'Same origin messaging failed, falling back to postMessage')
      }
    }
  }

  // 通道 B: postMessage (跨域主路径)
  logSent(`Sending message to iframe: ${id} targetOrigin: ${targetOrigin}`)
  postMessageTarget.postMessage(MESSAGE_ID + msg, targetOrigin)
}
```

**子端** (`packages/child/index.js:1559-1580`) 是同样的双通道结构:

```js
function dispatchToParent() {
  const message = `${parentId}:${size}:${triggerEvent}${...}`
  if (sameOrigin)
    try {
      window.parent.iframeParentListener(MESSAGE_ID + message)
    } catch (error) {
      if (mode === 1) sendFailed()
      else throw error
      return
    }
  else target.postMessage(MESSAGE_ID + message, targetOrigin)
}
```

**为什么两条通道都用同一份文本消息**:作者说 "updating the message format would break backwards compatibility"(`packages/child/index.js:1686-1687`)。所以**双通道只换 transport,不换 payload**,降低了维护成本。

### 2.1 `sameOrigin` 怎么判定

`packages/core/index.js:533-542`:
```js
function checkSameDomain(id) {
  try {
    settings[id].sameOrigin =
      !!settings[id]?.iframe?.contentWindow?.iframeChildListener
  } catch (error) {
    settings[id].sameOrigin = false
  }
}
```

试探子页面是否挂了 `iframeChildListener` 函数 —— **同源可以直接读 `contentWindow`**,跨域会抛 `SecurityError`。

子端同步探测 `packages/child/index.js:362-368`:
```js
function checkCrossDomain() {
  try {
    sameOrigin = mode === 1 || 'iframeParentListener' in window.parent
  } catch (error) {
    log('Cross domain iframe detected')
  }
}
```

**两边各探测一次,任一失败就强制走 postMessage**。

### 2.2 `checkOrigin` 白名单

`packages/core/index.js:137-181`:
```js
function isMessageFromIframe() {
  function checkAllowedOrigin() {
    function checkList() {                              // 数组白名单
      for (; i < checkOrigin.length; i++)
        if (checkOrigin[i] === origin) { retCode = true; break }
    }
    function checkSingle() {                             // 单个白名单
      return origin === settings[iframeId]?.remoteHost
    }
    return checkOrigin.constructor === Array ? checkList() : checkSingle()
  }

  const { origin, sameOrigin } = event
  if (sameOrigin) return true                            // 同源跳过

  let checkOrigin = settings[iframeId]?.checkOrigin
  if (checkOrigin && `${origin}` !== NULL && !checkAllowedOrigin()) {
    throw new Error(`Unexpected message received from: ${origin} ...`)
  }
  return true
}
```

**`settings[iframeId].remoteHost` 怎么算** (`packages/core/index.js:1264-1268`):
```js
settings[iframeId] = {
  ...defaults,
  remoteHost: iframe?.src.split('/').slice(0, 3).join('/'),
  //                          ^^^^^^^^^
  //           "https://example.com/foo" -> "https://example.com"
}
```

**这就是 `checkOrigin: true` 的默认值** —— 直接拿 iframe.src 的 origin 比对 `event.origin`,**这意味着**:
- ✅ 单域部署:`iframe.src = 'https://app.example.com/page'` → `remoteHost = 'https://app.example.com'`
- ❌ 跨域部署:用户必须传 `checkOrigin: ['https://app.example.com', 'https://staging.example.com']` 数组
- ❌ 域名跳转:`iframe` 跳到 `https://other.com/page` → `origin` 不匹配 → 抛错,父页 `noResponse` 警告

---

## 3. 核心算法 — `getAutoSize` 全分支

`packages/child/index.js:1207-1298` 是整个仓库的"心脏"。它的目标:**在任意时刻算出一个最贴近真实内容的 height/width**。

### 3.1 输入

```js
getDimension === getHeight  // 或 getWidth
const dimension = getDimension.label                          // 'height' | 'width'
const boundingSize = getDimension.boundingClientRect()       // <html> .getBoundingClientRect().bottom
const ceilBoundingSize = Math.ceil(boundingSize)
const floorBoundingSize = Math.floor(boundingSize)
const scrollSize = getAdjustedScroll(getDimension)            // <html> .scrollHeight + max(0, offset)
```

辅助状态:
- `prevBoundingSize[dimension]` / `prevScrollSize[dimension]` — 上一帧缓存
- `hasTags` — 存在 `data-iframe-size` 元素
- `hasOverflow` — 存在 `data-iframe-overflowed` 元素
- `firstRun` — 首次初始化
- `triggerLocked` — 是否正处于 rAF 单步互斥期

### 3.2 全部分支(按顺序)

```js
switch (true) {
  case !getDimension.enabled():                                // 方向配置为 'none' / 关闭
    return Math.max(scrollSize, MIN_SIZE)

  case hasTags:                                                // 1. 用户主动指定"以哪个元素为锚"
    calculatedSize = getDimension.taggedElement()              //    → 遍历所有 [data-iframe-size], 取 max(bottom + margin-bottom)
    break

  case !hasOverflow && firstRun &&
       prevBoundingSize[dimension] === 0 &&
       prevScrollSize[dimension] === 0:                        // 2. 第一次跑: 用 boundingClientRect
    info('Initial page size values:', sizes)
    calculatedSize = returnBoundingClientRect()
    break

  case triggerLocked &&                                        // 3. rAF 锁内、尺寸没变: 沿用
       boundingSize === prevBoundingSize[dimension] &&
       scrollSize === prevScrollSize[dimension]:
    calculatedSize = Math.max(boundingSize, scrollSize)
    break

  case boundingSize === 0 && scrollSize !== 0:                // 4. <html> 高度为 0 但 scrollHeight 有值 → 隐藏 tab
    calculatedSize = scrollSize
    break

  case !hasOverflow &&
       boundingSize !== prevBoundingSize[dimension] &&
       scrollSize <= prevScrollSize[dimension]:                // 5. <html> 变高、scroll 变小 → 用 BCR
    calculatedSize = returnBoundingClientRect()
    break

  case !isHeight:                                              // 6. 宽度计算
    calculatedSize = getDimension.taggedElement()
    break

  case !hasOverflow && boundingSize < prevBoundingSize[dimension]:  // 7. <html> 高度变小
    calculatedSize = returnBoundingClientRect()
    break

  case scrollSize === floorBoundingSize ||
       scrollSize === ceilBoundingSize:                        // 8. <html> ≈ scroll → 用 BCR
    calculatedSize = returnBoundingClientRect()
    break

  case boundingSize > scrollSize:                              // 9. <html> > scroll → BCR 更准
    calculatedSize = returnBoundingClientRect()
    break

  case hasOverflow:                                            // 10. 有溢出元素 → 用溢出元素
    calculatedSize = getDimension.taggedElement()
    break

  default:                                                     // 11. 兜底
    calculatedSize = returnBoundingClientRect()
}
```

### 3.3 两条候选尺寸的取舍

为什么会有这么多 case?因为浏览器对"页面内容到底占多大"有两个不一致的真相:

| API | 优点 | 缺点 |
|---|---|---|
| `documentElement.getBoundingClientRect().bottom` | 反映**实际渲染**的 box | 包含 transform 偏移、负 margin |
| `documentElement.scrollHeight` | 反映**完整可滚动**区域 | 不含 margin / padding / 定位偏移 |

**作者的设计哲学**:
- 有 `data-iframe-size` / `data-iframe-overflowed` 标记 → 信任用户,**直接用标记元素**
- 没有 → 大多数情况下用 `boundingClientRect`(`returnBoundingClientRect()` 函数:`prevBoundingSize[dimension] = boundingSize; prevScrollSize[dimension] = scrollSize; return Math.max(boundingSize, MIN_SIZE)`)
- scrollHeight ≈ boundingClientRect → 优先 BCR(更准)
- boundingClientRect > scrollHeight → BCR(异常 layout,scroll 算少)
- 隐藏 tab / 首次跑 → 用 scrollHeight(更稳)

最后 `calculatedSize += getOffsetSize(getDimension)`(`packages/child/index.js:1295`),这是用户配置的 `offsetSize`,再加 `Math.max(x, MIN_SIZE=1)` 兜底。

### 3.4 `tolerance` 节流

`packages/child/index.js:1357`:
```js
const checkTolerance = (a, b) => !(Math.abs(a - b) <= tolerance)
```

`sizeIframe` (line 1404-1406) 在算完之后:
```js
const isSizeChangeDetected = () =>
  (calculateHeight && checkTolerance(height, newHeight)) ||
  (calculateWidth && checkTolerance(width, newWidth))
```

只有真变化才发消息 —— **避免抖动**。

---

## 4. 观测器矩阵 — 5 个原生 Observer 的协调

`packages/child/index.js:1113-1125` 是入口,所有 observer 在 `attachObservers()` 里创建并塞进 `tearDownList`:

```js
function attachObservers() {
  const nodeList = getAllElements(document.documentElement)

  const observers = [
    createMutationObserver(mutationObserved),                // 1
    createOverflowObservers(nodeList),                       // 2
    createPerformanceObserver(),                             // 3
    createResizeObservers(nodeList),                         // 4
    createVisibilityObserver(visibilityChange),              // 5
  ]

  pushDisconnectsOnToTearDown(observers)                    // 退出时统一 disconnect
}
```

### 4.1 `MutationObserver` (DOM 增删)

`packages/child/observers/mutation.js:139-159`:
```js
export default function createMutationObserver(callback) {
  const observer = new window.MutationObserver(mutationObserved)
  const target = document.body || document.documentElement

  processMutations = createProcessMutations(callback)
  observer.observe(target, {
    attributes: true,
    attributeFilter: [IGNORE_ATTR, SIZE_ATTR],
    childList: true,
    subtree: true,
  })
}
```

回调链路:
1. `mutationObserved(mutations)` → push 到 `newMutations`,首次触发时 `pending = true` + `requestAnimationFrame(processMutations)`
2. 同一帧内的所有 mutation 被合并
3. `processMutations` 用 `delay > 16*Nms` 的背压机制(EventLoop 忙时延后)处理调用
4. `flatFilterMutations` 把所有 mutation 摊平:
   - `addedNodes` → 收集(过 `shouldSkip` 滤掉 `head`/`script`/`style` 等)
   - `removedNodes` → 收集(若节点同时在 addedNodes 里,改放到 `removedAddedNodes`,相当于撤销)
5. `contentMutated({ addedNodes, removedNodes })`:
   - `applySelectors()`:对新增的 `[data-iframe-size]` / `[data-iframe-ignore]` 应用属性
   - `checkOverflow()`:重新计算溢出标记
   - `addObservers(addedNodes)` / `removeObservers(removedNodes)`:**对新元素挂/卸 observer**
6. `sendSize(MUTATION_OBSERVER, 'Mutation Observed')` → 通知父页面

### 4.2 `ResizeObserver` (box 变化)

`packages/child/observers/resize.js:50-69`:
```js
export default (callback) => {
  observer = new ResizeObserver(callback)
  observer.observe(document.body)             // 永远观察 body
  observed.add(document.body)

  return {
    attachObserverToNonStaticElements,
    detachObservers: createDetachObservers(RESIZE, observer, observed, …),
    disconnect: () => observer.disconnect(),
  }
}
```

`attachObserverToNonStaticElements(nodeList)` (line 22-48):
- 跳过 `position: static` 元素 —— **它们不影响 body 大小**
- 用 `observed: WeakSet` 防止重复挂
- 给新元素 observer,记 `newlyObserved: Set`,打日志

回调 `resizeObserved` (line 1037-1041) 只处理第一条 entry(浏览器有去重优化),`sendSize(RESIZE_OBSERVER, …)`。

### 4.3 `IntersectionObserver` × 2

**溢出检测** `packages/child/observers/overflow.js:22-94`:
```js
const observer = new IntersectionObserver(observation, {
  root: document.documentElement,
  rootMargin: '0px',
  threshold: 1,
})

function observation(entries) {
  for (const entry of entries) {
    const { boundingClientRect, rootBounds, target } = entry
    if (!rootBounds) continue
    const edge = boundingClientRect[side]                        // 'bottom' or 'right'
    const hasOverflow = isOverflowed(edge, rootBounds) && !isHidden(target)
    setOverflow(target, hasOverflow)                              // 切换 data-iframe-overflowed
  }
  afterReflow(emitOverflowDetected)                               // rAF 后再触发,等 layout 稳定
}
```

**根** = `documentElement`,**threshold = 1** = 完全可见才不算溢出。任何元素的 `bottom` 超过 `<html>` 高度时打 `data-iframe-overflowed="true"`,供 `getAutoSize` 的"case 10: hasOverflow"分支用。

**可见性** `packages/child/observers/visibility.js:5-24`:
```js
const observer = new IntersectionObserver(
  (entries) => callback(entries.at(-1).isIntersecting),
  { threshold: 0 },
)
observer.observe(document.documentElement)
```

**根** = viewport,**threshold = 0** = 任何像素可见。tab 切到后台 → 整个 `<html>` 不可见 → `isHidden = true` → `sendSize` 时主动 skip,避免无意义计算。

### 4.4 `PerformanceObserver` (性能自检)

`packages/child/observers/perf.js:78-114`:
```js
function perfObserver(list) {
  list.getEntries().forEach((entry) => {
    if (entry.name !== PREF_END) return
    const { duration } = performance.measure(PREF_MEASURE, PREF_START, PREF_END)
    detail = entry.detail
    timings.push(duration)
    if (timings.length > MAX_SAMPLES) timings.shift()
  })
}

export default function createPerformanceObserver() {
  const observer = new PerformanceObserver(perfObserver)
  observer.observe({ entryTypes: ['mark'] })
  startTimingCheck()
  ...
}
```

`getMaxElement` (line 1127-1168) 是"遍历所有元素算 max bottom"的 O(n) 函数,开头和结尾各打一个 `performance.mark`:
```js
performance.mark(PREF_START)
// ... 遍历 ...
performance.mark(PREF_END, {
  detail: { hasTags, len: targetElements.length, logging, Side },
})
```

5 秒 (`PERF_CHECK_INTERVAL = 5 * SECOND`) 跑一次 `startTimingCheck`:
- 至少 10 个样本
- `hasTags` 且 `len < 25` 不告警(因为不遍历)
- 中位数 / 均值 / 最大值
- **均值 > 4ms** 弹 `advise`:建议加 `data-iframe-size` 锚点,避免 O(n) 遍历

这是**"让代码告诉用户怎么优化代码"** 的典范。

### 4.5 帧合并 + 互斥锁

`packages/child/index.js:1447-1506` `sendSize`:
```js
let sendPending = false
let rafId

const sendSize = errorBoundary((triggerEvent, triggerEventDesc, customH, customW, msg) => {
  switch (true) {
    case isHidden === true: break
    case sendPending === true && triggerEvent !== OVERFLOW_OBSERVER:  // 同一帧内多次触发,合并
      purge(); log('Resize already pending - Ignored resize request')
      break
    case !autoResize && !(triggerEvent in IGNORE_DISABLE_RESIZE):    // 关闭自动 resize
      info('Resizing disabled')
      break
    default:
      sendPending = true
      if (!rafId)
        rafId = requestAnimationFrame(() => {
          sendPending = false                                  // 帧末清零
          rafId = null
        })
      sizeIframe(triggerEvent, triggerEventDesc, customH, customW, msg)
  }
})
```

`triggerLocked` (`packages/child/index.js:1508-1520`) 是个更粗的锁 —— `resetIframe` 时用,持续**一帧**,防止"算尺寸 → 发 → 父改 style → 触发 ResizeObserver → 又算 → 又发" 死循环。

---

## 5. 父端 `setSize` + 边界处理

`packages/core/index.js:846-858`:
```js
function setSize(messageData) {
  function setDimension(dimension) {
    const size = `${messageData[dimension]}px`
    messageData.iframe.style[dimension] = size
    info(id, `Set ${dimension}: ${size}`)
  }

  const { id } = messageData
  const { sizeHeight, sizeWidth } = settings[id]

  if (sizeHeight) setDimension(HEIGHT)
  if (sizeWidth) setDimension(WIDTH)
}
```

仅当 `sizeHeight` / `sizeWidth` 为 `true` 时才设 —— 通过 `direction: 'vertical' | 'horizontal' | 'both' | 'none'` 推导(见 `setDirection`,line 1173-1201)。

### 5.1 `box-sizing: border-box` 时的补偿

`packages/core/index.js:91-114`:
```js
function getPaddingEnds(compStyle) {
  if (compStyle.boxSizing !== 'border-box') return 0
  const top = compStyle.paddingTop ? parseInt(compStyle.paddingTop, 10) : 0
  const bot = compStyle.paddingBottom ? parseInt(compStyle.paddingBottom, 10) : 0
  return top + bot
}

function getBorderEnds(compStyle) {
  if (compStyle.boxSizing !== 'border-box') return 0
  const top = compStyle.borderTopWidth ? parseInt(compStyle.borderTopWidth, 10) : 0
  const bot = compStyle.borderBottomWidth ? parseInt(compStyle.borderBottomWidth, 10) : 0
  return top + bot
}
```

子页面发来的 height 是 **content-box 尺寸**,如果父页面 iframe 的 CSS 是 `box-sizing: border-box`,需要把 padding+border 加回去,否则 iframe 实际可视内容区会比子页内容小。

### 5.2 `tabVisible` 重同步

`packages/core/index.js:1370-1385`:
```js
const sendTriggerMsg = (eventName, event) =>
  Object.values(settings)
    .filter(({ autoResize, firstRun }) => autoResize && !firstRun)
    .forEach(({ iframe }) => trigger(eventName, event, iframe.id))

function tabVisible() {
  if (document.hidden === true) return
  sendTriggerMsg('tabVisible', RESIZE)
}
```

**从隐藏 tab 切回时,主动给所有 iframe 发一次 resize 请求** —— 因为隐藏期间浏览器会暂停很多 observer,内容尺寸可能已经变了。

---

## 6. 关闭 iframe 的状态机

`packages/core/index.js:777-798`:
```js
function closeIframe(iframe) {
  const { id } = iframe

  if (checkEvent(id, 'onBeforeClose', id) === false) {  // 回调返回 false 取消
    log(id, 'Close iframe cancelled by onBeforeClose')
    return
  }

  try {
    if (iframe.parentNode) {                            // 防止 React 卸载竞态
      iframe.remove()
    }
  } catch (error) {
    warn(id, error)
  }

  checkEvent(id, 'onAfterClose', id)                    // React 包覆盖: 返回 false 阻止 remove
  removeIframeListeners(iframe)                         // 删 settings[id], 清 iframe.iframeResizer
}
```

**两阶段回调**:
- `onBeforeClose`:返回 `false` 阻止关闭(可用于"未保存就关闭?")
- `onAfterClose`:清理完成通知

**React/Vue/Angular 包都强制让 `onBeforeClose` 返回 `false`**,因为这些框架**自己控制 DOM 卸载**,不能直接 `iframe.remove()`。这给上层一个提示:如果你想关闭 iframe,卸载组件即可。

---

## 7. 公开 API 协议 (子端 → 父端)

`packages/child/index.js:778-952` `parentIframe` 是个 frozen 对象,所有方法都通过 `sendMessage` 路由到父端执行,**不直接操作 iframe 元素**。

| 方法 | 实现的 type | 消息格式 | 父端处理 |
|---|---|---|---|
| `autoResize(bool)` | `ENABLE` / `AUTO_RESIZE` | `0:0:autoResizeEnabled:true` | `settings[id].autoResize = ...` |
| `close()` | `CLOSE` | `0:0:close` | `closeIframe()` |
| `getId()` | — | (本地) | 返回 `parentId` |
| `getParentOrigin()` | — | (本地) | 返回 `origin` |
| `getParentProps(cb)` | `PARENT_INFO` | `0:0:parentInfo` | 父端启动 `ResizeObserver` + scroll listener,持续 push |
| `moveToAnchor(hash)` | `inPageLink` | `0:0:inPageLink:#hash` | 父端 `findTarget` |
| `reset()` | `reset` | `0:0:reset` | 父端 `resetIframe` |
| `setOffsetSize(n)` | `setOffsetSize` | `H:W:setOffsetSize` | (但其实 `customH/customW` 直接传,见 sizeIframe) |
| `scrollBy/To/ToOffset(x,y)` | `scrollBy/scrollTo/scrollToOffset` | `y:x:scrollTo` (X/Y 故意反转) | `scrollBy` / `scrollTo` |
| `sendMessage(msg, origin?)` | `MESSAGE` | `0:0:message:<JSON>` | `on('onMessage', {iframe, message})` |
| `resize(h?, w?)` | `manualResize` | `H:W:manualResize:h,w` | `sizeIframe(customH, customW)` |
| `setHeight/WidthCalculationMethod` | — | (本地) | 直接重算 |

**X/Y 在 scroll 系消息里反转**,原因:消息体第一段是 `height`、第二段是 `width`,而 `scrollTo(x, y)` 第一个参数是 x。**为了不破坏协议字段顺序**,在 `sendMessage(y, x, SCROLL_TO)` 那一行明确注释:`// X&Y reversed at sendMessage uses height/width`。

---

## 8. License Mode 算法 — 整个仓库唯一混淆的文件

`packages/common/mode.js` 整个被混淆,核心是 `setMode(options)`:

### 8.1 解混淆后的逻辑

```js
// 实际代码(注解版)
const fnv1aHash = (str) => {                  // 4 行魔数算法
  let p = -559038744, y = 1103547984
  for (let z, t = 0; t < str.length; t++)
    (z = str.codePointAt(t),
     p = Math.imul(p ^ z, 2246822519),
     y = Math.imul(y ^ z, 3266489917))
  return (
    (p ^= Math.imul(p ^ (y >>> 15), 1935289751)),
    (y ^= Math.imul(y ^ (p >>> 15), 3405138345)),
    (p ^= y >>> 16), (y ^= p >>> 16),
    (2097152 * (y >>> 0) + (p >>> 11)).toString(36)
  )
}

const rot13_19 = (str) => str.replace(/[A-Za-z]/g, (c) => {
  const code = c.codePointAt(0) + 19
  return String.fromCodePoint(
    (c <= 'Z' ? 90 : 122) >= code ? code : code - 26
  )
})

// 解混淆后:
// x = ['license', 'key', 'expiry']
// z = ['GPLv3', 'live', 'test', 'expired', ...]   (mode 标签)
// y = [5 段付费提示文案]

const licenseOffsetTable = {
  '2cgs7fdf4xb': 0, '1c9ctcccr4z': 1, '1q2pc4eebgb': 2,
  'ueokt0969w': 3, 'w2zxchhgqz': 4, '1umuxblj2e5': 5,
  '2b5sdlfhbev': 6, 'zo4ui3arjo': 7, 'oclbb4thgl': 8,
}

export const getModeData = (i) => rot13_19(Y[i])
export const getModeLabel = (i) => rot13_19(Z[i])
export const getKey = (i) => rot13_19(X[i])

export default (options) => {
  const licenseStr = options[rot13_19(X[0])]     // options.license
                  || options[rot13_19(X[1])]     // options.key
                  || options[rot13_19(X[2])]     // options.expiry
  if (!licenseStr) return -1                       // 缺失 → -1 (试用)

  const [head, ...] = licenseStr.split('-')
  let v = (() => {
    let z = -2
    const u = fnv1aHash(rot13_19(head))
    return u in licenseOffsetTable && (z = licenseOffsetTable[u]), z > 4 ? z - 4 : z
  })()

  return 0 === v
      || ((p) => p[2] === fnv1aHash(p[0] + p[1]))(licenseStr.split('-'))
      ? (v = -2)  // 校验失败
      : v
}
```

### 8.2 mode 数字含义

| mode | 含义 | 行为 |
|---|---|---|
| 4+ | 商业 + 高级 | 隐藏所有 banner |
| 1, 2, 3 | 商业 | 部分功能解锁 |
| 0 | GPL 免费 | 静默 + `vInfo` 提示版本 |
| -1 | 试用 (无 key) | 启动期 banner |
| -2 | 过期 / 校验失败 | `purge()` 日志 + `throw` + 加载付费 modal |

### 8.3 怎么影响运行

`packages/core/index.js:966-982` `checkMode`:
```js
function checkMode(iframeId, childMode = -3) {
  if (vAdvised) return
  const mode = Math.max(settings[iframeId].mode, childMode)
  if (mode > settings[iframeId].mode) settings[iframeId].mode = mode
  if (mode < 0) {                            // 非法 key
    consoleClear(iframeId)
    if (!settings[iframeId].vAdvised)
      advise(iframeId || 'Parent', `${getModeData(mode + 2)}${getModeData(2)}`)
    settings[iframeId].vAdvised = true
    throw getModeData(mode + 2).replace(/<\/?[a-z][^>]*>|<\/>/gi, '')  // **抛错**
  }
  if (!(mode > 0 && vInfoDisable)) {
    vInfo(`v${VERSION} (${getModeLabel(mode)})`, mode)
  }
  if (mode < 1) advise('Parent', getModeData(3))
  vAdvised = true
}
```

`packages/child/index.js:626-637` 同样:
```js
if (mode < 0) {
  mode = Math.min(pMode, cMode)
  purge()
  advise(`${getModeData(mode + 2)}${getModeData(2)}`)
  if (isDef(version))
    throw getModeData(mode + 2).replace(/<\/?[a-z][^>]*>|<\/>/gi, '')
}
```

**两个抛错点都让 `errorBoundary` 接住,然后输出付费提示**。这是商业化 + 开源最干净的"半强制"模式。

---

## 9. 跨包架构 — core + 多 framework 适配

### 9.1 包依赖图

```
                      ┌──────────────────┐
                      │  @iframe-resizer/│
                      │     core         │ ← 业务核心 (~50KB gzip)
                      │   (default =     │
                      │ connectResizer)  │
                      └────────┬─────────┘
                               │ import
        ┌──────────┬────────────┼────────────┬─────────────┐
        ▼          ▼            ▼            ▼             ▼
   @parent     @child      @react       @angular       @jquery
   (UMD/ESM)   (IIFE)     (CJS/ESM)    (CommonJS)    (UMD/ESM)
   5.5 KB      13 KB       5.5 KB       ~1.5 KB       ~1 KB
```

- **child 端**:不需要 core,自包含(`packages/child/index.js` 不依赖 core)
- **core**:依赖 `auto-console-group`,不依赖任何包
- **parent**:依赖 core
- **react / angular / jquery / vue**:只依赖 core

### 9.2 `core` 的 export shape

`packages/core/index.js:984-1368`:
```js
export default (options) => (iframe) => { ... }
```

**柯里化设计**:
- 第一层 `(options) => (iframe)` —— factory 模式,每次 `iframeResize(options, target)` 都创建独立闭包
- 第二层 `(iframe) => { ... }` —— 实际 setup
- 返回 `iframe?.iframeResizer`(API 对象)

**为什么这样设计**:`factory.js` 接受 `target` 是 selector / HTMLElement / undefined,需要为这批 iframe 共用 `options`,所以先 `connectResizer(options)`,再对每个 iframe 调 `connectWithOptions(iframe)`。

### 9.3 React 包的关键 hack

`packages/react/index.jsx:17-24`:
```js
const onBeforeClose = () => {
  consoleGroup.event('close')
  consoleGroup.warn(
    `Close event ignored, to remove the iframe update your React component.`,
  )
  return false                    // ← 阻止父端真的 remove()
}
```

`packages/react/index.jsx:40-44`:
```js
return () => {
  consoleGroup.endAutoGroup()
  resizer?.disconnect()           // ← React 卸载时清理
}
```

**没有 forwardRef 支持**,注释里明写 "TODO: Add support for React.forwardRef() in next major version"。`useImperativeHandle` 暴露的 `getRef / getElement` 是临时方案。

### 9.4 Vue 包的双 consoleGroup

`packages/vue/iframe-resizer.vue:97-110`:
```js
mounted() {
  const connectWithOptions = connectResizer(options)
  self.resizer = connectWithOptions(iframe)

  const consoleGroup = createAutoConsoleGroup(consoleOptions)  // ← 第二个 console
  consoleGroup.event('setup')
  if ([COLLAPSE, EXPAND, true].includes(options.log)) {
    consoleGroup.log('Created Vue component')
  }
}
```

**为什么会两个 console**:core 内部会用 `auto-console-group` 创建一个(label 是 `vue(${id})`),Vue 包自己再创建一个 —— **有可能重复标签,日志会重叠**。这是 v5.5.9 的小问题。

---

## 10. 构建 & 发布链

### 10.1 Rollup 多入口

`rollup.config.mjs` 给 7 个包各生 3-4 种格式:

| 包 | 输出格式 | 文件 |
|---|---|---|
| `core` | UMD + ESM + CJS | `dist/core/index.{umd,esm,cjs}.js` |
| `parent` | UMD (浏览器) + ESM + CJS | `dist/parent/iframe-resizer.parent.{umd,esm,cjs}.js` |
| `child` | UMD (浏览器) + ESM + CJS | `dist/child/iframe-resizer.child.{umd,esm,cjs}.js` |
| `jquery` | ESM + CJS + UMD | `dist/jquery/...` |
| `react` | ESM + CJS | `dist/react/...` |
| `vue` | UMD + ESM + CJS | `dist/vue/...` |
| `legacy` | ESM + CJS + UMD × 2 + IIFE × 2 | `dist/legacy/{js,index.*}` |
| 额外 | IIFE | `js/iframe-resizer.{parent,child,jquery}.js` |

### 10.2 生产环境 strip 日志

`build/plugins.js:20-27`:
```js
export const pluginsBase = (stripLog) => (file) => {
  const delog = [strip({ functions: ['log', 'debug'] })]
  const log = [strip({ functions: ['purge'] })]
  const base = [versionInjector(vi), commonjs()]
  return stripLog ? delog.concat(base) : log.concat(base)
}
```

`strip` 是 `@rollup/plugin-strip`,**编译期把 `log()` / `debug()` / `purge()` 调用直接抹掉**。`BETA=1` 时不抹,方便调试。

`stripCode` (`build/plugins.js:79-82`) 通过注释标记删除代码:
```js
stripCode({
  start_comment: 'TEST CODE START',
  end_comment: 'TEST CODE END',
})
```

`packages/child/index.js:1772-1794` 的测试钩子:
```js
/* TEST CODE START */
function mockMsgListener(msgObject) {
  received(msgObject)
  return win
}

try {
  if (top?.document?.getElementById('banner')) {
    win = {}
    window.mockMsgListener = mockMsgListener
    removeEventListener(window, MESSAGE, received)
    define([], () => mockMsgListener)
  }
} catch (error) { /* do nothing */ }
/* TEST CODE END */
```

这段 Karma 测试钩子**生产环境被 strip 掉**。

### 10.3 发布流程

`bin/publish.sh:1-78`:

```bash
# 1. 校验版本号
if [[ $VERSION = *"-"* ]]; then
  if [ $1 = "latest" ]; then
    echo "Cannot publish a beta version as latest"
    exit 1
  fi
fi

# 2. 登录 npm
npm login

# 3. 拉最新代码
git stash && git pull && git stash pop

# 4. 全链路验证
npm install
npm test                                  # jest + rollup:test + karma
npm run build:$1                          # prod or beta

# 5. 按依赖顺序逐个 publish
cd dist/parent && npm publish --tag $1
cd ../child && npm publish --tag $1
cd ../core && npm publish --tag $1
cd ../jquery && npm publish --tag $1
cd ../react && npm publish --tag $1
cd ../vue && npm publish --tag $1
cd ../legacy && npm publish --tag $1

# 6. latest 时:打 zip, 同步给 docs 网站
if [ $1 = "latest" ]; then
  zip iframe-resizer.zip js/**
  git add . && git commit -am "Release v$VERSION"
  git tag "v$VERSION" && git push --tags
fi
```

**发布顺序按依赖反序**:`parent` / `child` / `core` / `jquery` / `react` / `vue` / `legacy`,这样 `parent` 不会先于 `core` 发布。

### 10.4 包级 external

每个包的 `peerDependencies` 通过 `fixVersion` (`build/plugins.js:29-46`) 注入:
```js
const fixVersion = (file) => {
  switch (file) {
    case 'core':
    case 'child':
      return {}                          // 无 peer
    case 'legacy':
      return {
        additionalDependencies: {
          '@iframe-resizer/child': pkg.version,
          '@iframe-resizer/jquery': pkg.version,
          '@iframe-resizer/parent': pkg.version,
        },
      }
    default:                              // parent / react / vue / angular
      return { additionalDependencies: { '@iframe-resizer/core': pkg.version } }
  }
}
```

`react` / `vue` 包同时声明 `peerDependencies: { react: '*', vue: '*' }`(`rollup.config.mjs:38-39` 删 react/vue deps,要求用户自备)。

---

## 11. 错误处理与防御式编程

### 11.1 用户回调隔离

`packages/common/utils.js:13-14`:
```js
export const isolateUserCode = (func, ...val) =>
  setTimeout(() => func(...val), 0)
```

**所有用户回调都用 `setTimeout(0)` 异步触发** —— 用户抛错只影响微任务,不污染主流程。

### 11.2 `errorBoundary`

`packages/core/console.js:62`:
```js
export const errorBoundary = output('errorBoundary')
```

来自 `auto-console-group`,**自动捕获内部错误并输出到 console**,不冒泡给宿主。

### 11.3 id 唯一性

`packages/core/unique.js:6-32`:
```js
export default function checkUniqueId(id) {
  if (shownDuplicateIdWarning[id] === true) return false
  const elements = document.querySelectorAll(`iframe#${CSS.escape(id)}`)
  if (elements.length <= 1) return true

  shownDuplicateIdWarning[id] = true
  // ... 警告
  return false
}
```

`CSS.escape` 处理 id 里的特殊字符(`.` `:` `#`)。重复 id 只警告一次(用 `shownDuplicateIdWarning` 缓存)。

### 11.4 Race condition

`packages/core/index.js:788-791`:
```js
try {
  if (iframe.parentNode) {            // React 卸载时可能 parentNode 已经是 null
    iframe.remove()
  }
} catch (error) {
  warn(id, error)
}
```

`packages/core/index.js:1057-1064`:
```js
function setupIframeObject() {
  if (settings[iframeId]) {
    const { iframe } = settings[iframeId]
    // ... 创建 resizer
  }
}
```

`packages/child/index.js:1135-1144`:
```js
const createInitChild = (eventType) => () => {
  if (!settings[id]) return             // iframe 已删除
  ...
  if (isInit(eventType) && isLazy(iframe)) warnOnNoResponse(id, settings)
  if (!firstRun) checkReset()
}
```

每个回调开头都 `if (!settings[id]) return`,**避免"iframe 已经被关掉,异步回调才到达"的竞态**。

### 11.5 SSR 容错

`packages/parent/factory.js:48-55`:
```js
if (typeof window === UNDEFINED) return []        // SSR 跳过
if (!document.body) {
  throw new TypeError(`${id}document.body is not available...`)
}
```

`packages/child/index.js:1797-1800`:
```js
if (typeof window !== UNDEFINED) {
  iframeResizerChild()
}
```

**child 端是 IIFE 自执行,在 Node 环境被 guard 掉**。

---

## 12. 测试分层

### 12.1 Jest (纯函数 + 业务逻辑)

| 文件 | 覆盖 |
|---|---|
| `core/timeout.test.js` | 9 case:warnOnNoResponse 所有边界 |
| `parent/factory.test.js` | 9 case:参数归一化、disconnected iframe 容错 |
| `common/utils.test.js` | 10 case:`isNumber/once/round/typeAssert/...` |
| `common/deprecate.test.js` | 3 case:deprecate 工厂 |
| `common/format-advise.test.js` | 3 case:Chrome / 非 Chrome / 空消息 |
| `common/filter-iframe-attribs.test.js` | 2 case:React 属性过滤 |
| `child/read.test.js` | 9 case:`read*` 工具 |
| `child/from-string.test.js` | 6 case:`getBoolean/getNumber` |

### 12.2 Karma + Jasmine (端到端 DOM 行为)

`spec/parentSpec.js` 4.6KB,`spec/childSpec.js` 14KB —— 真实 ChromeHeadless 跑,测:
- 初始化握手
- 鼠标进出事件
- 滚动同步
- 消息传递
- in-page 链接
- 重复 id 警告
- 异常初始化处理

### 12.3 Playwright (跨浏览器真机)

`e2e/` 跑 Chrome / Firefox / WebKit 真实浏览器。

### 12.4 测试覆盖盲区

`packages/child/index.js:1207-1298` `getAutoSize` 的 10+ 分支全靠 e2e,无单测 —— 见 `CODE_REVIEW.md` 章节 6 建议。

---

## 13. 关键代码片段地图(给二次开发的人)

如果你想改这块代码,这里列出所有"动了就影响全局"的关键位置:

| 关注点 | 文件 : 行 |
|---|---|
| **消息协议**(改这里要更新所有父/子) | `core/index.js:912-960` + `child/index.js:1540-1584` |
| **尺寸算法** | `child/index.js:1207-1298` |
| **观测器协调** | `child/index.js:1113-1125` |
| **同源/跨域判断** | `core/index.js:533-542` + `child/index.js:362-368` |
| **checkOrigin 校验** | `core/index.js:137-181` |
| **父→子触发器** | `core/index.js:866-910` |
| **子→父派发** | `core/index.js:573-675` |
| **状态机 settings[id]** | `core/index.js:984-1368` + `core/values/settings.js` |
| **默认值** | `core/values/defaults.js` |
| **公开常量** | `common/consts.js` |
| **License 模式** | `common/mode.js` (混淆) |
| **构建** | `rollup.config.mjs` + `build/*.js` |
| **发布** | `bin/publish.sh` |

---

## 14. 总结:它最难复制的 3 件事

1. **"协议字段顺序永远不变"的纪律** —— 5 年不破协议,deprecate 全走 `advise`
2. **观测器组合 + 帧合并 + 互斥锁** —— 5 个 Observer + `rAF` + `pending` + `triggerLocked`,从机制上保证不抖
3. **同源/跨域双通道用同一份消息** —— transport 可换,payload 不动

如果做类似产品,**不要先写代码,先抄这份 `getAutoSize` 的 case 列表** —— 它把"该用哪个尺寸"这件事拆成 10+ 个明确的判定,比任何单一 `scrollHeight` 方案都准。
