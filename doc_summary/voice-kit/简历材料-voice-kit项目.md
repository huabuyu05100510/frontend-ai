# 简历材料 · voice-kit 项目

> 针对14年前端专家定位，提供"项目卡片"和"技术亮点"两个版本

---

## 版本1：项目卡片（简历直接粘贴）

### 项目名称
**voice-kit — 跨端语音技术基建 SDK**（PC / H5 / 微信小程序三端通用）

### 项目角色
前端架构师 / 核心开发（独立设计）

### 项目简介
沉淀实时语音交互全场景的跨端技术基建，抽象出**可移植核心 + 可替换适配器 + 场景级状态机**三层架构。覆盖实时转写、实时对话、同声传译、关键词唤醒、VAD 端点检测、TTS 播放、声纹克隆、声音设计、离线文件转写、播客生成共 10 个语音场景。以 pnpm monorepo + Turbo 组织 30+ npm 包，全部公开发布。

### 技术栈
React 18 · TypeScript 5 · Vite · AudioWorklet · SharedArrayBuffer/Atomics · WASM（Speex/Opus/Silero VAD）· Socket.IO/WebSocket · OpenTelemetry · IndexedDB · Web Worker · pnpm Workspace + Turbo · Vitest + fast-check + Playwright

### 核心技术亮点（6 条，按杀伤力排序）

1. **设计 `responseId` 门控的 Barge-in 状态机**，跨"队列/解码/播放"三阶段原子中断，配合 `TLA+` 形式化规约证明 `interrupt()` 完成后无陈旧音频泄漏，解决实时对话中"打断后仍播放上一句尾巴"的经典竞态。

2. **首创 `chunk_id → RTT` 回显观测协议 + HDR Histogram**：客户端在 AudioWorklet 帧边界打单调 id，服务端 ack 回传，对数线性桶 3 位有效数字无损 p99，经 OpenTelemetry 导出，p99 误差 ≤1%（替代传统"滑动窗口估算 p99"的统计学伪命题）。

3. **AudioWorklet + SharedArrayBuffer 零拷贝环形缓冲**：用 `Atomics.wait/notify` 在独立索引 SAB 上同步，主线程 100% 负载下仍稳定 20ms 帧节奏；无跨域隔离环境自动降级 `MessagePort` 拷贝路径。

4. **流式 ASR 四路径去重 Reducer**（514 行纯函数）：处理累积/增量/混合三种引擎模式的乱序 partial 与终结后修正，`normalizeForCompare` 标点归一化前缀比对，djb2 哈希稳定说话人着色；以 `fast-check` 属性测试验证幂等性与去重收敛。

5. **时间调度的 AudioContext 播放队列**：`AudioBufferSourceNode.start(atTime)` + 漂移补偿（`nextStartTime = max(ctx.currentTime + ε, lastEnd)`），暴露 `getScheduledEndTime` 供上层决策解麦时机，根治 TTS 流式播放的咔哒声与间隙。

6. **三端跨端抽象**：通过 `IAudioCapture / IAudioPlayer / ITransport / IStorage` 接口契约 + 依赖注入工厂模式，让同一套场景状态机在浏览器（AudioWorklet）、微信小程序（RecorderManager + WXWebAssembly）、Electron 三端零修改复用，包体积按场景拆分（核心 reducer ≤6KB gzip，全对话场景 ≤45KB gzip）。

### 项目数据
- 30+ npm 包（`@voice-kit/*` scope 公开发布）
- 180+ 单元测试 + fast-check 属性测试 + 黄金 fixture 测试 + Playwright e2e
- 核心包覆盖率 ≥90%
- 支持 10 个语音场景，3 端运行

---

## 版本2：技术亮点展开（面试详细说）

### 亮点1：Barge-in 竞态消除

**问题**：用户打断 AI 时，正在排队的 AI 音频块 + 在途解码块 + 当前播放块三层都会泄漏旧音频尾巴。现有方案 `stopPlayback()` 只能切当前块。

**方案**：每个播放块携带 `responseId`（单调自增）。`interrupt()` 四步原子操作：
1. `currentResponseId++`
2. 丢弃队列中所有 `chunk.responseId < current` 的块
3. `AudioBufferSourceNode.stop(currentTime)`
4. 等 `onended` 触发 + 解码队列空才 emit `barge-in-complete`

**形式化**：附 TLA+ 规约 `converse.tla`，模型检验证明 `interrupt` 完成后不存在 `responseId < current` 的播放事件。

**备选**：曾考虑用 `AbortController` + Promise 取消，但 `AudioBufferSourceNode` 不支持取消已调度 start，只能 stop。

**简历一句话**：设计responseId门控的Barge-in状态机，跨三阶段原子中断，TLA+证明无陈旧音频泄漏。

---

### 亮点2：chunk_id RTT + HDR Histogram

**问题**：传统前端延迟监控用"send 时间戳队列 FIFO 弹出对应响应"，但流式 ASR 的 partial 和 chunk 不是 1:1，算出来是垃圾数据；滑动窗口 200 样本估 p99 方差极大。

**方案**：
- 客户端在 Worklet 帧边界打 `{chunkId, captureTsMono}`，随 PCM 帧上行
- 服务端在 ack 中回传 `chunkId`，客户端 `rttMs = mono() - captureMap.get(chunkId)` 精确到单帧
- 入 HDR Histogram（对数线性桶，3 位有效数字），任何样本量下 p99 误差 ≤1%
- 通过 OTel Metrics SDK 导出 `voice.transport.rtt_ms`，Prometheus 可查

**备选**：t-digest（Cron job 友好但合并语义复杂）；P50/P95/P99 三计数器（信息丢失）。

**简历一句话**：首创chunk_id RTT回显协议+HDR Histogram，p99误差≤1%，替代滑动窗口估算的统计学伪命题。

---

### 亮点3：AudioWorklet SAB 零拷贝

**问题**：`postMessage(transferable)` 每帧拷贝控制结构 + 事件调度开销，弱设备主线程抖动会丢帧。

**方案**：
- 双 SAB：`dataSAB`（环形 PCM 缓冲，4 通道 Int16）+ `indexSAB`（写指针 + 读指针 Int32）
- Worklet 写完一帧后 `Atomics.notify(indexSAB, READERS_SLOT)`
- 主线程 `Atomics.wait` 醒来后零拷贝读 `dataSAB` 视图
- 配 `crossOriginIsolated` COOP/COEP 头启用 SAB

**降级**：无 SAB（iOS Safari 未配置跨域隔离）自动回退 `MessagePort.postMessage(Int16Array)`，仍基于 Worklet（不用废弃的 ScriptProcessorNode）。

**为何不直接 SharedArrayBuffer 单 SAB**：写指针与数据混在一起会有伪共享；分离索引 SAB 让读写路径无依赖。

**简历一句话**：AudioWorklet+SAB零拷贝环形缓冲，Atomics同步，主线程100%负载下稳定20ms帧。

---

### 亮点4：流式 ASR 四路径去重

**问题**：火山引擎 bigmodel 累积模式每帧重发完整文本（带变更的标点），简单按 text 替换会导致闪烁、回滚；终结后再修正又会导致重复卡片。

**方案**：Reducer 按 `(speakerId, definite)` 分组，进入四分支分类器：
- **A 路径·文本扩展**：新文本是旧文本前缀扩展 → 增量更新
- **B 路径·回滚跳过**：新文本是旧文本的子串 → 跳过
- **C 路径·70% 前缀重叠**：`normalizeForCompare` 剥标点后 ≥70% 前缀匹配 → 续接
- **D 路径·新卡片**：以上都不满足 → 新建 utterance

`mergeConsecutiveSameSpeaker` 基于时间间隙（<1500ms）合并；djb2 哈希稳定着色避免重渲染。

**属性测试**：fast-check 生成任意 partial/final 交错序列，断言：(a) 同输入两次应用状态相同；(b) 最终文本与重排后应用相同。

**简历一句话**：流式ASR四路径去重Reducer（514行纯函数），fast-check属性测试验证幂等。

---

### 亮点5：时间调度播放队列

**问题**：`src.start()` 无参数 = "now"，相邻块之间出现微间隙；CPU 抖动时累积漂移。

**方案**：
```ts
const start = Math.max(ctx.currentTime + SAFETY_EPSILON, nextStartTime);
src.start(start);
nextStartTime = start + buffer.duration;
```
暴露 `getScheduledEndTime(responseId)` 给场景层，决定何时解除静麦（避免回声）。

**漂移补偿**：当 `ctx.currentTime > nextStartTime`（调度落后）时跳过该块并打 `voice.playback.gap_ms` 直方图。

**简历一句话**：时间调度AudioContext播放队列，漂移补偿，根治TTS流式播放咔哒声。

---

### 亮点6：跨端抽象与依赖注入

**问题**：浏览器、微信小程序、Electron 的采集/播放/存储 API 完全异构（AudioWorklet vs RecorderManager vs desktopCapturer），但状态机和协议完全相同。

**方案**：定义 6 个核心接口（IAudioCapture / IAudioPlayer / ITransport / IStorage / IClock / IResampler），场景包通过 `create<Scene>(deps)` 工厂接收实现：
```ts
// 浏览器
createTranscribeScene({capture: WebAudioCapture, transport: SocketIOTransport, ...});
// 微信小程序
createTranscribeScene({capture: WxRecorderCapture, transport: WxWebSocketTransport, ...});
```
状态机、Reducer、协议编解码三套核心 100% 复用；适配器是唯一需要按端重写的层。

**包体积**：场景按需引用，核心 reducer ≤6KB gzip；全对话场景在 web 上 ≤45KB gzip（不含懒加载 WASM）。

**简历一句话**：三端跨端抽象，接口契约+依赖注入，同一套状态机零修改复用。

---

## 版本3：量化数据（简历必填）

| 指标 | 数据 |
|------|------|
| npm包数量 | 30+ |
| 测试覆盖 | 180+ 单元测试 + 属性测试 + E2E |
| 核心覆盖率 | ≥90% |
| 支持场景 | 10个语音场景 |
| 支持平台 | 3端（Web/小程序/Electron） |
| 核心包体积 | ≤6KB gzip（reducer） |
| 全场景体积 | ≤45KB gzip（对话） |
| p99误差 | ≤1%（HDR Histogram） |
| 帧稳定性 | 20ms帧节奏（主线程100%负载） |

---

## 版本4：与14年专家定位契合点

| 资深特征 | 本项目体现 |
|---|---|
| **系统级而非页面级思维** | 协议编解码、状态机、跨端架构、可观测体系 |
| **形式化方法** | TLA+ 规约、fast-check 属性测试 |
| **底层 API 深度** | AudioWorklet、SharedArrayBuffer/Atomics、WebAssembly 内存模型 |
| **性能工程** | HDR Histogram、零拷贝、自适应码率、包体积预算 |
| **领域纵深** | 不是"会做语音功能"，而是"懂语音交互的脏活"（去重、竞态、调度、恢复） |
| **工程化** | 30+ 包 monorepo、changesets、Turbo 远程缓存、size-limit CI |

---

## 版本5：面试陈述示例（1分钟电梯演讲）

> "voice-kit 是我把多年语音前端经验沉淀成的跨端 SDK——把实时对话的 Barge-in 竞态、流式 ASR 的乱序去重、端到端延迟观测这些'每个语音应用都要重写一遍的脏活'，做成可移植的核心包加可替换的端适配器，让浏览器、微信小程序、Electron 三端共用同一套状态机。30+ npm 包公开发布，附 TLA+ 形式化规约和 fast-check 属性测试。"

---

## 版本6：面试追问应对

**Q: 你说Barge-in竞态消除，具体怎么做的？**

> "这个问题本质是三层队列的原子中断——等待队列、解码队列、播放队列。我的方案是用 responseId 做门控：
> 
> 第一，每个播放块携带 responseId，interrupt() 时自增 currentResponseId；
> 
> 第二，enqueue 时检查，陈旧块直接丢弃；
> 
> 第三，AudioBufferSourceNode.stop() 停止当前播放；
> 
> 最后，等 onended 触发才 emit barge-in-complete。
> 
> 我还写了 TLA+ 形式化规约，模型检验证明 interrupt 完成后不存在陈旧播放事件。"

**Q: 为什么不用 AbortController？**

> "AudioBufferSourceNode 不支持取消已调度的 start()，只能 stop()。AbortController 适合 Promise 链，但音频播放不在 Promise 链上——它是事件驱动的。"

**Q: HDR Histogram 为什么比滑动窗口好？**

> "滑动窗口估算 p99 有两个问题：
> 
> 第一，样本量固定200个，窗口外的历史数据丢失；
> 
> 第二，方差极大，不同窗口算出来的 p99 可能差一倍。
> 
> HDR Histogram 用对数线性桶，保留所有样本的分布信息，任何样本量下 p99 误差都 ≤1%。而且它支持合并，多客户端数据可以在服务端聚合。"

---

## 使用建议

1. **简历项目经历**：粘贴"版本1：项目卡片"
2. **面试准备**：熟读"版本2：技术亮点展开"
3. **自我介绍**：背诵"版本5：电梯演讲"
4. **追问应对**：理解"版本6：面试追问"的逻辑

---

**核心原则：简历写结论，面试讲过程。**
