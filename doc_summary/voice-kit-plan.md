# voice-kit — 跨端语音技术基建设计方案

> 14 年前端专家 · 语音领域技术代表作
> 沉淀自 voice-portfolio，覆盖 PC / H5 / Taro 小程序三端语音场景

---

## 0. 定位与差异化

**不是**又一个音频包装器（LiveKit/Agora 已做得很好）。
**是**把 9 个语音场景中"难的那一层"沉淀成**可移植核心 + 可替换适配器 + 场景级状态机**：
- Barge-in 竞态消除状态机
- chunk_id RTT 回显协议
- 流式 ASR 四路径去重 Reducer
- 卡拉OK 词级二分对齐
- Volcengine v3/sauc 二进制协议编解码
- HDR Histogram 延迟观测

这些是通用 SDK 不解决、但每个语音应用都要重写一遍的"脏活累活"。

---

## 1. Monorepo 结构

**工具链**：pnpm workspace + Turbo + changesets + tsup + typedoc + vitest + fast-check + playwright

```
voice-kit/
├── pnpm-workspace.yaml
├── turbo.json
├── .changeset/
├── packages/
│   │
│   ├── 【L1 纯核心层】零平台依赖、零副作用，可直接跑在 Node/RN/小程序
│   │   ├── core-types/                @voice-kit/core-types          # 所有接口契约
│   │   ├── core-utils/                @voice-kit/core-utils          # SlidingWindow/percentile/djb2/binSearch
│   │   ├── core-protocol-volc-asr/    @voice-kit/protocol-volc-asr   # v3/sauc 二进制帧编解码
│   │   ├── core-protocol-volc-tts/    @voice-kit/protocol-volc-tts   # 事件 ID 帧编解码
│   │   ├── core-protocol-realtime/    @voice-kit/protocol-realtime   # OpenAI-Realtime 风格 JSON 事件
│   │   ├── core-reducer-transcription/                                # 514 行四路径去重（直接迁移）
│   │   ├── core-reducer-conversation/                                 # 355 行对话状态机
│   │   ├── core-reducer-translation/                                  # 255 行行对齐
│   │   ├── core-reducer-cloning/                                      # 克隆生命周期
│   │   ├── core-karaoke/                                              # 词级二分对齐（直接迁移）
│   │   ├── core-dsp/                  @voice-kit/dsp                 # RMS/AGC 钩子
│   │   ├── core-vad-energy/                                           # 能量+过零率 VAD（纯 JS）
│   │   ├── core-vad-silero/           (P2)                            # ONNX Silero VAD (WASM)
│   │   ├── core-wake-porcupine/       (P2)                            # Porcupine 关键词唤醒
│   │   ├── core-observability/                                        # OTel + HDR Histogram + chunk_id
│   │   └── core-transport-ws/                                         # 指数退避重连 + 会话恢复
│   │
│   ├── 【L2 适配器层】实现 core-types 接口
│   │   ├── adapter-web/               @voice-kit/adapter-web         # AudioWorklet + SAB + IndexedDB
│   │   ├── adapter-electron/          @voice-kit/adapter-electron    # 复用 web + IPC + 系统音频
│   │   ├── adapter-taro/              (P2 stub)                      # RecorderManager / wx.storage
│   │   ├── adapter-node/                                              # 测试 & 服务端转写 worker
│   │   └── adapter-mock/                                              # 单元测试确定性桩
│   │
│   ├── 【L3 场景层】编排 core + adapter 完成一个语音任务
│   │   ├── scene-transcribe/                                          # 实时转写（含说话人分离）
│   │   ├── scene-converse/                                            # 实时对话（Barge-in 王冠）
│   │   ├── scene-interpret/                                           # 同声传译
│   │   ├── scene-wake/                                                # 关键词唤醒 + VAD 联动
│   │   ├── scene-tts/                                                 # 时间调度 TTS 播放
│   │   ├── scene-clone/                                               # 声纹克隆
│   │   ├── scene-design/                                              # 声音设计
│   │   ├── scene-file-asr/                                            # 离线文件转写（Worker + IndexedDB 队列）
│   │   └── scene-podcast/                                             # 播客生成
│   │
│   ├── 【L4 框架绑定层】
│   │   ├── react/                     @voice-kit/react               # useTranscribe/useConverse/useTts...
│   │   ├── vue/                       (P2)                            # composables
│   │   └── taro/                      (P2)                            # 小程序组件绑定
│   │
│   ├── 【L5 UI 层】
│   │   ├── ui-headless/                                               # 无样式原语（Waveform/Karaoke/Caption）
│   │   └── ui-tailwind/                                               # 带主题版本
│   │
│   └── 【L6 研发支撑】
│       ├── testkit/                                                   # PCM fixtures + WS mock server
│       └── devtools/                                                  # 浏览器 DevTools 面板
│
└── apps/
    ├── playground-web/                Vite + React 全场景 demo
    ├── playground-h5/                 移动端优化（iOS Safari 兼容）
    ├── playground-electron/           桌面壳
    ├── playground-taro/               (P2) 微信小程序
    ├── bench/                         Node 基准（reducer 吞吐 / 重采样 MFLOPS）
    └── docs/                          Docusaurus 文档站
```

**包依赖规则**（`eslint-plugin-boundaries` 强制）：
- `core-*` 只能依赖 `core-*`，禁止任何 DOM/RN/wx 导入
- `adapter-*` 实现 `core-types`，可依赖任意 `core-*`
- `scene-*` 通过依赖注入消费 `adapter-*`，**永不直接 import**
- `react/vue` 是薄绑定，只暴露公共 API
- `ui-*` 只依赖 `react/vue` + `core-types`

**发布策略**：npm scope `@voice-kit/*`，全部公开；changesets 管版本；每包 ESM+CJS+types 三格式，`sideEffects:false` 可摇树。

---

## 2. 核心抽象（TypeScript 签名）

> 所有"流式"接口都用 **AsyncIterable（拉模式）** 而非回调，天然带背压。

```ts
// ============ IAudioCapture ============
interface AudioFormat {
  sampleRate: 8000|16000|24000|44100|48000;
  channels: 1|2;
  encoding: 'pcm-s16le'|'pcm-f32le'|'opus'|'mp3';
}
interface AudioChunk {
  data: ArrayBuffer;          // Int16 PCM
  chunkId: number;            // 单调递增，用于 chunk_id RTT 回显
  captureTsMono: number;      // 首样本的 performance.now()
  durationMs: number;
  isSpeech?: boolean;         // 内联 VAD 填充
  rms?: number;
}
interface IAudioCapture {
  readonly format: AudioFormat;
  start(opts?: {deviceId?: string; constraints?: Partial<MediaTrackConstraints>}): Promise<void>;
  stop(): Promise<void>;
  chunks(): AsyncIterable<AudioChunk>;
  onDeviceChange(cb: (d: MediaDeviceInfo[]) => void): () => void;
  getStats(): CaptureStats;   // 丢帧数、缓冲高水位
}

// ============ IAudioPlayer（带时间调度） ============
interface PlaybackChunk {
  data: ArrayBuffer;
  responseId: string;         // Barge-in 门控键
  seq: number;                // 同 responseId 内单调，允许乱序
  format: AudioFormat;
  isFinal?: boolean;
}
interface IAudioPlayer {
  enqueue(c: PlaybackChunk): void;
  interrupt(responseId?: string): void;          // 切当前 + 丢弃该 id 排队块
  flush(responseId: string): Promise<void>;       // 等待播完
  getScheduledEndTime(responseId: string): number|null;  // 决定何时解麦
  onEnded(cb: (responseId: string) => void): () => void;
  getStats(): PlayerStats;                        // 欠载、间隙 ms、调度漂移
}

// ============ ITransport（带重连+恢复+背压） ============
interface ITransport {
  connect(url: string, opts?: TransportOptions): Promise<void>;
  send(msg: {kind:'text'|'binary'; data: string|ArrayBuffer}): void;
  messages(): AsyncIterable<{kind:'text'|'binary'; data: string|ArrayBuffer}>;
  state(): 'idle'|'connecting'|'open'|'reconnecting'|'closed';
  onStateChange(cb: (s: TransportState) => void): () => void;
  resumeToken(): string|null;
  close(code?: number, reason?: string): void;
}
interface TransportOptions {
  reconnect?: {
    strategy: 'jittered-exponential';
    baseMs: number; maxMs: number; maxAttempts?: number;
  };
  heartbeatMs?: number;
  backpressure?: {
    highWaterBytes: number; lowWaterBytes: number;
    onPressure: (paused: boolean) => void;
  };
}

// ============ IStorage ============
interface IStorage {
  get<T>(k: string): Promise<T|null>;
  set<T>(k: string, v: T): Promise<void>;
  remove(k: string): Promise<void>;
  putBlob(k: string, b: Blob|ArrayBuffer, meta?: Record<string, unknown>): Promise<string>;
  getBlob(k: string): Promise<Blob|null>;
  iterate<T>(prefix: string): AsyncIterable<[string, T]>;
}

// ============ IClock ============
interface IClock {
  now(): number;                                  // wall clock ms
  mono(): number;                                 // performance.now() 单调
  scheduleAt(monoTs: number, cb: () => void): () => void;
}

// ============ IResampler ============
interface IResampler {
  readonly inRate: number; readonly outRate: number;
  process(inPcmF32: Float32Array): Float32Array;  // 保相位
  reset(): void;
}
// 实现：LinearResampler(回退) / PolyphaseSincResampler(Kaiser 窗) / Speex(WASM, ≥8kHz 默认)

// ============ IVAD ============
interface VADEvent { kind: 'speech-start'|'speech-end'|'confidence'; ts: number; score?: number; }
interface IVAD {
  push(frame: Float32Array): void;                // 10/20/30 ms 帧
  events(): AsyncIterable<VADEvent>;
  reset(): void;
  configure(o: {threshold?: number; minSpeechMs?: number; minSilenceMs?: number}): void;
}

// ============ IWakeWord ============
interface IWakeWord {
  load(model: {url: string; hash: string; sensitivity?: number}): Promise<void>;
  push(frame: Float32Array): void;
  events(): AsyncIterable<{keyword: string; score: number; ts: number}>;
  dispose(): void;
}

// ============ IObservability（带 chunk_id RTT 协议） ============
interface IObservability {
  span<T>(name: string, attrs: Attrs, fn: (s: Span) => Promise<T>|T): Promise<T>;
  histogram(name: string, valueMs: number, attrs?: Attrs): void;
  counter(name: string, attrs?: Attrs): void;
  gauge(name: string, value: number, attrs?: Attrs): void;
  markCapture(chunkId: number, ts: number): void;   // 域特定：capture 标记
  markAck(chunkId: number, ts: number): void;        // 域特定：服务端 ack 标记 → 算 RTT
}
```

**依赖注入约定**：每个场景包导出 `create<Scene>(deps: SceneDeps)` 工厂。`SceneDeps` 是个普通对象装着上述接口——这正是 Taro/小程序接入零成本的原因：换 deps，状态机不变。

---

## 3. 场景层设计（9 个场景）

### 3.1 scene-transcribe · 实时转写
- **编排**：`IAudioCapture → IResampler(→16k) → IVAD(可选) → protocol-volc-asr → ITransport → reducer-transcription → 可观察 state`
- **状态机**：`idle → requesting-perm → capturing → streaming ⇄ reconnecting → stopping → finalized`
- **核心 Reducer**：直接迁移 `transcriptionReducer.ts`（4 路径去重 / djb2 说话人着色 / 累积模式）
- **API**：
  ```ts
  const t = createTranscribeScene(deps, {engine:'volc', lang:'zh-CN', punctuation:true});
  t.start();
  for await (const s of t.state()) render(s);
  t.finalize();
  ```

### 3.2 scene-converse · 实时对话（王冠场景）
- 编排 `scene-transcribe`（输入）+ `scene-tts`（输出）+ `reducer-conversation`
- **关键技术**：`responseId` 门控的 Barge-in 状态机
  - `interrupt()` 原子操作四步：
    1. 自增 `currentResponseId`
    2. 丢弃队列中所有 `chunk.responseId < current` 的块
    3. `AudioBufferSourceNode.stop(currentTime)` 当前正在播的
    4. 等 `onended` 触发且无在途解码后才 emit `barge-in-complete`
- **修复**当前 `useRealtimeConversation.ts` 的竞态泄漏 bug

### 3.3 scene-interpret · 同声传译
- 编排 transcribe + `reducer-translation`（行对齐）+ 可选 TTS
- 跟踪 `(源语句, 译行, ttsResponseId?)` 三元组独立终结
- 双语模式：原文+译文按 utterance id 对齐

### 3.4 scene-wake · 关键词唤醒 + VAD
- `IWakeWord` 跑在 512 样本帧上；触发后把 200ms 预滚动环形缓冲交给 `IVAD` 做端点检测；静默后切到 `scene-transcribe`
- 三组件**共用一个 AudioWorklet 环形缓冲** → SAB → 主线程，零拷贝

### 3.5 scene-tts · 时间调度播放
- `protocol-volc-tts` → `IAudioPlayer` 时间调度队列：
  - `source.start(nextStartTime)`，`nextStartTime = max(ctx.currentTime + ε, lastScheduledEnd)`
  - 暴露 `getScheduledEndTime` 让上层决定何时解麦
- **修复**当前 `useTtsPlayback.ts` 的间隙/咔哒声问题

### 3.6 scene-clone · 声纹克隆
- 复用 `voiceCloningReducer.ts`
- 样本 WAV 用 `IStorage.putBlob`（>10MB 必须走 IndexedDB，localStorage 会爆）

### 3.7 scene-design · 声音设计
- 确定性预设注册表 + 参数插值（年龄/性别/情感滑杆）→ 输出 TTS 参数

### 3.8 scene-file-asr · 离线文件转写
- 文件 → 分块读（2s 帧）→ 同一重采样器 → 同一协议 → 同一 Reducer
- `IStorage` 持久化队列 + 重载恢复
- **Web Worker 执行**，主线程不卡

### 3.9 scene-podcast · 播客生成
- `scene-tts` 多声模式 + `OfflineAudioContext` 合成导出 WAV/MP3（LAME WASM）

**统一契约**：所有场景暴露 `state(): AsyncIterable<State>`、`dispatch(action)`、`stats()`。这是框架绑定能一页写完的原因。

---

## 4. 横切关注点

### 4.1 可观测性（@voice-kit/core-observability）
- OTel Web SDK + **域特定扩展：chunk_id → RTT 回显协议**
  - Worklet 帧边界打 `chunkId + captureTsMono`
  - 服务端 ack 回传 `chunkId`，客户端 `rttMs = mono() - captureMap.get(chunkId)`
  - 进入 **HDR Histogram**（对数线性桶，3 位有效数字）—— 无损 p50/p95/p99，替代当前 PerfMonitor 的"200 样本估 p99"伪统计
- Span 链路：`capture.frame → transport.send → server.recv(traceparent) → asr.partial → render.frame`
- 指标：`voice.capture.underrun_count`、`voice.playback.gap_ms`(HDR)、`voice.transport.rtt_ms`(HDR)、`voice.reducer.apply_ms`、`voice.vad.speech_ratio`

### 4.2 重连与会话恢复（core-transport-ws）
- 抖动指数退避：`base * 2^n * (0.5 + rand()*0.5)`，上限 30s，最多 20 次
- **恢复协议**：`open` 后若有 `resumeToken`，发 `{"type":"resume","token":T,"lastServerSeq":N}`；服务端从 N+1 回放；失败则 fresh 会话并 emit `resumed:false` 让场景决策

### 4.3 背压
- 每个生产者订阅 `ITransport.backpressure.onPressure`
- 暂停时捕获层切"环形丢弃"模式：保留最新 N ms，丢最老，自增 `dropped_frames{reason=backpressure}`
- 场景策略：转写=丢最老；对话=静麦+UI 警告（丢弃会破坏语义）

### 4.4 持久化
- Web：`idb`；Taro：`wx.setStorage`（10MB/key 限制）+ `wx.getFileSystemManager`
- 统一 `IStorage` 接口屏蔽差异

### 4.5 测试策略
- **vitest** 单测，覆盖率目标：`core-reducer-*`、`core-protocol-*` ≥ 90%
- **fast-check 属性测试**：幂等性（同 partial 应用两次状态相同）、去重收敛（任意 partial/final 交错最终文本一致）、说话人颜色 djb2 跨运行稳定
- **黄金 fixture 测试**：从真实 Volcengine 会话抓的帧 → 解码 → 快照
- **Playwright e2e**：跑 `@voice-kit/testkit` mock server（确定性时序）
- **bench**：reducer 吞吐 ≥1M actions/s，重采样 MFLOPS，HDR Histogram 开销

### 4.6 包体积预算（CI `size-limit` 强制）
| 包 | gzip 上限 |
|---|---|
| reducer-transcription | 6 KB |
| protocol-volc-asr | 4 KB |
| karaoke | 1 KB |
| adapter-web | 12 KB（不含懒加载 WASM）|
| react 全 hooks | 8 KB |
| scene-converse（web 全量）| 45 KB |

WASM 全部按内容 hash 版本化、按需懒加载：Silero VAD ~1.8MB、Speex ~90KB、Opus ~250KB

---

## 5. 平台适配器细节

### 5.1 adapter-web（一期主力）
- **采集**：AudioWorklet（**移除当前废弃的 ScriptProcessorNode**）。Worklet 写 Int16 进 `SharedArrayBuffer` 环；主线程用 `Atomics.wait/notify` 在独立索引 SAB 上读 —— **零拷贝**，主线程抖动下仍稳定 20ms 节奏
- **降级**：无 SAB（iOS Safari 跨域隔离问题）回退 `MessagePort.postMessage(Int16Array)`，仍基于 Worklet
- **重采样**：默认 Speex WASM；线性插值只在显式 `{allowAliasing:true}` 时用（**修复当前 48k→16k 混叠**）
- **编码**：可选 Opus（libopusjs WASM）动态码率（按 `voice.transport.rtt_ms` p95 在 8k↔32k 间调）
- **播放**：`AudioContext` + `AudioBufferSourceNode` 时间调度队列
- **权限**：`navigator.permissions.query` + Safari 轮询降级

### 5.2 adapter-electron
- 复用 `adapter-web`（renderer 是 Chromium）+ 增强：
  - 原生菜单栏桥接（开始/停止热键）
  - `desktopCapturer` 系统音频采集（vs 纯浏览器的差异化）
  - IPC 桥：重 WASM（Silero/Whisper）跑在隐藏 `BrowserWindow` 的 Worker

### 5.3 adapter-taro（二期，一期类型桩）
- 微信：`wx.getRecorderManager()`，`frameSize:8`（~80ms@16k，比 web 20ms 粗）
- **文档化限制**（类型化为 capability matrix）：
  - 无 AudioWorklet → 重采样主线程 WASM（小程序允许 `WXWebAssembly`）
  - 无 `AudioContext.currentTime` 调度 → TTS 用 `InnerAudioContext` 顺序队列（小间隙不可避免）
  - 无 SharedArrayBuffer
- 场景读 `adapter.capabilities` 优雅降级

### 5.4 adapter-node / adapter-mock
- Node：`node-record-lpcm16` 或文件源，主要给 CI 和 bench 用
- Mock：确定性时钟、可注入消息流、记录入队块 —— 所有 reducer/scene 测试的脊梁

---

## 6. 技术深度亮点（简历/作品集弹药）

> 任意 3 条单独拎出来都是非平凡的资深前端工作；合起来是"语音领域专家"的可辩护论据。

1. **四路径增量转写去重 Reducer**（迁移自 `transcriptionReducer.ts:1-514`）—— 处理累积/增量/混合引擎模式、乱序 partial、终结后修正；fast-check 属性测试验证幂等
2. **`responseId` 门控的 Barge-in 状态机** —— 跨队列/解码/播放三阶段的原子中断，无旧尾泄漏；附 TLA+ 形式化规约证明 `interrupt` 完成后无陈旧音频
3. **`chunk_id → RTT` HDR Histogram 观测协议** —— 客户端打单调 id，服务端回显 ack，对数线性直方图 3 位有效数字，OTel 导出 `voice.transport.rtt_ms`，p99 误差 ≤1%
4. **Volcengine v3/sauc 二进制协议编解码器**（TS 重写）—— 凭规约+抓包观察实现，黄金 fixture 测试覆盖
5. **AudioWorklet + SharedArrayBuffer 零拷贝环形缓冲** —— `Atomics.wait/notify` 同步，无 SAB 平台降级；100% CPU 下稳定 20ms 帧
6. **时间调度的 `AudioContext` 播放队列** —— `source.start(atTime)` + 漂移补偿（`nextStartTime = max(ctx.currentTime+ε, lastEnd)`），暴露 `getScheduledEndTime`，消除咔哒/间隙
7. **Speex/多相 Sinc WASM 重采样器** —— Kaiser 窗设计、保相位，替代当前线性插值的混叠
8. **WebSocket 会话恢复协议** —— `resumeToken` + `lastServerSeq`，抖动指数退避，恢复 vs fresh 决策上抛给场景 reducer
9. **Silero VAD ONNX Runtime Web 集成** —— VAD + 唤醒 + 采集共用一个 Worklet 帧的预滚动环形缓冲；WASM 不可用时降级能量+过零率
10. **卡拉OK 词索引二分 + rAF 节流对齐**（迁移）—— 亚像素级高亮，不触发每帧 React 协调
11. **Opus WASM 自适应码率编码** —— 按 RTT p95 驱动（4G 8k / WiFi 24k），SDK 级网络感知
12. **IndexedDB 持久的离线文件转写队列** —— 重载恢复 + Web Worker 执行，纯 Reducer 驱动（同样属性测试）

---

## 7. 路线图

### Phase 1 · MVP（PC + H5 全场景，~8 周）
- Monorepo 脚手架 + CI（Turbo 远程缓存 / size-limit / changesets）
- L1 全部纯核心包（types/utils/4 个 protocol/4 个 reducer/karaoke/dsp/vad-energy/observability/transport-ws）
- adapter-web 全量、adapter-electron 薄、adapter-node、adapter-mock；adapter-rn/taro 仅类型桩
- 9 个场景全部跑通 playground-web + playground-h5
- `@voice-kit/react` 全 hooks
- **修复**前述 8 项技术债
- v0.1.0 发 npm + 文档站

### Phase 2 · 小程序端 + 进阶能力（~6 周）
- adapter-taro 全量 + 微信 playground
- `@voice-kit/vue` composables
- core-vad-silero（ONNX Runtime Web）+ core-wake-porcupine
- 微信真机 QA
- v0.5.0

### Phase 3 · 高级（~10 周）
- WebRTC transport（数据通道 + Opus RTP，低延迟对话）
- E2E 加密（SFrame 风格帧加密，ECDH 协商）
- 端侧 Whisper.cpp WASM（隐私/离线模式）
- 浏览器 DevTools 扩展
- Solid/Svelte 绑定
- converse 的 TLA+ 规约发布
- v1.0.0

---

## 8. 关键文件清单

### 直接迁移（逐字提取）
| 源 | 目标 |
|---|---|
| `voice-portfolio/.../state/transcriptionReducer.ts` | `packages/core-reducer-transcription/src/index.ts` |
| `voice-portfolio/.../state/conversationReducer.ts` | `packages/core-reducer-conversation/src/index.ts` |
| `voice-portfolio/.../state/translationReducer.ts` | `packages/core-reducer-translation/src/index.ts` |
| `voice-portfolio/.../state/voiceCloningReducer.ts` | `packages/core-reducer-cloning/src/index.ts` |
| `voice-portfolio/.../subtitleKaraoke.ts` | `packages/core-karaoke/src/index.ts` |
| `voice-portfolio/.../hooks/useThrottledPartial.ts` | `packages/react/src/useThrottledPartial.ts` |
| `voice-portfolio/.../observability/otel.ts` + `tracer.ts` | `packages/core-observability/src/{otel,tracer}.ts` |

### 围绕适配器接口重写
| 源 | 目标 |
|---|---|
| `AudioCapture.ts` | 拆成 `core-types/src/audio.ts`(接口) + `adapter-web/src/capture.ts`(实现，AudioWorklet-only，删 ScriptProcessor) |
| `WebSocketClient.ts` | `core-transport-ws/src/index.ts`，加重连+恢复+背压 |
| `useTtsPlayback.ts` | 逻辑 → `scene-tts/src/state.ts`(纯) + `adapter-web/src/player.ts`(调度队列) |
| `useVoiceCloning.ts` | → `scene-clone/src/index.ts`，用 `IStorage.putBlob` |
| `useSimultaneousInterpretation.ts` | → `scene-interpret/src/state.ts` |
| `usePodcastGeneration.ts` | → `scene-podcast/src/state.ts` |
| `server/volcengine_engine.py` + `server-nest/.../protocol.ts` | 参考 → `core-protocol-volc-asr/src/codec.ts`(TS 重写) |

### 新建关键文件
- `pnpm-workspace.yaml` / `turbo.json` / `tsconfig.base.json` / `.changeset/config.json`
- `packages/core-types/src/index.ts` —— **承重文件**，所有包都依赖它
- `packages/core-observability/src/hdr-histogram.ts` —— HDR Histogram + chunk_id RTT
- `packages/adapter-web/src/worklet/audio-processor.js` + `sab-ring.ts` —— 零拷贝采集核心
- `packages/scene-converse/src/index.ts` —— Barge-in 状态机，王冠明珠

---

## 9. 一期落地建议（最小可发布切片）

如果要快速产出作品集 demo，建议这个顺序（每步可独立验证）：

1. **脚手架**（2 天）：pnpm workspace + Turbo + 4 个最核心包骨架（core-types/core-utils/core-reducer-transcription/adapter-web）
2. **转写场景打通**（1 周）：迁移 reducer + 重写 AudioCapture 为 AudioWorklet → playground-web 跑通实时转写
3. **传输层加固**（3 天）：core-transport-ws 加抖动指数退避 + 背压
4. **可观测**（3 天）：HDR Histogram + chunk_id RTT + 全链路 span
5. **对话场景**（1 周）：scene-converse 的 responseId 门控 Barge-in
6. **TTS 场景**（3 天）：时间调度播放队列
7. **同传/克隆/设计/文件/播客**（2 周）：复用已有 Reducer，主要是编排
8. **VAD + Wake**（1 周）：能量 VAD 先行，Silero 二期
9. **Taro 类型桩**（2 天）：让 scene 包能带三端类型发布
10. **文档站 + 发布 v0.1.0**（3 天）

**总计 ~8 周** 可交付一个有真实技术深度的跨端语音 SDK。
