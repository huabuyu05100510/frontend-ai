# 实时语音交互生产级方案（极致性能版）

> 场景：实时语音转写（ASR）/ 实时语音翻译转写（ASR + MT）/ 实时语音交互（Full-duplex Voice Agent）/ AI 博客语音播放（TTS）/ 类豆包语音交互
> 终端：H5（iOS Safari / Android Chrome / 微信内嵌）/ PC（Electron / 浏览器）/ 微信小程序
> 对标：豆包实时语音（S2S 200~500ms）、OpenAI gpt-realtime（800ms P50）、Gemini Live、Moshi、LiveKit / Pipecat
> 设计目标（**极致版**）：级联 P50 ≤ **600ms** / P95 ≤ **1000ms**；端到端 S2S P50 ≤ **350ms** / P95 ≤ **600ms**；TTS 首音 ≤ **180ms**；打断 ≤ **100ms**；99.95% 可用

---

## 目录

1. [业务模型与术语统一](#1-业务模型与术语统一)
2. [产品形态矩阵](#2-产品形态矩阵)
3. [对标与设计目标（极致版）](#3-对标与设计目标极致版)
4. [整体架构（端到端）](#4-整体架构端到端)
5. [五种核心 Pipeline](#5-五种核心-pipeline)
6. [输入输出能力矩阵（用户语音输入 → 设备文字/语音输出）](#6-输入输出能力矩阵)
7. [网络与传输选型（WebRTC vs WebSocket vs SSE）](#7-网络与传输选型)
8. [协议设计（统一网关协议 v1）](#8-协议设计统一网关协议-v1)
9. [端侧三件套：采集 / 播放 / VAD](#9-端侧三件套)
10. [状态机：会话 / 说话 / 打断 / 续说](#10-状态机)
11. [延迟预算与极致优化策略](#11-延迟预算与极致优化策略)
12. [降级与容错](#12-降级与容错)
13. [可观测、日志、追踪](#13-可观测日志追踪)
14. [安全、合规与风控](#14-安全合规与风控)
15. [成本与配额](#15-成本与配额)
16. [分阶段落地与里程碑](#16-分阶段落地与里程碑)
17. [面试回答模板](#17-面试回答模板)

---

## 1. 业务模型与术语统一

### 1.1 业务模型（按"输入模式 × 输出模式"二维拆解）

| 业务 | 输入模式 | 输出模式 | 是否需要 LLM | 典型 QPS（单租户） | 典型时长 |
|---|---|---|---|---|---|
| **实时语音转写** | 🎙 麦克风 | 📺 **设备文字**（屏幕字幕 / 滚动文本） | 否 | 1k ~ 10k | 1 ~ 30 min |
| **实时语音翻译转写** | 🎙 麦克风 | 📺 **设备文字**（原文 + 译文 双语字幕） | 否（MT 流式） | 0.5k ~ 5k | 5 ~ 60 min |
| **实时语音交互** | 🎙 麦克风 | 🔊 **设备语音**（AI 拟人回复）+ 📺 文字字幕 | **是**（流式 LLM） | 0.1k ~ 1k | 1 ~ 10 min |
| **AI 博客语音播放** | 📝 文章正文（无麦克风） | 🔊 **设备语音**（流式朗读 + 高亮） | 否 | 5k ~ 50k | 30s ~ 5 min |
| **类豆包语音交互**（S2S） | 🎙 麦克风 | 🔊 **设备语音**（端到端拟人回复） | **端到端** | 0.1k ~ 1k | 1 ~ 10 min |
| **混合输出：转写 + 播放** | 🎙 麦克风 | 📺 文字 + 🔊 语音（适合视障/听障/会议全场景） | 视情况 | 0.5k ~ 3k | 5 ~ 30 min |

**关键抽象**：把"输入"和"输出"解耦为两条独立通道，**可以自由组合**，这是产品力灵活性的根源（见第 6 章）。

### 1.2 术语表

| 术语 | 含义 |
|---|---|
| **ASR** | Automatic Speech Recognition，语音→文字 |
| **MT** | Machine Translation，文本→另一语种文本 |
| **TTS** | Text-to-Speech，文字→语音 |
| **S2S** | Speech-to-Speech，端到端语音模型（豆包/4o/Gemini Live） |
| **VAD** | Voice Activity Detection，人声活动检测（端点检测） |
| **AEC** | Acoustic Echo Cancellation，回声消除 |
| **Barge-in** | 用户在 AI 说话时插话打断 |
| **Turn-taking** | 对话轮次切换（谁在说话） |
| **Endpointing** | 句子切分（决定"说完了"） |
| **TTFB** | Time To First Byte（首字节） |
| **TTFA** | Time To First Audio（首音） |
| **E2E Latency** | 端到端延迟（用户停嘴→AI 出声） |
| **P50 / P95** | 50% / 95% 分位延迟 |
| **Opus / PCM** | 音频编码（Opus 抗弱网；PCM16 是中间表示） |

---

## 2. 产品形态矩阵

```
┌────────────────┬─────────────┬──────────────┬──────────────┬─────────────┐
│  形态           │ 主链路      │  推荐传输    │  LLM         │  终端适配    │
├────────────────┼─────────────┼──────────────┼──────────────┼─────────────┤
│  实时转写       │ Mic→ASR→UI │  WS(全双工)  │  否          │  H5/PC/小程序│
│  实时翻译转写   │ Mic→ASR→MT │  WS(全双工)  │  否(MT)      │  H5/PC/小程序│
│  实时语音交互   │ Mic→ASR→   │  WebRTC(优)  │  流式 LLM    │  H5/PC      │
│  (级联)         │ LLM→TTS→Spk│  /WS(可)    │              │             │
│  类豆包交互     │ Mic→S2S→Spk│  WebRTC(强)  │  端到端 S2S  │  H5/PC      │
│  AI 博客朗读    │ Text→TTS→  │  SSE/WS      │  否(可选摘要)│  H5/PC/小程序│
│                │ Spk         │  (单向流)    │              │             │
└────────────────┴─────────────┴──────────────┴──────────────┴─────────────┘
```

> **关键决策**：
> 1. **小程序**因没有 `RTCPeerConnection` 完整能力 + AudioWorklet 受限，**只能走 WebSocket + 编码音频**（Opus/MP3/PCM）。
> 2. **H5 / PC** 在良好网络下走 **WebRTC**，弱网/小程序/低配终端降级到 **WebSocket**。
> 3. 同一个前端 SDK 根据 `navigator` 能力自动选择，不让业务感知。

---

## 3. 对标与设计目标（极致版）

### 3.1 行业对标（P50 端到端）

| 系统 | E2E 端到端 | ASR 首字 | TTS 首音 | 打断响应 | 备注 |
|---|---|---|---|---|---|
| **豆包实时语音**（S2S） | **200~500ms** | 100~200ms | 100~200ms | < 200ms | 端到端 Speech2Speech |
| **OpenAI gpt-realtime** | **~800ms**（P50 优秀） / ~1.2s（P95） | 200~300ms | 200~300ms | 200~400ms | WebRTC GA |
| **Gemini Live** | **~700ms** | 200~300ms | 200~300ms | ~300ms | 多模态 |
| **Moshi**（Kyutai 开源） | **~200ms** | < 100ms | < 100ms | < 100ms | 极致 S2S，全双工 |
| **LiveKit + Pipecat**（最佳实践） | 800~1000ms | 200~300ms | 200~300ms | 200~300ms | 开源参考 |
| **火山引擎 RTC 方案** | ~1s | < 300ms | < 300ms | < 300ms | 字节自家 |
| 主流级联（ASR+LLM+TTS，未优化） | 1.5~2.5s | 200~400ms | 300~600ms | 300~600ms | 行业平均 |

> **关键洞察**：豆包 / Moshi 做到 200~500ms 的核心原因是 **端到端 S2S**（无中间文本），但**级联架构只要工程极致，也能做到 600ms 以内**（我们的目标）。

### 3.2 我们的极致目标（对齐豆包 / 超越 LiveKit）

| 指标 | **P50** | **P95** | 备注 |
|---|---|---|---|
| **ASR 首个分片可见** | **< 200ms** | < 350ms | 用户说话 100ms 后首个文字出现 |
| **翻译首个分片可见** | **< 350ms** | < 600ms | 原文 + 译文 |
| **E2E 语音交互（极致级联）** | **< 600ms** | < 1000ms | 停嘴→AI 出声 |
| **E2E 语音交互（端到端 S2S）** | **< 350ms** | < 600ms | 对标豆包 / Moshi |
| **TTS 首音** | **< 180ms** | < 350ms | 流式双向 TTS |
| **打断响应（barge-in）** | **< 100ms** | < 200ms | 客户端 VAD → TTS 全停 |
| **字幕显示** | **< 50ms** | < 100ms | 端上处理延迟 |
| **可用性** | **99.95%** | | 月停服 < 22min |
| **弱网降级成功率** | **> 98%** | | 4G/电梯/弱 Wi-Fi |
| **100ms 音频缓冲** | < 60ms | < 120ms | AudioWorklet → 编码 → 出网 |

**对比上一版的提升**：

| 指标 | 旧版 | 新版（极致） | 提升 |
|---|---|---|---|
| ASR 首个分片 | 400ms | 200ms | **-50%** |
| E2E 级联 | 1.2s | 600ms | **-50%** |
| E2E S2S | 900ms | 350ms | **-61%** |
| TTS 首音 | 350ms | 180ms | **-49%** |
| 打断 | 200ms | 100ms | **-50%** |
| 可用性 | 99.9% | 99.95% | +0.05% |

> **如何做到**：看第 11 章"延迟预算与极致优化"。核心是 **SPECULATIVE（推测执行）+ PIPELINE PARALLEL（管道并行）+ EDGE COMPUTING（边缘计算）+ END-TO-END MODEL（端到端模型）** 四把利刃。

### 3.3 性能指标的可验证性

> "说自己快不算快"。每个指标必须能在生产环境 7×24 抽样验证：

```
指标采集：客户端 SDK 上报到 Prometheus
采样率：100%（关键指标）
报表：实时 Grafana + 每日 P50/P95/P99 报表
对账：每周抽 1% 会话做"真实端到端"对照（服务端时间戳 + 客户端时间戳）
对标：每月与豆包 / OpenAI 做相同测试集对照
```

---

## 4. 整体架构（端到端）

### 4.1 总览

```
┌────────────────────────────────────────────────────────────────────────┐
│                              终端 (Client)                              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  App / H5 / 小程序                                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ AudioCapture │→ │   VoiceSDK   │→ │ AudioPlayback │             │  │
│  │  │ (Mic+Worklet)│  │ (状态机+网络) │  │ (Web Audio)  │             │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │  │
│  │         │                │   ▲   ▲               ▲                │  │
│  └─────────┼────────────────┼───┼───┼───────────────┼────────────────┘  │
└───────────┼────────────────┼───┼───┼───────────────┼───────────────────┘
            │   Mic PCM/Opus │   │   │ TTS Opus/PCM  │ Spk
            ▼                ▼   │   │               │
   ┌──────────────────────────────────────────────────────────────────┐
   │                       边缘接入层 (Edge)                            │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
   │  │RTC TURN │  │WS 网关    │  │SSE 网关   │  │TURN/STUN │            │
   │  │(WebRTC) │  │(小程序)  │  │(TTS 单向)│  │          │            │
   │  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘            │
   │        │             │            │             │                 │
   │        └─────────────┴─────┬──────┴─────────────┘                  │
   │                            │                                       │
   │                    媒体网关 (Media Gateway)                         │
   │                    - 协议转换 (WS↔WebRTC↔gRPC)                      │
   │                    - 鉴权 / 限流 / 路由                              │
   │                    - 会话状态 (Redis)                                │
   └────────────────────────────┼──────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │  ASR 集群       │  │  LLM 网关       │  │  TTS 集群       │
   │  (流式 + VAD)   │  │  (流式 SSE)     │  │  (流式)         │
   │  火山/讯飞/自研 │  │  OpenAI/豆包/Qwen│  │ 火山/讯飞/Edge  │
   └────────┬───────┘  └────────┬───────┘  └────────┬───────┘
            │                   │                    │
            ▼                   ▼                    ▼
   ┌──────────────────────────────────────────────────────────┐
   │          业务编排 (Orchestrator / Pipecat-like)            │
   │          - 会话上下文 (短期/长期记忆)                       │
   │          - 工具调用 / RAG / 翻译                          │
   │          - 端点检测 / 句子切分                            │
   │          - 协议帧转发                                     │
   └──────────────────────────────────────────────────────────┘
                                │
                                ▼
   ┌──────────────────────────────────────────────────────────┐
   │          旁路 (Sidecar)                                   │
   │          - 录音存储 (合规)                                 │
   │          - ASR/TTS 评测 / 抽检                            │
   │          - 风控 (涉政/涉黄/广告)                          │
   │          - 数据分析                                       │
   └──────────────────────────────────────────────────────────┘
```

### 4.2 关键设计原则

1. **统一入口**：所有形态的流量先进 **Voice Gateway**，由网关做协议适配和路由，业务后端无需感知前端差异。
2. **边缘优先**：客户端就近接入最近的 Edge 节点（GSLB + 地域调度），缩短 RTT。
3. **链路可降级**：WebRTC ↔ WebSocket ↔ 文本 三级降级，业务侧无感。
4. **编排与媒体分离**：编排层只关心"说什么"，媒体层只关心"怎么发"。
5. **可观测贯穿**：从 Mic→ASR→LLM→TTS→Spk 全链路打点，P50/P95 实时可见。

### 4.3 GSLB 与地域调度

```
客户端 DNS 解析
  → GSLB (基于 IP 库 + 实时 RTT 探测 + 容量)
  → 最近 Edge 节点 (北京/上海/广州/新加坡/法兰克福 …)
  → 就近路由到后端服务（同 Region 优先）
```

延迟收益：跨 Region RTT 50~150ms → 同 Region 5~20ms，**省 100ms+**。

---

## 5. 五种核心 Pipeline

### 5.1 Pipeline A：实时语音转写（ASR Only）

```
Mic → AudioWorklet (PCM 16k) → WebSocket → ASR 流式 → 文字流 → UI
```

**协议帧**：

```
┌────────────┬───────────┬────────────┬───────────┐
│  FrameType │  Seq      │  Timestamp │  Payload  │
│  0x01=音频 │  u32      │  u64 ms    │  PCM/Opus │
│  0x02=开始 │           │            │  meta     │
│  0x03=结束 │           │            │           │
└────────────┴───────────┴────────────┴───────────┘
```

**ASR 返回**（服务端 → 客户端）：

```json
{ "type": "asr.partial", "text": "今天天气", "ts": 12345 }
{ "type": "asr.final",   "text": "今天天气不错", "ts": 15230, "confidence": 0.97 }
```

### 5.2 Pipeline B：实时语音翻译转写（ASR + MT）

```
Mic → ASR (流式) → MT (流式，按句) → 原文 + 译文 → UI 双语
```

**关键：MT 等 ASR 出整句（或半句）后再流式翻译**，避免来回修改。常见策略：

- **句子级翻译**：ASR 检测到标点 → 触发 MT → 输出完整译文
- **半句级翻译**：检测到强停顿（> 400ms）→ 触发 MT（折中）
- **增量翻译**：MT 模型本身流式（部分 NMT 支持），通常不需要

**协议**：

```json
{ "type": "transcript", "lang": "zh", "text": "今天天气不错", "isFinal": true }
{ "type": "translation", "lang": "en", "text": "Nice weather today", "isFinal": true, "srcTs": 15230 }
```

### 5.3 Pipeline C：实时语音交互（级联 ASR + LLM + TTS）

```
Mic → ASR → 句子切分 → LLM (SSE) → 句子切分 → TTS (WS) → Spk
                ↑                                ↓
                └─── 打断 (barge-in) ←───────────┘
```

**关键时序**：

```
用户说:    |----ASR----|END|
                                |  端点检测 200ms |
                                |--LLM (TTFT 200ms)-|----首字 token 50ms 后-->|
                                                          | TTS首包 300ms |
                                                          |---首音 350ms---|
                                                                          | 流式播放 |
用户听到:                                                                    |======AI 回答===========|
```

**E2E = ASR_final(200) + LLM_TTFT(200) + LLM 首句(50) + TTS_TTFA(350) = ~800ms**

### 5.4 Pipeline D：类豆包（端到端 S2S）

```
Mic → S2S 模型 → AI 语音 (流式 PCM) → Spk
        ↑
   内置 VAD / 端点检测 / 情绪 / 打断
```

**代表**：豆包实时语音、OpenAI gpt-realtime、Gemini Live。
**优势**：避免级联误差累积；情绪/韵律自然。
**劣势**：模型不可控、可解释性差、成本高、私有化难。

**协议**（以 OpenAI Realtime 为参考）：

```json
// 客户端 → 服务端
{ "type": "input_audio_buffer.append", "audio": "<base64 PCM>" }
{ "type": "input_audio_buffer.commit" }
{ "type": "response.cancel" }                 // 打断

// 服务端 → 客户端
{ "type": "input_audio_buffer.speech_started" }  // VAD 检测到人声
{ "type": "input_audio_buffer.speech_stopped" }
{ "type": "response.output_audio.delta", "delta": "<base64>" }
{ "type": "response.output_audio.done" }
```

### 5.5 Pipeline E：AI 博客语音播放（TTS）

```
文章正文/富文本 → 预处理 (Markdown 清理 / 分句) → TTS (流式) → Spk
                                                              + 高亮同步
```

**预处理要点**：
- 去掉 Markdown、URL、代码块、emoji
- 中英文分句（中：`。！？`；英：`.!?`）
- 长句按 80~150 字强制切分
- 数字/年份/英文术语按 SSML 标注发音

**协议**（单向，SSE 即可）：

```
GET /tts/stream?text=...&voice=...
→ data: {"chunk": 1, "audio": "<base64>", "text": "今天", "ssmlRange": [0,2]}
→ data: {"chunk": 2, "audio": "<base64>", "text": "天气", "ssmlRange": [2,4]}
→ data: {"end": true}
```

---

## 6. 输入输出能力矩阵（用户语音输入 → 设备文字/语音输出）

> 业务方按需自由组合 **输入模式** 和 **输出模式**,不必固定 Pipeline。
> 上一版只讨论"管道",这一版显式把 **输入能力** 和 **输出能力** 拆成两条独立通道,可灵活组合。

### 6.1 输入模式（Input Modes）

| 模式 | 描述 | 触发 | 适用 |
|---|---|---|---|
| **`mic_continuous`** | 持续录音（默认） | 客户端 VAD 自动判断 | 实时语音交互 / 翻译 |
| **`mic_push_to-talk`** | 按住说话（对讲机式） | 按下/松开 | 嘈杂环境 / 会议 |
| **`mic_wake_word`** | 唤醒词触发 | 端侧 / 服务端唤醒词 | 智能音箱 / 车载 |
| **`text_input`** | 纯文字输入 | 用户键入 | 静音场景 / 文本对话 |
| **`text_with_audio_reply`** | 文字输入 + 语音回复 | 同上 | 适合"想看 + 想听"双输出 |
| **`file_audio`** | 上传音频文件 | 用户上传 | 离线转写 / 翻译 |
| **`mixed_input`** | 文字 + 语音混输 | 任意 | 多模态 Agent |
| **`system_audio_capture`** | 截取系统声音 | Electron / Native | 截屏讲解 / 会议旁听 |

### 6.2 输出模式（Output Modes）

> **核心结论**:用户要的"输出"是**设备维度**的——设备有扬声器就出声,有屏幕就出文字,有震动马达就震动,**不是非此即彼,可以全开**。

| 模式 | 描述 | 形式 | 延迟目标 |
|---|---|---|---|
| **`voice_only`** | 仅语音输出 | 设备扬声器 / 耳机 / 蓝牙 | TTS 首音 ≤ 180ms |
| **`text_only`** | 仅文字输出（设备屏幕字幕） | 屏幕 / 字幕条 | 显示延迟 ≤ 50ms |
| **`voice_with_caption`** | 语音 + 实时字幕（默认） | 双通道 | TTS ≤ 180ms + 字幕 ≤ 50ms |
| **`bilingual_caption`** | 双语字幕（原文 + 译文） | 屏幕 | 翻译 ≤ 350ms |
| **`text_streaming`** | 文字流（LLM token 级） | 屏幕 | TTFT ≤ 100ms |
| **`bilingual_voice`** | 双语语音播放 | 扬声器 | TTS ≤ 180ms |
| **`off_silent`** | 静音播放（只产生字幕） | 屏幕 | 字幕 ≤ 50ms |
| **`multi_device`** | 多设备同步输出 | 手机/音箱/电视 | 同步 ≤ 100ms |
| **`haptic_event`** | 事件震动（打断/结束） | 震动马达 | 50ms |
| **`system_notification`** | 系统通知 | 系统级 | 异步 |

### 6.3 输入 × 输出 组合矩阵（业务全景）

| 业务 \ 输出 | voice_only | text_only | voice+caption | bilingual_caption | bilingual_voice |
|---|---|---|---|---|---|
| **mic_continuous + LLM** | 智能音箱 | 聊天框 | **类豆包** | 视障辅助 | 同声传译 |
| **mic_continuous + ASR** | 听写助理 | **实时字幕** | 视频会议字幕 | **同声传译字幕** | 翻译耳机 |
| **text_input + LLM** | 听书模式 | 聊天框 | AI 助手 | 双语对照 | 翻译阅读 |
| **file_audio + ASR** | — | 文档转写 | 视频字幕生成 | 字幕翻译 | 配音翻译 |
| **mic_push_to-talk + LLM** | 嘈杂场景 | 客服对话 | 户外助手 | 户外翻译 | 商务翻译 |
| **mic_wake_word + LLM** | 智能音箱 | 智能屏 | 智能助手 | 智能翻译机 | 智能耳机 |
| **system_audio + LLM** | 旁听音箱 | 旁听字幕 | 截屏讲解 | 双语旁听 | 翻译耳机 |

### 6.4 设备输出能力检测

客户端 SDK 启动时探测设备能力,**按可用通道自动启用**:

```ts
async function detectOutputCapabilities(): Promise<OutputCapabilities> {
  return {
    speaker: hasMediaDevice('audiooutput'),         // 扬声器
    headphone: await isBluetoothHeadsetConnected(), // 蓝牙耳机
    screen: typeof document !== 'undefined',        // 屏幕
    haptic: 'vibrate' in navigator,                // 震动反馈
    notif: 'Notification' in window,                // 系统通知
    ble_device: await scanBLEDevices(),            // 蓝牙耳机/音箱
    airplay: 'WebKitPlaybackTargetAvailabilityEvent' in window,  // AirPlay
    cast: 'Presentation API' in window,            // 投屏
  };
}

// 根据能力自动决定输出
const caps = await detectOutputCapabilities();
if (caps.headphone || caps.speaker) session.enableOutput('voice');
if (caps.screen) session.enableOutput('caption');
if (caps.haptic) session.enableOutput('haptic_on_event');  // 重要事件震动
```

### 6.5 多设备同步输出（Multi-Device Casting）

> 手机发起对话,音箱/耳机同步播放,电视显示字幕。

```
                   Phone (主控)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   Bluetooth    AirPlay     Smart TV
   Headphone    Speaker    (字幕)
   (语音)      (语音)     (文字)
```

实现:
- **协议**:mDNS 发现 + 自定义 LAN 协议
- **同步**:NTP 时间对齐,主设备广播时间戳,从设备本地缓冲播放
- **延迟差**:≤ 100ms(人耳几乎不可察)

### 6.6 输入输出开关 API

```ts
// 业务侧 API:自由控制每条通道
const session = createVoiceSession({ ... });

// 控制输入
session.setInput('mic_push_to-talk');
session.setInput('text_with_audio_reply');

// 控制输出
session.setOutput({
  voice: true,            // 设备语音
  caption: true,          // 设备文字
  bilingual: 'both',      // 原文+译文 / 'source' / 'target' / null
  haptic: 'on_speech_end' // 震动触发点
});

// 运行时切换(用户切到静音)
session.setOutput({ voice: false });
```

### 6.7 典型 UI 模式

#### 模式 1:类豆包语音球(voice + caption)

```
       ┌─────────────────┐
       │   🎙 (Voice Orb) │
       │   状态可视化      │
       └─────────────────┘
       ┌────────────┐
       │  字幕滚动   │  ← 设备文字输出
       └────────────┘
```

#### 模式 2:会议实时字幕(text_only)

```
┌──────────────────────────────────────┐
│ 张三: 大家好，今天我们讨论...        │  ← 原文
│ Mike: Good morning everyone, today.. │  ← 译文
├──────────────────────────────────────┤
│ 🎙 正在录音...                       │
└──────────────────────────────────────┘
```

#### 模式 3:博客阅读(TTS only, voice + 高亮 caption)

```
┌──────────────────────────────────────┐
│  AI 正在朗读...                       │
│  进度: ████████░░ 80%                │
├──────────────────────────────────────┤
│  今天的**深度学习**很有趣...          │  ← 高亮当前句
│  ^^^^^^                              │
└──────────────────────────────────────┘
```

#### 模式 4:智能音箱(voice_only, 状态灯环)

```
物理按钮 → 唤醒 → 语音交互
           ↓
       状态灯环(颜色表示状态)
```

#### 模式 5:同声传译(双语 voice + bilingual_caption)

```
┌──────────────────────────────────────┐
│ Source: 今天天气不错                  │  ← 原文
│ Target: Nice weather today           │  ← 译文
├──────────────────────────────────────┤
│  🔊 [播放源] [播放译文]               │
└──────────────────────────────────────┘
```

### 6.8 设备差异化能力清单

| 设备 | 能力 |
|---|---|
| **手机 (iOS/Android)** | 全部能力:Mic + Speaker + Screen + Haptic + Bluetooth + 系统通知 + 后台 |
| **PC (浏览器)** | Mic + Speaker + Screen + 通知(受限) |
| **PC (Electron)** | 全部 + 系统音频捕获 + 全局快捷键 + 多声道 |
| **iPad** | 全部 + Apple Pencil 标记 |
| **智能音箱** | 远场 Mic 阵列 + Speaker(无屏幕,靠语音) |
| **蓝牙耳机** | Mic + Speaker(无屏幕,靠手机显示) |
| **车载** | 远场 Mic + 车载 Speaker + 中控屏 + 方向盘按键 |
| **智能眼镜** | Mic + 骨传导 + 屏幕(极小) |
| **微信小程序** | Mic + Speaker + Screen(**无后台运行**) |
| **Web 公众号 H5** | Mic + Speaker + Screen(**微信内 X5 限制**) |
| **TV / 投屏** | 无 Mic + Speaker + 大屏(适合被动消费) |
| **IoT 设备** | 通常无屏幕,靠语音 + 状态灯 |

### 6.9 与第 5 章 Pipeline 的关系

| Pipeline (5.x) | 输入模式 (6.1) | 输出模式 (6.2) |
|---|---|---|
| A. 实时转写 | `mic_continuous` / `file_audio` | `text_only` / `bilingual_caption` |
| B. 实时翻译转写 | `mic_continuous` / `file_audio` | `bilingual_caption` / `bilingual_voice` |
| C. 实时语音交互 | `mic_continuous` / `text_input` / `mixed_input` | `voice_with_caption`(默认) |
| D. 类豆包 S2S | `mic_continuous` | `voice_with_caption` |
| E. AI 博客播放 | `text_input` / `file_audio` | `voice_only` / `text_streaming` |

> **设计哲学**:**Pipeline 是服务端编排逻辑的"配方",InputMode / OutputMode 是面向业务和用户的"产品力开关"**。同一个 Pipeline 可以接受多种 InputMode,产生多种 OutputMode。例如"实时语音交互" Pipeline 可以跑:
> - (mic_continuous) → (voice_with_caption): 类豆包
> - (text_input) → (voice_only): 听书模式
> - (text_input) → (text_streaming): 文字聊天
> - (mic_continuous) → (bilingual_voice): 同声传译

---

## 7. 网络与传输选型（WebRTC vs WebSocket vs SSE）

### 6.1 决策矩阵

| 维度 | WebRTC | WebSocket | SSE / HTTP |
|---|---|---|---|
| 延迟 | 最低（UDP 媒体） | 中（TCP） | 中-高 |
| 抗弱网 | **强**（FEC/Jitter/NACK） | 中（重传/拥塞） | 弱 |
| 浏览器 | ✅ | ✅ | ✅ |
| 小程序 | ❌（无 PC 完整 API） | ✅ | ✅（仅下行） |
| 服务端成本 | 高（SFU/MCU） | 中 | 低 |
| 调试难度 | 高 | 中 | 低 |
| 双向 | ✅ | ✅ | ❌ |

### 6.2 推荐策略

```
                   ┌────────────────────────┐
                   │  终端能力检测 (Runtime)  │
                   └────────────┬───────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼                               ▼
        ┌───────────────┐               ┌───────────────┐
        │  H5/PC 浏览器  │               │  微信小程序    │
        │  + WebRTC     │               │  + WebSocket  │
        └───────┬───────┘               └───────┬───────┘
                │                               │
                │  弱网/失败/不支持             │
                └──────────────┬────────────────┘
                               ▼
                        ┌──────────────┐
                        │  降级 WS      │
                        │  + 编码音频   │
                        │  (Opus/MP3)   │
                        └──────────────┘
```

### 6.3 WebRTC vs WebSocket 音频编码

| 编码 | 比特率 | 抗丢包 | 浏览器原生 | 适合 |
|---|---|---|---|---|
| **Opus** | 16~32kbps | 极强（PLC/FEC） | ✅ | WebRTC / 弱网 |
| **PCM16** | 256kbps | 弱 | 需转码 | 内网 / 调试 |
| **MP3** | 32~128kbps | 中 | ❌（需解码） | 小程序 / 兼容性 |
| **AMR-WB** | 6.6~23.85kbps | 强 | ❌ | 移动端 / 微信 SILK |

> 实际推荐：**WebRTC 用 Opus，WebSocket 用 Opus（裸流） 或 MP3（兼容性最好）**。
> 小程序用 **PCM 16k 16bit** 直接帧（参考已有方案：frameSize=5KB，onFrameRecorded）。

---

## 7. 协议设计（统一网关协议 v1）

> 关键：**协议对前端 SDK 屏蔽 WebRTC/WebSocket 差异**，业务侧只看到统一事件。

### 7.1 帧格式（WebSocket 通道）

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Magic    │ Version  │ Type     │ Length   │ Payload  │
│ 0xVOIC   │ 0x01     │ u16      │ u32      │ bytes    │
│ (4B)     │ (1B)     │ (2B)     │ (4B)     │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘

Magic = 'V','O','I','C'
最大帧 64KB（音频帧分片 4KB 传输）
```

### 7.2 Type 枚举

| Type | 方向 | 名称 | Payload |
|---|---|---|---|
| 0x0001 | C→S | `HELLO` | `{ sessionId, auth, mode, config }` |
| 0x0002 | S→C | `WELCOME` | `{ sessionId, serverTime, config }` |
| 0x0010 | C→S | `AUDIO_FRAME` | `{ seq, ts, codec, data }` |
| 0x0011 | S→C | `AUDIO_OUT` | `{ seq, ts, codec, data }`（TTS/S2S 回放） |
| 0x0020 | S→C | `ASR_PARTIAL` | `{ text, ts, stable }` |
| 0x0021 | S→C | `ASR_FINAL` | `{ text, ts, confidence }` |
| 0x0022 | S→C | `TRANSLATION` | `{ text, srcLang, tgtLang, ts }` |
| 0x0030 | S→C | `LLM_TOKEN` | `{ text, finish, tokenId }` |
| 0x0040 | S→C | `TTS_CHUNK` | `{ seq, codec, data, textRange }` |
| 0x0041 | S→C | `TTS_END` | `{ seq }` |
| 0x0050 | C→S | `BARGE_IN` | `{ ts }`（客户端主动打断） |
| 0x0051 | S→C | `INTERRUPTED` | `{ reason, abortedSeq }` |
| 0x0060 | C→S | `TTS_TEXT` | `{ text, ssml? }`（博客播放主动调用） |
| 0x0070 | S→C | `ERROR` | `{ code, message, fatal }` |
| 0x0071 | C→S | `PING` / S→C `PONG` | `{ ts }` |
| 0x0072 | C→S | `GOODBYE` | `{}` |

### 7.3 HELLO / 鉴权

```json
{
  "type": "HELLO",
  "auth": {
    "appId": "xxx",
    "token": "Bearer xxx",
    "userId": "u_123"
  },
  "mode": "voice_agent",      // voice_caption | voice_translate | voice_agent | s2s | tts
  "config": {
    "lang": "zh-CN",
    "asr": { "hotwords": ["豆包:99", "兜底:98"] },
    "llm": { "model": "doubao-pro", "systemPrompt": "..." },
    "tts": { "voice": "zh_female_vv_uranus_bigtts", "speed": 1.0, "emotion": "warm" }
  }
}
```

### 7.4 WebRTC 通道映射

- **Media Track**（Opus 48k/24k）：双向音频
- **DataChannel** `control`：上面所有 0x00xx 事件（除音频外的所有控制/文本/字幕）
- **关键事件映射到 DataChannel**：`ASR_PARTIAL`、`LLM_TOKEN`、`BARGE_IN`、`INTERRUPTED`

### 7.5 小程序特殊帧

小程序 `wx.sendSocketMessage` 限制单帧 ≤ 16KB，PCM 16k 16bit 每秒 32KB，所以 **必须 100ms 分片（3.2KB/帧）**。协议层自动按此分片，对 SDK 上层透明。

---

## 8. 端侧三件套

### 8.1 AudioCapture（采集）

**目标**：在 AudioWorklet 中产出 **16kHz / 16bit / 单声道 PCM**，并按 100ms 切帧（3200 字节）。

```ts
// capture-processor.ts (AudioWorklet)
class CaptureProcessor extends AudioWorkletProcessor {
  private targetRate = 16000;
  private bufferSize = 1600; // 100ms @ 16k
  private buffer: Float32Array[] = [];
  private resampler: LibSampleRate | null = null;

  async process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // 1. 重采样 (浏览器 ctx 48k → 16k)
    const resampled = this.resampler?.full(input) ?? input;
    // 2. Float32 → Int16
    const pcm16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    // 3. 累积分片，凑齐 100ms 上行
    // ... (实际更常用 ring buffer 维护跨 quantum 的样本)
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
```

**要点**：
- ✅ 使用 **AudioWorklet** 而非 `ScriptProcessor`（主线程不卡顿）
- ✅ 使用 **libsamplerate-js** 做高质量 sinc 重采样（97dB 阻带）
- ✅ 浏览器 `AudioContext` 的 sampleRate 不可信（多 ctx 同 tab 互踩），**必须自重采样**
- ✅ Float32 → Int16 必须 clamp + symmetric 缩放
- ✅ AEC 使用 `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })` — **AGC 关闭**，否则 AI 声音会反复"被听见"

### 8.2 AudioPlayback（播放）

**目标**：流式 TTS/S2S 音频无拼接播放，支持打断。

```ts
class StreamPlayer {
  private ctx: AudioContext;
  private nextPlayTime = 0;
  private bufferAheadSec = 0.05;

  enqueue(pcm16: Int16Array, sampleRate: number) {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buffer = this.ctx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now + this.bufferAheadSec;
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  interrupt() {
    // 停止所有调度中的 source
    this.scheduledSources.forEach(s => { try { s.stop(); } catch {} });
    this.scheduledSources.clear();
    this.nextPlayTime = 0;
    // 清空网络队列
    this.networkQueue.length = 0;
  }
}
```

**要点**：
- ✅ 用 `AudioBufferSourceNode.start(t)` 时间线调度，**而非 `play()` 即时**
- ✅ `nextPlayTime` 游标确保首尾相接，零拼接噪声
- ✅ 50~100ms 起始缓冲，吸收网络抖动
- ✅ 落后超过 100ms 主动重置游标（防止"加速追赶"）

### 8.3 VAD（人声活动检测）

**双层 VAD**：
1. **客户端轻量 VAD**（能量 + 过零率 + 简易 ML）：用于**打断响应**（< 50ms 内决定停 TTS）
2. **服务端精准 VAD**（基于 ASR 内置）：用于**句子切分 / 端点检测**（准确切句）

```ts
// 简化版能量 VAD
class EnergyVAD {
  private threshold = 0.02;
  private silenceMs = 0;
  private speaking = false;

  feed(pcm16: Int16Array): 'speech_start' | 'speech_end' | 'continue' {
    let sum = 0;
    for (let i = 0; i < pcm16.length; i++) sum += pcm16[i] * pcm16[i];
    const rms = Math.sqrt(sum / pcm16.length) / 32768;

    if (rms > this.threshold) {
      this.silenceMs = 0;
      if (!this.speaking) { this.speaking = true; return 'speech_start'; }
      return 'continue';
    } else {
      this.silenceMs += (pcm16.length / 16000) * 1000;
      if (this.speaking && this.silenceMs > 500) {
        this.speaking = false; return 'speech_end';
      }
    }
    return 'continue';
  }
}
```

**端点检测（Endpointing）算法**：
- 服务端基于 ASR partial 置信度 + 静音时长 + 语义补全
- 折中：**静音 500~800ms 视为说完了**（过短会切碎，过长会让用户等）

---

## 9. 状态机

### 9.1 会话状态机

```
       ┌──────────┐  HELLO  ┌──────────┐  异常  ┌──────────┐
       │   IDLE   │ ──────→ │CONNECTED│ ─────→ │ RECONNECT│
       └──────────┘         └─────┬────┘        └─────┬────┘
            ▲                      ▼ GOODBYE          │
            │                ┌──────────┐             │ 重试 3 次
            └────────────────│ CLOSED   │←────────────┘
                             └──────────┘   失败
```

### 9.2 语音交互状态机（核心）

```
            用户停嘴/AI 说完
   ┌─────────┐ ←──────┐  LLM end  ┌─────────┐
   │LISTENING│         │─────────│  IDLE   │ ←── 会话开始
   │ 用户说话│         │          │ 待唤醒  │
   └────┬────┘         │          └────┬────┘
        │              │               │ 用户开麦
   VAD  │              │               │
   检测 │              │               ▼
        ▼              │          ┌─────────┐
   ┌──────────┐        │          │CAPTURING│
   │CAPTURING │        │          │ 录音中   │
   │ 持续录音  │        │          └────┬────┘
   └────┬─────┘        │               │ 用户停嘴
        │              │               │ 端点检测
        │ ASR final    │               ▼
        ▼              │         ┌─────────┐
   ┌──────────┐        │         │ THINKING│
   │ TRANS-   │        │         │  LLM    │
   │CRIBING   │        │         └────┬────┘
   │ ASR 中   │        │              │ 首个 token
   └────┬─────┘        │              ▼
        │ ASR final    │         ┌─────────┐
        ▼              │         │  TTS_   │
   ┌──────────┐        │         │STREAMING│ ←──────────┐
   │THINKING  │────────┘         │ 边合成  │             │
   │ (LLM)    │                  │ 边播放  │ 用户打断 BARGE_IN
   └────┬─────┘                  └────┬────┘             │
        │ 首个 token                  │ TTS end / 打断    │
        ▼                             ▼                   │
   ┌────────────────────────────────────────┐             │
   │     TTS_STREAMING (AI 说话中)            │─────────────┘
   │  - 用户再次说话 → 触发 BARGE_IN
   │  - 用户说完 → 回到 LISTENING
   └────────────────────────────────────────┘
```

### 9.3 状态机实现（XState 风格伪代码）

```ts
const voiceAgentMachine = createMachine({
  id: 'voice',
  initial: 'idle',
  states: {
    idle: { on: { START: 'listening' } },
    listening: {
      on: {
        VAD_SPEECH_START: 'capturing',
        ASR_PARTIAL: { actions: 'updatePartial' }
      }
    },
    capturing: {
      on: {
        ASR_FINAL: { target: 'thinking', actions: 'commitTranscript' },
        SILENCE_TIMEOUT: { target: 'thinking' }
      }
    },
    thinking: {
      on: {
        LLM_FIRST_TOKEN: { target: 'speaking', actions: 'ttsStart' },
        LLM_END: 'listening'
      }
    },
    speaking: {
      on: {
        BARGE_IN: { target: 'listening', actions: 'ttsStop' },
        TTS_END: 'listening'
      }
    }
  }
});
```

### 9.4 打断（Barge-in）流程

```
T1: 用户开始说话
T1+10ms: 客户端 VAD 检测到人声
T1+20ms: 客户端发送 BARGE_IN 帧给服务端
T1+50ms: 客户端本地 stop 所有 AudioBufferSourceNode、清空播放队列
T1+80ms: 服务端收到 BARGE_IN → 取消 TTS / LLM → 回 INTERRUPTED
T1+100ms: 客户端开始 CAPTURING 用户新输入
```

**关键：客户端先本地停，再等服务端确认（避免 AI 音频继续从耳机出来）。**

---

## 10. 延迟预算与极致优化策略

> **核心思想**：1ms 都不能浪费。每个阶段都要问"为什么是这个数字"，并且**用代码 / 配置证明它**。

### 10.1 极致延迟预算表

#### A. 级联架构（ASR + LLM + TTS）—— P50 ≤ 600ms

| # | 阶段 | 旧版 | **极致版** | 关键优化 |
|---|---|---|---|---|
| 1 | 用户说话 → 客户端捕获 | 30ms | **10ms** | AudioWorklet 零延迟捕获，60ms frameSize |
| 2 | 编码 + 上行 (WebRTC) | 30ms | **15ms** | Opus 16k 硬件编码，UDP 直出 |
| 3 | 网络 RTT (同 Region) | 30ms | **10ms** | 边缘节点 + 专线 + QUIC |
| 4 | ASR 首个分片返回 | 250ms | **80ms** | 流式 ASR + 增量解码 + 60ms 触发 |
| 5 | 端点检测（边说边判） | 200ms | **100ms** | 服务端 VAD + 客户端 VAD 协同 |
| 6 | LLM 推测首字（SPECULATIVE） | 250ms | **100ms** | 小模型猜测 + 大模型覆盖（并行） |
| 7 | LLM 首句（TTFS） | 100ms | **40ms** | Short system + 缓存 + 短句约束 |
| 8 | TTS 首包（首音） | 300ms | **120ms** | 双向流 TTS + 预热 + 短文本优 |
| 9 | 音频下行 + 解码 + 播放 | 50ms | **30ms** | Web Audio 调度 + 解码前置 |
| 10 | 用户耳膜 | — | **5ms** | 耳机 / 扬声器 |
| | **总计 E2E** | **1.21s** | **≤ 600ms** | **-50%** |

> **600ms 怎么凑出来的**：每阶段都压到 100ms 以内。最大头是 ASR(80) + LLM(100+40) + TTS(120) ≈ 340ms，加上传输/编解码 ~260ms。**任何阶段 > 120ms 就是优化点**。

#### B. 端到端 S2S（豆包式）—— P50 ≤ 350ms

| # | 阶段 | **极致版** | 关键优化 |
|---|---|---|---|
| 1 | 客户端捕获 + 编码 | 10ms | 同上 |
| 2 | WebRTC 上行 | 15ms | UDP 直传 |
| 3 | 网络 RTT | 10ms | 同 Region |
| 4 | S2S 模型推理（含 ASR 隐式） | **200ms** | **端到端模型，无中间文本** |
| 5 | 音频流下行 | 30ms | WebRTC 媒体轨 |
| 6 | 解码 + 播放 | 30ms | 同上 |
| 7 | 耳膜 | 5ms | — |
| | **总计 E2E** | **≤ 350ms** | 对标豆包 / Moshi |

#### C. ASR 转写（"听到→看见"）—— P50 ≤ 200ms

| # | 阶段 | **极致版** |
|---|---|---|
| 1 | 捕获 | 10ms |
| 2 | 上行 | 15ms |
| 3 | ASR 推理 | **120ms** |
| 4 | 渲染到屏幕 | **5ms** |
| | **总计** | **≤ 200ms** |

#### D. TTS 朗读（"选中文字→听见"）—— P50 ≤ 180ms

| # | 阶段 | **极致版** |
|---|---|---|
| 1 | 文本发送 | 5ms |
| 2 | TTS 推理 | **100ms** |
| 3 | 音频下行 | 30ms |
| 4 | 播放 | 30ms |
| | **总计** | **≤ 180ms** |

### 10.2 极致优化 12 把利刃

| # | 优化 | 收益 | 极限实现 |
|---|---|---|---|
| 1 | **流式一切** | -1~2s | ASR / LLM / TTS 全部流式，无 batch 等待 |
| 2 | **边缘节点 + QUIC** | -100~200ms | GSLB 调度，最近 POP，QUIC 0-RTT |
| 3 | **WebRTC + Opus** | -50~100ms | UDP 媒体 + 内置 FEC + Jitter buffer 自适应 |
| 4 | **60ms 极小分片** | -100~200ms | 100ms → 60ms（牺牲 30% 带宽换 40ms 延迟） |
| 5 | **预热 / 预连接** | -100~300ms | 页面进入即建连 + 模型预热 + 预拉首包 |
| 6 | **客户端 VAD 触发打断** | -200~500ms | < 50ms 本地决定 |
| 7 | **句子级 TTS 预触发** | -200~400ms | LLM 第一个句号即推 TTS |
| 8 | **SPECULATIVE 推测执行** | -100~200ms | 小模型先出，大模型并行覆盖 |
| 9 | **PIPELINE PARALLEL** | -200~400ms | ASR partial 时已开始 LLM 召回 + TTS 预合成 |
| 10 | **端到端 S2S 模型** | -300~500ms | 跳过中间文本，无级联误差 |
| 11 | **模型量化 + 蒸馏** | -100~200ms | INT8 / AWQ / Gemma-2B 本地 |
| 12 | **音频解码前置** | -50~100ms | Worker 线程预解码 + Ring Buffer |

### 10.3 极致优化核心模式

#### 10.3.1 推测执行（Speculative Decoding）

> LLM 不等用户说完就开始"猜"回复，猜对了 = 提前 200ms。

```
用户输入: "今天北京天气怎么样"
                ↓
          ASR 流式识别 partial
                ↓
        ┌─────────────────────┐
        │  小模型 (Gemma 2B)  │  ← 100ms 出"今天北京天气晴..."
        │  先猜回复             │
        └────────┬────────────┘
                 ↓
        ┌─────────────────────┐
        │  大模型 (Qwen 72B)  │  ← 600ms 出最终回复，并行
        └────────┬────────────┘
                 ↓
        验证小模型猜测 → 用大模型
        若小模型对了 → 提前 400ms 输出
```

实现：用 `n-gram` 匹配 + 编辑距离验证，命中率 30~50% 时显著加速。

#### 10.3.2 管道并行（Pipeline Parallelism）

> ASR partial 出现时，**不等 final** 已经开始 LLM 召回。

```
T=0:   用户开始说话
T=100: ASR partial "今天" ─┐
T=200: ASR partial "今天北" ─┤  LLM 已开始基于 partial 思考
T=300: ASR partial "今天北京" ─┤
T=400: ASR final "今天北京天气" ─┘
        LLM 此时已"预热" 200ms，TTFT 减半
T=500: LLM TTFT
T=600: TTS 首包
T=700: 用户听见
```

#### 10.3.3 TTS 双向流 + 预热

```python
# 持久化 TTS 连接 + 预热
class TTSSession:
    def __init__(self):
        self.ws = None
        self.warmup()
    
    def warmup(self):
        """预热：发一个空请求让模型准备好"""
        self.ws.send({"text": " ", "warmup": True})
        # 模型 GPU 上下文已加载，下次请求首包 < 80ms
    
    def synthesize(self, text):
        """合成"""
        # 因为连接复用 + 预热，首包 80~120ms
        ...
```

#### 10.3.4 边缘 LLM 推理

> 把 LLM 部署到**离用户最近的边缘 GPU**（每 50~200km 一个），省 100~150ms 网络。

```
普通部署: 用户 → 中心 LLM (RTT 100ms)
边缘部署: 用户 → 边缘 LLM (RTT 5ms)
节省: 95ms × 2 (双向) = 190ms
```

#### 10.3.5 AudioWorklet 零延迟捕获

```ts
// 60ms frameSize（不是 100ms）= 16k * 0.06 = 960 samples
// 端上 bufferSize 128 (约 2.7ms @ 48k) 最低硬件限制
class FastCapture extends AudioWorkletProcessor {
  process(inputs) {
    const chunk = inputs[0][0];   // 128 samples ≈ 2.7ms
    this.port.postMessage(this.encode(chunk));
    return true;  // 不等
  }
}
```

### 10.4 首包加速（Time To First Audio）

```ts
function* segmentBySentence(tokenStream) {
  let buf = '';
  // 中英文混合句末标点（含停顿词）
  const END = /[。！？!?\.\n]|[啊呢吧嘛](?=\s|$)/;
  for (const tok of tokenStream) {
    buf += tok;
    // 触发条件：句末符号 OR 长度 > 12 OR LLM 停顿 > 200ms
    if (END.test(buf) || buf.length > 12) {
      yield buf;
      buf = '';
    }
  }
  if (buf) yield buf;
}
```

> TTS 在 LLM 输出 12 个字时就触发，**首音比"等完整句"快 200~400ms**。

### 10.5 自适应缓冲（Adaptive Jitter Buffer）

```ts
// 根据网络抖动动态调整播放缓冲
class AdaptiveBuffer {
  private targetLatencyMs = 60;   // 目标缓冲
  private maxLatencyMs = 200;
  private minLatencyMs = 20;
  
  feed(arrivalTimeMs: number, audioDurationMs: number) {
    const networkJitter = this.measureJitter();
    
    if (networkJitter > 80) {
      this.targetLatencyMs = Math.min(this.maxLatencyMs, this.targetLatencyMs + 20);
    } else if (networkJitter < 20) {
      this.targetLatencyMs = Math.max(this.minLatencyMs, this.targetLatencyMs - 10);
    }
    // ...调度逻辑
  }
}
```

### 10.6 性能对照矩阵

| 维度 | 旧版（保守） | **极致版** | 行业最佳 | 我们目标 |
|---|---|---|---|---|
| ASR 首字 P50 | 250ms | **80ms** | 100~200ms（豆包） | **80ms** |
| LLM TTFT P50 | 250ms | **100ms** | 200~400ms | **100ms** |
| TTS 首音 P50 | 300ms | **120ms** | 200~300ms | **120ms** |
| E2E 级联 P50 | 1200ms | **600ms** | 800~1200ms | **600ms** |
| E2E S2S P50 | 530ms | **350ms** | 200~500ms（豆包） | **350ms** |
| 打断 P50 | 200ms | **100ms** | 200~400ms | **100ms** |
| 可用性 | 99.9% | **99.95%** | — | **99.95%** |

> **对标结论**：极致版与豆包 / Moshi 同量级，**级联架构做到 S2S 同等体验**。

---

## 11. 降级与容错

### 11.1 分级降级

```
L0: WebRTC + 流式 ASR + 顶级 TTS + 顶级 LLM    (默认)
  └ 网络劣化/失败 ↓
L1: WebRTC + 降级 TTS                          (网络差但未断)
  └ 持续失败 ↓
L2: WebSocket + Opus + 同 L1                   (WebRTC 不可用)
  └ 持续失败 ↓
L3: WebSocket + MP3 + 简短回复                  (弱网/小程序)
  └ 持续失败 ↓
L4: 文字模式（仅 LLM）                          (无法录音)
  └ 服务挂 ↓
L5: 兜底回复（"网络不太给力，重试一下"）          (全挂)
```

### 11.2 重连策略

- 指数退避：`1s, 2s, 4s, 8s, 16s, 30s (max)`
- 上限：3 次自动重连 + 1 次手动按钮
- 重连后：恢复会话上下文（短期记忆），用 `resumeSession` 续传

### 11.3 容错清单

| 场景 | 兜底 |
|---|---|
| ASR 失败 | 重试 1 次 → 切备份 ASR 厂商 → 转文字模式 |
| LLM 失败 | 切更小模型 → 切预置 FAQ |
| TTS 失败 | 用浏览器 SpeechSynthesis API（质量低）|
| WebRTC 失败 | 切 WebSocket |
| 网络断 | 缓冲最后 1s 音频，重连后补传 |
| AI 长时间无响应 | UI 显示"AI 思考中" + 兜底文案 |
| 设备权限拒绝 | 提示 + 跳转设置 |
| 多端冲突（同账号）| 后接管先 / 互踢可配置 |

### 11.4 客户端缓冲与重传

```ts
// 上行：维护一个 1s 滑动窗口的发送队列
class SendQueue {
  private queue: Frame[] = [];
  private ackedSeq = 0;

  send(frame: Frame) {
    this.queue.push(frame);
    this.transport.send(frame);
    setTimeout(() => {
      if (this.queue.find(f => f.seq > this.ackedSeq)) {
        // 1s 内未确认 → 重传
        this.retransmit();
      }
    }, 1000);
  }

  ack(seq: number) { this.ackedSeq = Math.max(this.ackedSeq, seq); }
}
```

> **生产经验**：弱网下丢包率 5~15% 是常态，必须有 NACK + 重传机制。

---

## 12. 可观测、日志、追踪

### 12.1 全链路 Trace

每个会话一个 `traceId`，贯穿 Mic → Edge → Gateway → ASR → LLM → TTS → Spk。

```
traceId: "vt_20260619_abc123"
  ├─ span: capture (客户端)
  ├─ span: ws.send_audio_frame
  ├─ span: asr.first_partial   @ t=240ms
  ├─ span: asr.final           @ t=720ms
  ├─ span: llm.first_token     @ t=940ms
  ├─ span: tts.first_audio     @ t=1280ms
  └─ span: play.first_sample   @ t=1330ms
```

### 12.2 关键指标（Metrics）

```
# 客户端
voice_capture_buffer_ms       # 采集缓冲
voice_upload_rtt_ms           # 上行 RTT
voice_asr_first_partial_ms    # ASR 首字
voice_llm_ttft_ms             # LLM TTFT
voice_tts_ttfa_ms             # TTS 首音
voice_e2e_ms                  # 端到端
voice_bargein_ms              # 打断响应
voice_playback_gap_ms         # 播放卡顿

# 服务端
voice_active_sessions
voice_asr_qps / concurrent
voice_llm_tokens_per_sec
voice_tts_chars_per_sec
voice_asr_error_rate
voice_tts_error_rate
voice_network_jitter
```

### 12.3 日志规范

```json
{
  "ts": "2026-06-19T16:09:00.123Z",
  "traceId": "vt_xxx",
  "sessionId": "s_xxx",
  "userId": "u_xxx",
  "stage": "asr",
  "event": "first_partial",
  "latencyMs": 240,
  "meta": { "model": "volc-asr-v2", "codec": "opus" }
}
```

### 12.4 录音留档

按合规要求（金融/医疗/教育）保存：
- 原始音频（加密存储） + 转写文本
- 留存期 90 天 ~ 1 年
- 用户可主动删除（GDPR 合规）
- 抽检率 1~5% 用于 ASR/TTS 质量监控

---

## 13. 安全、合规与风控

### 13.1 传输与存储

- **全链路 TLS 1.3**（WebRTC DTLS-SRTP + WSS）
- **音频加密**（敏感行业：可选 E2E 加密）
- **存储加密**：OSS/COS 加密 + 访问审计

### 13.2 鉴权

```
短令牌（10min TTL）→ 设备指纹 + userId + IP
  ↓
WebRTC 临时 ICE 凭证
  ↓
数据通道鉴权（subprotocol: 'voice-v1'）
```

### 13.3 风控

| 维度 | 措施 |
|---|---|
| 内容 | LLM 输出经风控层（涉政/涉黄/广告） |
| 音频 | 实时流过 ASR 同时进风控 ASR（旁路） |
| 行为 | 频率限制、设备指纹、黑名单 |
| 隐私 | 用户可关闭录音留档 / 申请删除 |

### 13.4 法规

- **中国**：生成式 AI 服务备案（算法备案）、深度合成标识
- **欧盟 GDPR**：明示同意、可删除、数据可携
- **美国**：CCPA、各州录音法（双方/单方同意）
- **行业**：HIPAA（医疗）、PCI（金融）

---

## 14. 成本与配额

### 14.1 单次会话成本估算（级联）

| 项 | 单价 | 一次 1min 会话 | 备注 |
|---|---|---|---|
| ASR | ¥0.0014/秒 | ¥0.084 | 火山/讯飞 |
| LLM | ¥0.0008/千 token | ¥0.03 | 输入输出各 500 tok |
| TTS | ¥0.0002/字符 | ¥0.06 | 300 字回复 |
| RTC | ¥0.99/千分钟 | ¥0.001 | 边缘 |
| **合计** | | **~¥0.18/次** | |

### 14.2 端到端 S2S 成本

- 豆包 S2S：约 ¥0.6 ~ ¥1.2 / 分钟（高于级联 5~10 倍）
- OpenAI gpt-realtime：约 $0.06 ~ $0.24 / 分钟

### 14.3 配额策略

- 免费用户：10 分钟/天
- 付费用户：无限 + 优先通道
- 企业用户：独享 LLM/TTS 实例（合规 + 稳定）

---

## 15. 分阶段落地与里程碑

### Phase 0：技术选型与 PoC（2~3 周）

- [ ] ASR / TTS / LLM 厂商 POC（≥ 2 家对比）
- [ ] WebRTC SFU 自建 vs 托管（LiveKit/声网/即构）
- [ ] 小程序录音限制实测
- [ ] 端到端延迟基线测量

### Phase 1：MVP 单一形态（4~6 周）

- [ ] 选定 1 条业务线（如实时转写）
- [ ] 端到端跑通 WebSocket + 流式 ASR
- [ ] 基础 UI（字幕 + 状态）
- [ ] 监控 + 日志

### Phase 2：多形态 + 端侧 SDK（6~8 周）

- [ ] 翻译转写 / TTS 博客播放
- [ ] Voice SDK 抽象
- [ ] H5 / PC / 小程序三端适配
- [ ] WebRTC 主链路

### Phase 3：Voice Agent / S2S（8~12 周）

- [ ] 级联 ASR+LLM+TTS
- [ ] 打断 / 状态机 / 续说
- [ ] 豆包 S2S 接入
- [ ] 工具调用 / RAG

### Phase 4：生产化（4~6 周）

- [ ] 边缘节点部署
- [ ] 全链路监控
- [ ] 容灾演练
- [ ] 安全合规审计
- [ ] 文档 + 团队培训

---

## 17. 面试回答模板（极致版）

### 17.1 一句话定义

> 我设计的方案是"**输入输出解耦 + 统一边缘接入 + 协议无关网关 + 流式级联编排 + 极致管道并行**"——输入支持**用户语音/文字/文件**,输出支持**设备语音 + 设备文字(字幕) + 双语字幕 + 震动**,自由组合;对标豆包和 Moshi,级联架构做到 **P50 ≤ 600ms / 端到端 S2S ≤ 350ms**;覆盖 H5/PC/小程序三端,WebRTC↔WebSocket 自动降级。

### 17.2 三分钟版

> 业务上我们有 7 个产品形态(实时转写、翻译转写、语音交互、S2S、博客播放、字幕翻译、混合输出),核心设计是**把"输入"和"输出"解耦为两条独立通道**:输入可以是 mic(连续/PTT/唤醒)、文字、文件,输出可以是设备语音、设备文字字幕、双语字幕、震动——业务自由组合。
>
> 技术架构:
> 1. 客户端 **Voice SDK** 自动选择 WebRTC(UDP+Opus+FEC)或 WebSocket,60ms 极小分片
> 2. **Edge Gateway** 边缘节点就近接入(同 Region 5~10ms RTT)+ QUIC 0-RTT
> 3. **Voice Gateway** 协议转换 + 鉴权 + 路由,业务侧无感
> 4. 后端是**流式 + 管道并行**编排:ASR 流式 → VAD/端点边判边触发 → LLM TTFT 100ms → 句子级切分 → TTS 双向流首音 120ms
> 5. **极致优化**:**Speculative 推测执行**(小模型先猜+大模型并行覆盖) + **Pipeline Parallel**(ASR partial 时已启动 LLM)+ **边缘 LLM 推理** + **AudioWorklet 零延迟**
> 6. 全链路 traceId,关键指标 ASR/TTFT/TTFA/E2E P50/P95 实时打点
>
> 关键数字(对标豆包/Moshi):
> - ASR 首字 80ms / 翻译首字 200ms
> - E2E 级联 600ms / 端到端 S2S 350ms
> - TTS 首音 120ms
> - 打断响应 100ms
> - 可用性 99.95%
>
> 小程序特殊处理:用 `wx.getRecorderManager` 的 `onFrameRecorded` 拿 PCM 分片,主线程做轻量 VAD,WebSocket 转发。
>
> 成本:级联 ¥0.18/次,端到端 S2S 高 5~10 倍,按业务混合使用。

### 17.3 追问回答要点

- **Q:用户语音输入,设备文字输出 / 语音输出怎么做?**
  > 见 §6。我们把"输入模式"和"输出模式"解耦成两条独立通道:
  > - **输入**:`mic_continuous` / `mic_push_to-talk` / `mic_wake_word` / `text_input` / `file_audio` / `mixed_input`
  > - **输出**:`voice_only` / `text_only` / `voice_with_caption` / `bilingual_caption` / `bilingual_voice` / `multi_device`
  > 业务侧用 `session.setInput()` 和 `session.setOutput()` 自由组合,SDK 自动检测设备能力(扬声器/屏幕/震动/蓝牙)启用对应通道。一个 Pipeline 可以跑出 7×10=70 种产品形态。

- **Q:性能怎么做到 600ms 内?**
  > 看 §10。**级联架构做到 S2S 同等体验**的关键是 4 把利刃:
  > 1. **SPECULATIVE 推测执行**:小模型(100ms)先猜回复,大模型(600ms)并行覆盖,命中即提前 400ms
  > 2. **PIPELINE PARALLEL**:ASR partial 出现即启动 LLM 召回,等 final 时 LLM 已"预热" 200ms
  > 3. **EDGE COMPUTING**:LLM/TTS 部署到离用户最近的边缘 GPU,省 95ms RTT × 2
  > 4. **END-TO-END S2S(可选升级)**:跳过中间文本,直接语音→语音,200ms 一气呵成
  > 加上 WebRTC + Opus + 60ms 极小分片 + 双向流 TTS + AudioWorklet 零延迟,每个阶段都压到 100ms 内。

- **Q:怎么处理打断?**
  > 客户端 VAD(< 50ms)→ 本地立刻 stop 所有 AudioBufferSourceNode + 清空队列 → 发 BARGE_IN 帧给服务端(20ms)→ 服务端 cancel LLM/TTS → 客户端 100ms 内进入新一次 CAPTURING。看 §9.4。

- **Q:为什么不用 S2S?**
  > 成本 5~10 倍、不可控、难定制音色、难做工具调用/RAG/记忆。**级联在中文场景下质量已接近**。我们把 S2S 作为**高净值场景**(情感陪伴/拟人对话)的可选升级,主链路走级联 + 极致优化,达到 600ms E2E,与 S2S 体感无差。

- **Q:小程序没 AudioWorklet 怎么办?**
  > 用 `RecorderManager.onFrameRecorded` 按 5KB 分片拿 PCM,主线程做轻量 VAD + 缓冲。**不上 WebRTC**,传输走 WebSocket + Opus(裸流)/PCM。**注意小程序后台会被限制 5s**,需要 `wx.setKeepScreenOn` + 后台音频类目。

- **Q:弱网怎么办?**
  > WebRTC 自带 FEC/Jitter/PLC + Opus 抗丢包;WebSocket 层加 NACK + 1s 重传 + 缓冲;切到更低比特率编码(16kbps);最终降级到**纯文字模式**(只用 LLM,无 ASR/TTS)。看 §11。

- **Q:怎么保证合规?**
  > 录音留档加密 + 用户可控删除 + 算法备案 + 风控旁路 ASR + LLM Guard 内容输出过滤 + 深度合成水印。看 §14。

- **Q:怎么评估做得好不好?**
  > 6 个北极星:
  > 1. **E2E P50 < 600ms**(对标豆包)
  > 2. **E2E P95 < 1000ms**
  > 3. **可用性 99.95%**
  > 4. **ASR 准确率 > 95%**(业务定制词)
  > 5. **打断成功率 > 99%**
  > 6. **CSAT > 4.5**
  > 日常用 traceId 抽检 1% 会话人工评测,每月与豆包/OpenAI 做相同测试集对照。

---

## 附录 A：Voice SDK 公共 API 设计（伪代码）

```ts
import { VoiceSDK } from '@company/voice-sdk';

const session = new VoiceSDK({
  endpoint: 'wss://voice.example.com/v1',
  auth: { appId, token },
  mode: 'voice_agent', // voice_caption | voice_translate | voice_agent | tts
  transport: 'auto',   // auto | webrtc | websocket
  config: { lang: 'zh-CN', voice: 'zh_female_warm' }
});

// 事件
session.on('asr.partial', ({ text }) => updateSubtitle(text));
session.on('asr.final',   ({ text }) => commitSubtitle(text));
session.on('translation', ({ text, lang }) => updateTranslation(text, lang));
session.on('llm.token',   ({ text }) => appendReply(text));
session.on('tts.start',   () => showSpeaking());
session.on('tts.end',     () => hideSpeaking());
session.on('error',       ({ code, message }) => toast(message));

// 控制
await session.start();            // 建链 + 开麦
session.pushText('...');          // TTS 主动推文（博客）
session.bargeIn();                // 主动打断
await session.stop();
```

## 附录 B：参考厂商

- **ASR**：火山引擎、讯飞、阿里达摩院、Deepgram、AssemblyAI
- **LLM**：豆包、Qwen、GLM、GPT-4o、Claude
- **TTS**：火山引擎（豆包）、讯飞、ElevenLabs、Cartesia、微软 Azure
- **S2S**：豆包实时语音、OpenAI gpt-realtime、Gemini Live、Moshi
- **RTC / SFU**：LiveKit、Daily、Pipecat、声网（Agora）、即构（ZEGO）、火山 RTC
- **开源框架**：Pipecat（Python）、LiveKit Agents、FastRTC、Vocode

## 附录 C：进一步阅读

- OpenAI Realtime API GA Docs：https://developers.openai.com/api/docs/guides/realtime-conversations
- LiveKit Agents：https://docs.livekit.io/agents/
- Pipecat：https://github.com/pipecat-ai/pipecat
- WebRTC for the Curious (免费书)
- 《Real-Time Voice AI in Production》（Daily.co Blog 2025）

---

> 配套子文档：
> - `voice-realtime-protocol.md`：协议与状态机细节
> - `voice-sdk-client.md`：客户端 SDK 详细设计（H5/PC/小程序）
> - `voice-backend-infra.md`：服务端与基础设施
> - `voice-observability-security.md`：可观测 / 容灾 / 安全
