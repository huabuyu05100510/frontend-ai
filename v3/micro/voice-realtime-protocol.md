# 实时语音交互：协议与状态机细节

> 主文档：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> 本篇聚焦：**统一网关协议 v1、状态机细节、关键事件流**。

---

## 1. 协议分层

```
┌─────────────────────────────────────────────────────┐
│  L5: 业务事件 (ASR_PARTIAL, LLM_TOKEN, TTS_CHUNK)   │  ← 业务侧只关心这层
├─────────────────────────────────────────────────────┤
│  L4: 帧协议 (Magic+Version+Type+Len+Payload)         │
├─────────────────────────────────────────────────────┤
│  L3: 传输层 (WebRTC DataChannel / WebSocket 二进制)  │
├─────────────────────────────────────────────────────┤
│  L2: 媒体 (Opus / PCM16)                              │
├─────────────────────────────────────────────────────┤
│  L1: 物理 (UDP/TLS/QUIC)                              │
└─────────────────────────────────────────────────────┘
```

**L5 是稳定接口**，L1~L4 可替换（WebRTC ↔ WebSocket）。

---

## 2. 帧协议二进制规范

### 2.1 头结构（11 字节）

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
├───────────────┬───────┬───────────────┬───────────────────────┤
│     Magic     │Ver    │     Type      │       Length          │
│   'VOIC'      │(1B)   │    (2B)       │        (4B)           │
└───────────────┴───────┴───────────────┴───────────────────────┘
```

- `Magic` = `0x564F4943`（ASCII "VOIC"）
- `Ver` = `0x01`
- `Type` = `uint16 BE`（见 §2.3）
- `Length` = `uint32 BE`，Payload 字节数
- `Payload` = `Length` 字节

### 2.2 帧示例

```
VOIC 01 0010 00000032
  └─ASR_PARTIAL (0x0010), 50 字节 payload
```

> 文本调试模式：JSON over Text，0x01 前缀，与二进制可并存（首字节 0x56 进二进制，其他进 JSON）。

### 2.3 Type 完整表

| Hex | 名称 | 方向 | Payload 格式 |
|---|---|---|---|
| 0x0001 | HELLO | C→S | JSON |
| 0x0002 | WELCOME | S→C | JSON |
| 0x0003 | RESUME | C→S | JSON（重连续传） |
| 0x0004 | RESUMED | S→C | JSON |
| 0x0010 | AUDIO_FRAME | C→S | `{ seq, ts, codec, data }`，data=base64 |
| 0x0011 | AUDIO_OUT | S→C | `{ seq, ts, codec, data }` |
| 0x0020 | ASR_PARTIAL | S→C | JSON |
| 0x0021 | ASR_FINAL | S→C | JSON |
| 0x0022 | TRANSLATION | S→C | JSON |
| 0x0023 | ASR_ERROR | S→C | JSON |
| 0x0030 | LLM_TOKEN | S→C | JSON |
| 0x0031 | LLM_TOOL_CALL | S→C | JSON |
| 0x0032 | LLM_END | S→C | JSON |
| 0x0040 | TTS_CHUNK | S→C | `{ seq, codec, data, textRange }` |
| 0x0041 | TTS_END | S→C | `{ seq }` |
| 0x0042 | TTS_ABORTED | S→C | `{ seq, reason }` |
| 0x0050 | BARGE_IN | C→S | `{ ts, audioSeq }` |
| 0x0051 | INTERRUPTED | S→C | `{ reason, abortedSeq }` |
| 0x0060 | TTS_TEXT | C→S | `{ text, ssml?, voice, speed }` |
| 0x0061 | TTS_TEXT_END | C→S | `{}`（博客播放完毕） |
| 0x0070 | ERROR | S→C | JSON |
| 0x0071 | PING | 双向 | `{ ts }` |
| 0x0072 | PONG | 双向 | `{ ts }` |
| 0x0073 | GOODBYE | 双向 | `{ reason }` |
| 0x0080 | METRIC | 双向 | `{ name, value, tags }`（内部打点） |

### 2.4 JSON Payload 详细 Schema

#### HELLO

```json
{
  "type": "HELLO",
  "version": "1.0",
  "auth": {
    "appId": "string",
    "token": "Bearer string",
    "userId": "string",
    "deviceId": "string"
  },
  "mode": "voice_caption | voice_translate | voice_agent | tts | s2s",
  "session": {
    "clientId": "uuid",
    "resumeFromSeq": 12345   // 重连时携带
  },
  "config": {
    "lang": "zh-CN",
    "asr": {
      "provider": "volc",
      "hotwords": [{ "word": "豆包", "weight": 99 }],
      "vad": { "silenceMs": 600, "minSpeechMs": 200 }
    },
    "translate": {
      "src": "zh", "tgt": "en",
      "provider": "volc_mt"
    },
    "llm": {
      "provider": "volc_ark",
      "model": "doubao-pro-32k",
      "systemPrompt": "你是友好的语音助手",
      "temperature": 0.7,
      "maxTokens": 800
    },
    "tts": {
      "provider": "volc",
      "voice": "zh_female_vv_uranus_bigtts",
      "speed": 1.0,
      "pitch": 0,
      "volume": 0,
      "emotion": "warm"
    },
    "audio": {
      "sampleRate": 16000,
      "codec": "opus",
      "frameMs": 100
    }
  }
}
```

#### WELCOME

```json
{
  "type": "WELCOME",
  "sessionId": "s_xxx",
  "serverTime": 1718789340123,
  "config": { /* 服务端调整后的最终配置 */ },
  "rateLimit": { "qps": 10, "concurrent": 3 }
}
```

#### ASR_PARTIAL

```json
{ "type": "ASR_PARTIAL", "text": "今天天气", "ts": 15230, "stable": false }
```

#### ASR_FINAL

```json
{
  "type": "ASR_FINAL",
  "text": "今天天气不错",
  "ts": 16230,
  "confidence": 0.97,
  "words": [
    { "text": "今天", "startMs": 14000, "endMs": 14500 },
    { "text": "天气", "startMs": 14500, "endMs": 15000 }
  ]
}
```

#### TRANSLATION

```json
{
  "type": "TRANSLATION",
  "srcLang": "zh",
  "tgtLang": "en",
  "text": "Nice weather today",
  "isFinal": true,
  "srcTs": 16230
}
```

#### LLM_TOKEN

```json
{ "type": "LLM_TOKEN", "text": "今天", "finish": false, "tokenId": 42, "ts": 17000 }
```

#### LLM_TOOL_CALL

```json
{
  "type": "LLM_TOOL_CALL",
  "name": "get_weather",
  "args": { "city": "北京" },
  "callId": "call_xxx"
}
```

#### TTS_CHUNK

```json
{
  "type": "TTS_CHUNK",
  "seq": 1,
  "codec": "pcm16",
  "sampleRate": 24000,
  "data": "<base64 PCM>",
  "textRange": [0, 2],
  "text": "今天"
}
```

#### TTS_TEXT

```json
{
  "type": "TTS_TEXT",
  "text": "今天天气不错",
  "ssml": "<speak>今天<break time='200ms'/>天气不错</speak>",
  "voice": "zh_female_warm",
  "speed": 1.0
}
```

#### BARGE_IN

```json
{ "type": "BARGE_IN", "ts": 18000, "audioSeq": 5400, "reason": "vad_speech_start" }
```

#### INTERRUPTED

```json
{
  "type": "INTERRUPTED",
  "reason": "user_barge_in | llm_cancel | tts_cancel | error",
  "abortedTtsSeq": 12,
  "abortedLlmTokenId": 80
}
```

#### ERROR

```json
{
  "type": "ERROR",
  "code": "ASR_TIMEOUT | LLM_RATE_LIMIT | TTS_AUTH_FAIL | NETWORK | INTERNAL",
  "message": "string",
  "fatal": false,
  "retryable": true,
  "retryAfterMs": 1000
}
```

---

## 3. 完整事件流（时序图）

### 3.1 实时转写（ASR Only）

```
客户端                   网关                   ASR
  │                       │                      │
  │──── HELLO ───────────>│                      │
  │<─── WELCOME ──────────│                      │
  │                       │──── 鉴权 + 路由 ────>│
  │                       │<───── 流式建连 ──────│
  │──── AUDIO_FRAME (100ms) ──>│ ────────────────>│
  │──── AUDIO_FRAME ─────>│ ────────────────>│
  │                       │<── ASR_PARTIAL ────│
  │<─── ASR_PARTIAL ──────│<──────────────────│
  │<─── ASR_PARTIAL ──────│<──────────────────│
  │──── AUDIO_FRAME ─────>│ ────────────────>│
  │                       │<── ASR_FINAL ──────│
  │<─── ASR_FINAL ────────│<──────────────────│
  │──── GOODBYE ──────────>│                      │
  │<─── GOODBYE ───────────│                      │
```

### 3.2 实时语音交互（Voice Agent）

```
客户端          网关        ASR       LLM       TTS
  │              │          │          │          │
  │─ HELLO ────>│          │          │          │
  │<─ WELCOME ──│          │          │          │
  │              │──init──>│          │          │
  │              │<─ready──│          │          │
  │              │          │          │          │
  │─ AUDIO ─────>│─────────>│          │          │
  │              │<─partial─│          │          │
  │<─ partial ───│          │          │          │
  │─ AUDIO ─────>│─────────>│          │          │
  │              │<─final──│          │          │
  │<─ final ─────│          │          │          │
  │              │── ASR out ──────>  │          │
  │              │          │          │          │
  │              │          │    LLM stream start  │
  │              │          │<─ token: "今天"      │
  │              │<─ LLM_TOKEN ──────│          │
  │<─ llm.token ─│          │          │          │
  │              │          │          │          │
  │              │── LLM out (句子级) ──────>    │
  │              │          │          │── TTS ──>│
  │              │<─ TTS_CHUNK #1 ──────────────│
  │<─ tts.chunk ─│          │          │          │
  │ (播放)        │          │          │          │
  │              │<─ TTS_CHUNK #2 ──────────────│
  │<─ tts.chunk ─│          │          │          │
  │              │          │          │          │
  │ 用户又开始说话 (VAD 触发)        │          │
  │─ BARGE_IN ──>│── cancel ───────>│── stop ──>│
  │ (本地 stop)  │<─ INTERRUPTED ──────────────│
  │<─ interrupted│          │          │          │
  │              │          │          │          │
  │ 回到 LISTENING           │          │          │
```

### 3.3 打断细节时序

```
时间轴(ms)   客户端                          服务端
─────────────────────────────────────────────────────────────
   0   用户开始说话
   5   VAD 检测 speech_start
  10   客户端立即 stop 所有 BufferSource
  20   客户端发 BARGE_IN 帧 ──────────────> 收到
  30   客户端清空本地 TTS 队列              cancel TTS
  40   客户端显示 "正在听..."               cancel LLM
  60                                       <─ INTERRUPTED
  70   客户端收到 INTERRUPTED
  80   客户端开始新一次 CAPTURING
 250   客户端发首个新 AUDIO_FRAME ─────────> 收到
```

**关键点**：客户端**先本地 stop**（10ms），再等服务端确认（60ms），保证无"AI 音频拖尾"。

### 3.4 博客播放 TTS

```
客户端                          服务端/TTS
  │                                │
  │─ TTS_TEXT "今天天气..." ────>│
  │─ TTS_TEXT "适合出门" ────────>│
  │─ TTS_TEXT_END ─────────────>│
  │<─ TTS_CHUNK #1 ─────────────│
  │   播放 chunk #1 + 高亮 "今天"  │
  │<─ TTS_CHUNK #2 ─────────────│
  │   播放 chunk #2 + 高亮 "天气"  │
  │<─ TTS_CHUNK #3 ─────────────│
  │<─ TTS_END ─────────────────│
```

---

## 4. 状态机（完整）

### 4.1 会话状态机

```
                  HELLO ok
    ┌──────┐  ───────────>  ┌──────────┐
    │ IDLE │                │CONNECTING│
    └──────┘                └─────┬────┘
       ▲                          │ WS / RTC 握手完成
       │                          ▼
       │                      ┌──────────┐
       │                      │CONNECTED │  ← 主状态
       │                      └────┬─────┘
       │                           │ GOODBYE / 主动断
       │ GOODBYE 完毕              ▼
       │                      ┌──────────┐
       └─────────────────────│ CLOSING  │
                              └────┬─────┘
                                   │ 资源回收
                                   ▼
                              ┌──────────┐
                              │ CLOSED   │
                              └──────────┘

    CONNECTED 内部异常:
       │                           │
       │ 异常断开                   │ 网络瞬断
       ▼                           ▼
   ┌──────────┐  重试 1-3 次   ┌──────────┐
   │  ERROR   │ ──────────────>│RECONNECTING│
   └──────────┘                └────┬──────┘
       ▲                            │ 失败 3 次
       │                            ▼
       └──────────────────────  ┌──────────┐
                                │ FAILED   │
                                └──────────┘
```

### 4.2 语音交互主状态机（Voice Agent）

```
                  start
    ┌──────┐  ───────────>  ┌──────────┐
    │ IDLE │                │ LISTENING│  待 VAD
    └──────┘                └────┬─────┘
       ▲                          │ speech_start
       │                          ▼
       │                      ┌──────────┐
       │                      │CAPTURING │  录音 + 上行
       │                      └────┬─────┘
       │                           │ ASR_FINAL | silence > 600ms
       │                           ▼
       │                      ┌──────────┐
       │                      │TRANSCRIB.│  ASR 流式收尾
       │                      └────┬─────┘
       │                           │ 句子已稳态
       │                           ▼
       │                      ┌──────────┐
       │                      │ THINKING │  LLM 调用
       │                      └────┬─────┘
       │                           │ 首 token / 首句
       │                           ▼
       │                      ┌──────────┐
       │                      │  TTS_    │
       │              ┌───────│STREAMING │←──────┐
       │              │        └────┬─────┘       │
       │              │             │ TTS end    │ BARGE_IN
       │              │ BARGE_IN    ▼             │
       │              │        ┌──────────┐       │
       │              │        │FINALIZING│ ──────┘
       │              │        └────┬─────┘
       │              │             │
       │              ▼             ▼
       │         ┌─────────────────────┐
       └─────────│  回 LISTENING / IDLE │
                 └─────────────────────┘
```

### 4.3 状态机实现关键

```ts
type VoiceState =
  | 'idle' | 'listening' | 'capturing' | 'transcribing'
  | 'thinking' | 'tts_streaming' | 'finalizing' | 'error';

interface VoiceContext {
  sessionId: string;
  asrPartial: string;
  asrFinal: string;
  llmBuffer: string;
  ttsQueue: TtsChunk[];
  currentTurn: number;
  lastBargeInAt: number;
  playbackCursor: number;
}

const transitions: Record<VoiceState, Partial<Record<Event, VoiceState>>> = {
  idle:           { START: 'listening' },
  listening:      {
    VAD_SPEECH_START: 'capturing',
    TTS_TEXT:         'tts_streaming'   // 博客播放走这条
  },
  capturing: {
    VAD_SPEECH_END:   'transcribing',
    ASR_FINAL:        'thinking',
    SILENCE_TIMEOUT:  'thinking'
  },
  transcribing: {
    ASR_FINAL:        'thinking'
  },
  thinking: {
    LLM_FIRST_TOKEN:  'tts_streaming',
    LLM_END:          'listening',
    LLM_TOOL_CALL:    'thinking'        // 等工具结果
  },
  tts_streaming: {
    TTS_END:          'listening',
    BARGE_IN:         'finalizing',
    LLM_TOKEN:        'tts_streaming'   // 继续合成
  },
  finalizing: {
    TTS_CLEAR_DONE:   'listening'
  },
  error: { RECOVERED: 'listening' }
};
```

### 4.4 子状态机

#### VAD 状态机

```
   ┌──────────┐  rms>thr   ┌──────────┐  silence>500ms  ┌──────────┐
   │  SILENT  │ ─────────> │ SPEAKING │ ───────────────>│  SILENT  │
   └──────────┘            └──────────┘                 └──────────┘
       ▲                        │
       │                        │ 短静音<200ms 抖动
       └────────────────────────┘  (保持 SPEAKING)
```

#### TTS 播放状态机

```
   ┌──────────┐  enqueue   ┌──────────┐  interrupt  ┌──────────┐
   │   IDLE   │ ─────────> │ PLAYING  │ ──────────> │ CLEARING │
   └──────────┘            └────┬─────┘             └────┬─────┘
       ▲                        │ end                    │
       │                        ▼                        │
       │                    ┌──────────┐                  │
       └────────────────────│   DONE   │<─────────────────┘
                            └──────────┘
```

---

## 5. 关键协议机制

### 5.1 序列号与去重

- 每个 AUDIO_FRAME 带 `seq`（自增 u32）
- 服务端维护滑动窗口，过滤乱序 / 重复
- 客户端 30s 内重传窗口（弱网）

### 5.2 ACK 与重传（WebSocket 通道）

```ts
// 客户端每 200ms 批量 ACK
{ "type": "META_ACK", "acks": [1001, 1002, 1003, ...] }

// 服务端 1s 内未收到 ACK → NACK
{ "type": "META_NACK", "from": 1001, "to": 1010 }  // 客户端重传
```

> WebRTC 走 RTCP NACK，无需在应用层实现。

### 5.3 心跳

```ts
// 每 10s 一次
// C → S: PING { ts: T1 }
// S → C: PONG { ts: T1 }
// C 收到时记录 RTT = now - T1
```

超时判定：
- 30s 无 PONG → 触发重连
- 服务端 60s 无任何帧 → 主动关闭

### 5.4 续传（Resume）

```json
// 客户端
{
  "type": "RESUME",
  "sessionId": "s_xxx",
  "lastClientSeq": 5400,
  "lastServerSeq": 3200,
  "context": { /* 短期记忆快照 */ }
}

// 服务端
{ "type": "RESUMED", "resumedFromSeq": 5400, "lost": [5380, 5390] }
```

客户端重传 `lost` 列表里的帧。

### 5.5 流量控制 / 背压

服务端监控客户端处理能力（基于 ACK 速率），动态调整：
- 上行降速：要求客户端降低采样率 / 增大分片
- 下行降速：减少 TTS 预合成数量 / 降低 LLM 速度

```json
// 服务端 → 客户端
{ "type": "FLOW_CTRL", "upKbps": 32, "downKbps": 64, "queue": 5 }
```

### 5.6 安全 / 鉴权

```
Token (短期 JWT, 10min TTL)
  ↓
  subprotocol: 'voice-v1'   ← WebSocket subprotocol
  ↓
  业务 token + session token 双重校验
  ↓
  每分钟签名挑战（防重放）
```

---

## 6. 错误码表

| Code | 含义 | 客户端处理 |
|---|---|---|
| `AUTH_INVALID` | 鉴权失败 | 重新登录 |
| `RATE_LIMIT` | 限流 | 退避后重试 |
| `ASR_TIMEOUT` | ASR 60s 无响应 | 切备份 ASR / 转文字 |
| `ASR_AUDIO_INVALID` | 音频格式错 | 重新初始化 |
| `LLM_CONTEXT_TOO_LONG` | 上下文超限 | 截断 / 总结 |
| `LLM_REFUSED` | LLM 拒绝回答 | 兜底文案 |
| `LLM_RATE_LIMIT` | LLM 限流 | 切小模型 |
| `TTS_AUTH_FAIL` | TTS 鉴权 | 切备份 TTS |
| `TTS_TEXT_TOO_LONG` | 文本超限 | 分段 |
| `TTS_QUOTA_EXCEEDED` | 配额用完 | 提示升级 |
| `NETWORK_DISCONNECT` | 断网 | 重连 |
| `INTERNAL` | 内部错误 | 重试一次后上报 |
| `MODE_MISMATCH` | 模式不匹配 | 重置 session |
| `CLIENT_PROTOCOL_ERROR` | 协议错 | 升级 SDK / 重置 |

### 重试策略

```ts
const retryableCodes = new Set([
  'RATE_LIMIT', 'ASR_TIMEOUT', 'LLM_RATE_LIMIT',
  'NETWORK_DISCONNECT', 'INTERNAL'
]);

if (retryableCodes.has(error.code) && error.retryable) {
  await delay(error.retryAfterMs ?? 1000 * Math.pow(2, attempt));
  await retry();
}
```

---

## 7. 兼容性矩阵

| 客户端版本 | 协议版本 | 支持模式 |
|---|---|---|
| ≥ 1.0.0 | v1.0 | 全部 |
| 0.9.x | v1.0 | 缺 S2S / 工具调用 |
| 0.8.x | v0.9 (JSON only) | 仅 ASR/TTS 文本 |

服务端兼容策略：双协议同时支持，老客户端用 v0.9，新客户端用 v1.0 二进制。

---

## 8. 协议版本演进

```
v1.0 (本版本)
  └─ 稳定, 已上线
v1.1 (规划)
  ├─ + 端到端加密帧 (E2EE)
  ├─ + 多模态 (视频帧)
  └─ + 高级 VAD 协商
v2.0 (未来)
  └─ 改用 Protobuf 替代 JSON (体积减半)
```

升级原则：**向后兼容**，新增字段用 optional；破坏性变更走 major 版本。

---

## 9. 调试与排错

### 9.1 抓包工具

- **WebRTC**：Chrome `chrome://webrtc-internals` + Wireshark
- **WebSocket**：Charles / Wireshark
- **小程序**：微信开发者工具 Network + 抓包到 Charles

### 9.2 调试日志

```ts
// SDK 开启 debug 模式
const sdk = new VoiceSDK({ debug: true });
// 输出每个帧到 console + 上报到分析服务
sdk.on('frame', (frame) => {
  console.debug('[voice]', frame.type, frame);
  analytics.track('voice_frame', { type: frame.type, size: frame.length });
});
```

### 9.3 回放工具

- 录制原始音频 + 录制服务端响应流
- 用内部工具"会话回放器"按真实时序重放
- 用于：bug 复现、模型评测、用户投诉核查

---

## 10. 与第三方协议对接

### 10.1 OpenAI Realtime

```ts
// 适配器: 我们的 v1 协议 ↔ OpenAI Realtime 事件
const adapter = {
  // 我们的 AUDIO_FRAME → OpenAI input_audio_buffer.append
  out: {
    '0x0010': (frame) => ({
      type: 'input_audio_buffer.append',
      audio: frame.data
    })
  },
  // OpenAI → 我们的
  in: {
    'input_audio_buffer.speech_started': () => ({ type: '0x0050', /* BARGE_IN */ }),
    'response.output_audio.delta': (e) => ({ type: '0x0040', data: e.delta })
  }
};
```

### 10.2 火山引擎 ASR/TTS 适配

```
我们的 v1 协议
  ↓ 适配层
  ↓
火山 ASR: wss://openspeech.bytedance.com/api/v2/asr
火山 TTS: wss://openspeech.bytedance.com/api/v3/tts/bidirection
```

适配层做：
- 二进制帧编解码（火山有自己的 Header+Payload 协议）
- 鉴权 (Bearer / HMAC 签名)
- 句子切分适配（火山 ASR 输出有"句子结束"事件）
- TTS 流式分片

### 10.3 豆包 S2S 适配

```
我们的 v1 协议
  ↓ 适配层
  ↓
豆包 S2S: 走火山 RTC + 火山方舟 S2S 模型
或直接对接豆包 WebSocket 大模型语音
```

---

## 11. 协议安全 / 防攻击

### 11.1 重放保护

```
每个非幂等帧带 monotonically increasing seq
服务端在 60s 窗口内拒绝重复 seq
```

### 11.2 速率限制

```ts
// 网关层
limit: { audio: 32kbps, frames: 100/s, msgs: 50/s }
```

### 11.3 注入防护

- 客户端发文本（TTS_TEXT）走另一鉴权路径，限频更低
- LLM 输出端做风控：长度限制、敏感词过滤、模型层 system guard

### 11.4 资源隔离

- 每个 session 独立 goroutine / actor
- 内存上限：单 session 不超过 100MB
- CPU 上限：单 session 推理排队

---

## 12. 协议性能开销

| 项 | 字节/帧 | 频率 | 带宽 |
|---|---|---|---|
| HELLO | ~1KB | 1/会话 | - |
| AUDIO_FRAME (Opus 16k) | ~200B | 10/s | 16kbps |
| ASR_PARTIAL | ~100B | 5/s | 4kbps |
| TTS_CHUNK (PCM 24k) | ~4KB | 10/s | 320kbps |
| 控制/元数据 | ~100B | 1/s | 1kbps |
| **下行总计** | | | **~340kbps** |
| **上行总计** | | | **~20kbps** |

> 客户端 SDK 应启用二进制协议（节省 30% 流量）+ 帧压缩（zstd/lz4 可选）。

---

## 13. 协议相关工具 / 资源

- **Protocol Buffers 定义**（未来 v2.0）：可用 `.proto` 文件描述
- **AsyncAPI**：用 AsyncAPI 规范描述异步事件
- **Wireshark 解析器**：可写 Lua 插件解析 v1 帧
- **Mock 服务端**：用于前端本地调试，开源 `voice-mock-server`

---

> 下一篇：[`voice-sdk-client.md`](./voice-sdk-client.md) — 客户端 SDK 详细设计
