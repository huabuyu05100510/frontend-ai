# 技术架构与时序图 · Markdown 流式对话 Demo

> 与代码实现一一对应。Mermaid 图，IDE / GitHub 直接渲染。
> 对应方案文档：`../A2UI-最佳实践与架构方案.md` §6.6。

---

## 1. 分层架构

```mermaid
flowchart TB
  subgraph UI["UI 层 (React 18)"]
    App["App<br/>编排/会话流转/对比"]
    Hist["HistorySidebar<br/>历史会话"]
    Chat["ChatView<br/>自动跟随滚动/输入/思考态"]
    Msg["Message<br/>已完成气泡(整体记忆化)"]
    Perf["PerfPanel<br/>指标+控制+对比"]
  end

  subgraph Render["渲染引擎 (流式 + 记忆化)"]
    SM["StreamingMarkdown<br/>块级调度"]
    MB["MarkdownBlock(memo)<br/>仅尾块重渲"]
    MD["miniMarkdown<br/>零依赖 MD→React"]
    Blk["blocks<br/>splitBlocks/autoClose/cyrb53"]
    Code["CodeBlock + highlight"]
    Card["CardRenderer<br/>amap/weather/product/stat/card"]
  end

  subgraph State["状态层 (External Store + useSyncExternalStore)"]
    CS["chatStore<br/>会话/轮次/localStorage"]
    SB["streamBuffer<br/>streamAppend 累积"]
    PS["perfStore<br/>TTFC/FPS/提交/渲染耗时"]
  end

  subgraph Engine["流式引擎 / 数据源"]
    SR["StreamRunner<br/>token 级节奏推送"]
    RP["responder<br/>离线意图应答(可换真实后端)"]
  end

  App --> Hist & Chat & Perf
  Chat --> Msg
  Chat --> SM
  Msg --> MD
  SM --> MB --> MD
  SM --> Blk
  MD --> Code & Card

  App -->|addTurn| CS
  App -->|start/stop| SR
  App -->|respond| RP
  SR -->|append delta| SB
  SR -->|beginRun/markChars/endRun| PS
  Chat -. Profiler onRender .-> PS

  Hist <-->|subscribe| CS
  Chat <-->|subscribe| CS
  Chat <-->|subscribe| SB
  Perf <-->|subscribe| PS
  SM  <-->|subscribe| SB

  classDef store fill:#eef5ff,stroke:#9cc3f5;
  class CS,SB,PS store;
```

要点：
- 三个 **External Store**（`chatStore` / `streamBuffer` / `perfStore`）是单一事实来源，UI 通过 `useSyncExternalStore` 订阅，天然并发安全。
- `responder` 是**接真实后端的接缝点**：换成 SSE / `streamAppend` 服务端流即可，渲染/记忆化/历史/滚动逻辑全部不变。

---

## 2. 渲染数据流（流式 → 像素）

```mermaid
flowchart LR
  A["delta 文本块"] -->|append| SB[(streamBuffer)]
  SB -->|version++ 通知| SM[StreamingMarkdown]
  SM -->|splitBlocks 围栏感知切块| BL["Block[]<br/>{text, hash, closed}"]
  BL -->|key=hash, memo| MB[MarkdownBlock]
  MB -->|尾块 autoClose 虚拟补全| MD[miniMarkdown]
  MD --> H{块类型?}
  H -->|标题/段落/列表/表格/引用| DOM[React 元素]
  H -->|围栏 lang ∈ 卡片| Card[CardRenderer]
  H -->|围栏 其他| Code[CodeBlock+highlight]
  Card --> DOM
  Code --> DOM

  n1["完成块 hash 稳定 → memo 命中 → 零重渲<br/>仅最后一块随 delta 重渲"]
  MB -.- n1
```

---

## 3. 时序图：一次多轮对话（发送 → 流式 → 落库）

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant Chat as ChatView
  participant App as App
  participant CS as chatStore
  participant RP as responder
  participant SR as StreamRunner
  participant SB as streamBuffer
  participant PS as perfStore
  participant SM as StreamingMarkdown

  U->>Chat: 输入并回车
  Chat->>App: onSend(text)
  App->>CS: addTurn('user', text)
  CS-->>Chat: 通知(新用户气泡)
  App->>RP: respond(text, turnIndex)
  RP-->>App: target(Markdown)
  App->>PS: setMode + beginRun (TTFC 计时开始)
  App->>SR: start(target, speed)
  App-->>Chat: streaming=true (显示「思考中…」)

  loop 每帧 (intervalMs)
    SR->>SB: append(delta)
    SR->>PS: markChars
    SB-->>SM: version++ → 仅尾块重渲
    Note over Chat: useLayoutEffect 绘制前贴底跟随
    SM-->>PS: Profiler onRender(actualDuration)
    SB-->>PS: rAF 采样 FPS
  end

  SR-->>App: onDone
  App->>CS: addTurn('assistant', target)  (写入历史/localStorage)
  App->>SB: reset()
  App->>PS: endRun (归档 TTFC/时长/FPS)
  App-->>Chat: streaming=false
  CS-->>Chat: 通知(渲染最终气泡 Message)
```

---

## 4. 时序图：块级记忆化（为何流式不卡）

```mermaid
sequenceDiagram
  autonumber
  participant SB as streamBuffer
  participant SM as StreamingMarkdown
  participant SP as splitBlocks
  participant B1 as 完成块#1(memo)
  participant Bn as 尾块#n(memo)

  Note over SB,Bn: 文本已含 N-1 个完成块 + 1 个增长中的尾块
  SB->>SM: version++ (新 delta)
  SM->>SP: splitBlocks(content)
  SP-->>SM: Block[] (前 N-1 块 hash 不变, 尾块 hash 变)
  SM->>B1: props.hash 未变
  B1-->>SM: memo 命中 → 跳过渲染 (0ms)
  SM->>Bn: props.hash 变 + streaming=true
  Bn->>Bn: autoClose(尾块) → miniMarkdown 渲染
  Bn-->>SM: 仅此块产生 DOM 变更
  Note over B1,Bn: 累计渲染耗时 ≈ 单块成本，与文档长度无关
```

---

## 5. 时序图：从历史进入（瞬时定位底部，无滑动动画）

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant Hist as HistorySidebar
  participant CS as chatStore
  participant Chat as ChatView
  participant DOM as 滚动容器

  U->>Hist: 点击某历史会话
  Hist->>CS: switchSession(id)
  CS-->>Chat: currentId 变化 → 重渲该会话全部气泡
  rect rgb(235,245,255)
    Note over Chat,DOM: useLayoutEffect (浏览器绘制前执行)
    Chat->>DOM: scrollTop = scrollHeight (瞬时, 无 smooth)
  end
  DOM-->>U: 首帧即在底部 (看不到滚动过程)
```

对比修复前：用 `useEffect`(绘制后) + CSS `scroll-behavior:smooth` → 先画在顶部再平滑滚下去（可见滑动）。
修复后：`useLayoutEffect` 绘制前定位 + 去除 smooth → 首帧直达底部。

---

## 6. 时序图：性能对比（记忆化 vs 朴素）

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant Perf as PerfPanel
  participant App as App
  participant PS as perfStore
  participant SR as StreamRunner

  U->>Perf: 点「跑对比」
  Perf->>App: onCompare()
  App->>App: 取上一条 assistant 内容
  App->>PS: clearRuns()
  App->>App: setMode('memoized')
  App->>SR: start(last, speed)  (commit=false, 不入历史)
  SR-->>PS: 采集本轮 → endRun 归档 run[memoized]
  App->>App: setMode('naive')
  App->>SR: start(last, speed)
  SR-->>PS: 采集本轮 → endRun 归档 run[naive]
  PS-->>Perf: lastRuns=[memoized, naive]
  Perf-->>U: 对比表(累计渲染/最大单帧/FPS/掉帧 + 提升倍数)
```

---

## 7. 状态模型

```mermaid
classDiagram
  class Session {
    id: string
    title: string
    turns: Turn[]
    updatedAt: number
  }
  class Turn {
    id: string
    role: string
    content: string
    ts: number
  }
  class ChatStore {
    sessions: Session[]
    currentId: string
    newSession()
    switchSession(id)
    addTurn(role, content)
    +localStorage 持久化
  }
  class StreamBuffer {
    text: string
    version: number
    append(delta)
    reset()
  }
  class PerfStore {
    ttfcMs / durationMs / fps
    commits / totalRenderMs / maxFrameMs
    blockRenders / jankFrames
    lastRuns: PerfRun[]
  }
  ChatStore "1" o-- "*" Session
  Session "1" o-- "*" Turn
```

---

## 8. 对接真实 A2UI / LLM（演进路径）

```mermaid
flowchart LR
  subgraph 当前Demo
    RP1[responder 离线应答] --> SR1[StreamRunner setTimeout 节奏]
  end
  subgraph 生产
    LLM[LLM/Agent] -->|SSE event: a2ui| GW[SSE 网关]
    GW -->|streamAppend delta| SB2[(streamBuffer)]
  end
  RP1 -.替换.-> LLM
  SR1 -.替换.-> GW
  SB2 --> 同一套渲染引擎/记忆化/滚动
```

> 关键：流式渲染引擎、块级记忆化、历史、滚动策略与数据源解耦。把 `responder + StreamRunner` 换成 `SSE 网关 + streamAppend`，前端零改动。

---

## 9. 增量内核（B 级）· 类图

> 对应 `spec.md` / `plan.md`。`StreamingMarkdown` 按 `mode` 分发：`incremental` → `IncrementalMarkdown`（本节），`memoized/naive` → `ClassicMarkdown`（§2）。
> 内核 `src/imd/` **框架无关、零依赖**，由 34 个 vitest 用例守护（含「流式==原子」property 测试）。

```mermaid
classDiagram
  class Segment {
    id: number
    kind: BlockKind
    text: string
    hash: string
    status: final|active
    lang?: string
  }
  class IncrementalSegmenter {
    -finalized: Segment[]
    -buffer: string
    -nextId: number
    -snapshot: Map
    push(delta) : void
    end() : void
    getSegments() : Segment[]
    drainDirty() : ChangeSet
    reset() : void
  }
  class classify {
    classify(text) BlockKind+lang
  }
  class speculativeClose {
    close(text) string
  }
  class IncrementalMarkdown {
    喂 delta 给内核
    final→VirtualBlock 记忆化冻结
    active→speculativeClose 渲染
  }
  IncrementalSegmenter "1" o-- "*" Segment
  IncrementalSegmenter ..> classify : 块类型
  IncrementalMarkdown ..> IncrementalSegmenter : push/getSegments
  IncrementalMarkdown ..> speculativeClose : 尾块渲染前闭合
```

不变式：① final 段 id/hash 跨 push 稳定；② 至多 1 个 active；③ 围栏未闭合保持 active；④ 任意切片 `push`+`end` 结果 == 一次性解析。

---

## 10. 时序图：增量解析 + 投机闭合（O(尾块)）

```mermaid
sequenceDiagram
  autonumber
  participant SB as streamBuffer
  participant IM as IncrementalMarkdown
  participant SEG as IncrementalSegmenter
  participant FB as final 块(VirtualBlock+memo)
  participant AB as active 尾块

  Note over SB,AB: 已 finalize N-1 块，buffer 仅存尾块原文
  SB->>IM: version++ (新 delta)
  IM->>IM: delta = content.slice(prevLen) (只取新增)
  IM->>SEG: push(delta)
  SEG->>SEG: 仅扫描 buffer 尾部 → 边界则切出 final
  SEG-->>IM: getSegments() = 前缀 final + 末尾 active
  IM->>FB: id/hash 未变
  FB-->>IM: memo 命中 → 跳过 (0ms)
  IM->>AB: 渲染前 speculativeClose(尾块)
  AB->>AB: 半截 **粗体 / 链接 自动闭合 → 无闪烁
  AB-->>IM: 仅尾块产生 DOM 变更
  Note over SEG,AB: 解析与重渲成本 ≈ O(尾块)，与文档长度无关
```

对比记忆化（§4）：记忆化每 token 仍 `splitBlocks(全文)`（O(n) 字符串扫描）；增量内核只 `push(delta)`（O(尾块)）→ 长文档差距随块数放大。

---

## 11. 时序图：离屏块虚拟化（恒定 DOM）

```mermaid
sequenceDiagram
  autonumber
  actor U as 用户
  participant DOM as 滚动容器(.transcript)
  participant IO as IntersectionObserver(按根复用)
  participant VB as VirtualBlock(final)
  participant PS as perfStore

  Note over VB: 首次实体渲染并实测高度 heightRef
  U->>DOM: 向下滚动 / 流式自动贴底
  DOM->>IO: 块离开视口(±600px rootMargin)
  IO-->>VB: isIntersecting=false
  VB->>VB: 折叠为等高占位 div(height=heightRef)
  Note over DOM: scrollHeight 不变 → 不抖动、不破坏贴底
  U->>DOM: 反向滚回
  IO-->>VB: isIntersecting=true → 重新实体化
  loop rAF 采样
    PS->>DOM: 统计 .md-block 真实数量
    PS-->>PS: maxDom = 峰值常驻块
  end
```

效果：超长文档（160 节）流式时，**常驻块(DOM)** 保持恒定（可见区相关），而朴素/记忆化随文档线性增长。

---

## 12. 三模式对比（同一份内容 / 同一流速）

```mermaid
flowchart LR
  subgraph naive["朴素 naive"]
    N1["每 token 重解析全文"] --> N2["整篇重渲"]
  end
  subgraph memo["记忆化 memoized (A.5)"]
    M1["每 token splitBlocks 全文 O(n)"] --> M2["仅尾块重渲"]
  end
  subgraph inc["增量内核 incremental (B)"]
    I1["仅 push(delta) O(尾块)"] --> I2["完成块冻结 + 投机闭合"] --> I3["离屏虚拟化 恒定 DOM"]
  end
  naive -.->|"累计渲染 ↑↑ / 掉帧多 / DOM 线性"| R[(PerfPanel 对比表)]
  memo  -.->|"累计渲染 ↑ / DOM 线性"| R
  inc   -.->|"累计渲染 ↓ / 掉帧≈0 / DOM 恒定"| R
```

> 触发方式：发送「**超长文档压测（虚拟化）**」→ 生成 160 节长文（`samples/longDoc.ts`，模拟后端）；右侧面板「⚡ 跑对比」一次串跑三模式，对比 `累计渲染 / 最大单帧 / 平均FPS / 掉帧 / 常驻DOM块`。
