# 实时语音交互：服务端与基础设施

> 主文档：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> 协议文档：[`voice-realtime-protocol.md`](./voice-realtime-protocol.md)
> 客户端文档：[`voice-sdk-client.md`](./voice-sdk-client.md)
> 本篇聚焦：**Voice Gateway、媒体流处理、ASR/LLM/TTS 编排、对话管理、基础设施、部署**。

---

## 1. 服务端总体架构

```
                           ┌─────────────────────────────────────┐
                           │        Load Balancer (L4/L7)        │
                           │   - TLS 终止                          │
                           │   - WebSocket 升级                    │
                           │   - GSLB 调度                         │
                           └─────────────────┬───────────────────┘
                                             │
              ┌──────────────────────────────┼──────────────────────────┐
              │                              │                          │
              ▼                              ▼                          ▼
   ┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
   │  Edge-Gateway    │          │  Edge-Gateway    │          │  Edge-Gateway    │
   │  (北京)          │          │  (上海)          │          │  (新加坡)        │
   │                  │          │                  │          │                  │
   │  - WebSocket 终端 │          │  - WebSocket 终端 │          │  - WebSocket 终端 │
   │  - WebRTC SFU    │          │  - WebRTC SFU    │          │  - WebRTC SFU    │
   │  - 鉴权/限流      │          │  - 鉴权/限流      │          │  - 鉴权/限流      │
   └────────┬─────────┘          └────────┬─────────┘          └────────┬─────────┘
            │                             │                             │
            └─────────────────────────────┼─────────────────────────────┘
                                          │ (gRPC/HTTP2 同 Region)
                                          ▼
              ┌────────────────────────────────────────────────────────┐
              │          Voice Gateway (核心)                           │
              │  - 协议适配 (WS / WebRTC / SSE)                         │
              │  - 会话管理 (Redis)                                    │
              │  - 路由 (ASR/LLM/TTS)                                  │
              │  - 业务编排                                            │
              │  - 句子切分 / 端点检测                                  │
              └──────┬────────────┬─────────────┬──────────────┬───────┘
                     │            │             │              │
                     ▼            ▼             ▼              ▼
            ┌───────────┐  ┌───────────┐ ┌───────────┐ ┌──────────────┐
            │ ASR 集群   │  │ LLM 集群   │ │ TTS 集群   │ │ 业务/工具     │
            │ (流式)     │  │ (流式)     │ │ (流式)     │ │  RAG / Agent  │
            └───────────┘  └───────────┘ └───────────┘ └──────────────┘
                     │            │             │              │
                     └────────────┴─────────────┴──────────────┘
                                          │
                                          ▼
                            ┌──────────────────────────┐
                            │  旁路 (Sidecar)            │
                            │  - 录音存储 (合规)         │
                            │  - 风控 (ASR旁路 + LLM过滤)│
                            │  - 监控 / Trace / Log     │
                            │  - 评测 (ASR/TTS抽检)     │
                            └──────────────────────────┘
```

---

## 2. Edge Gateway 设计

### 2.1 职责

| 职责 | 说明 |
|---|---|
| **协议接入** | WebSocket / WebRTC / SSE 三协议 |
| **TLS 终止** | 统一证书管理 |
| **会话管理** | sessionId 分配、心跳、断线检测 |
| **鉴权** | 短令牌校验、用户态查询 |
| **限流** | QPS / 并发 / 带宽 |
| **流量调度** | 灰度、A/B、路由 |
| **可观测** | 接入打点、错误上报 |

### 2.2 技术选型

| 维度 | 选型 | 理由 |
|---|---|---|
| 语言 | **Go** (主) + Rust (热点) | Go 生态成熟，并发好；Rust 极致性能 |
| WebSocket | `gorilla/websocket` 或 nhooyr.io/websocket | 高并发，零拷贝升级 |
| WebRTC | **Pion** (Go) / LiveKit (Go) | 自建 SFU 灵活，托管省心 |
| RPC | gRPC + Protocol Buffers | 高性能、强类型 |
| 序列化 | JSON / Protobuf (二选一) | JSON 调试友好，Proto 性能好 |
| 配置中心 | Nacos / Apollo | 动态路由、灰度 |
| 注册中心 | Consul / Nacos | 服务发现 |

### 2.3 核心代码骨架

```go
// edge-gateway/main.go
package main

import (
    "github.com/gorilla/websocket"
    "github.com/pion/webrtc/v3"
    "net/http"
)

func main() {
    // 1. HTTP 升级 WebSocket
    http.HandleFunc("/v1/ws", handleWebSocket)
    // 2. WebRTC 信令
    http.HandleFunc("/v1/rtc", handleWebRTC)
    // 3. SSE (TTS 单向)
    http.HandleFunc("/v1/tts/stream", handleTTSStream)
    // 4. 健康检查
    http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })

    log.Fatal(http.ListenAndServeTLS(":443", "cert.pem", "key.pem", nil))
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
    // 1. 升级
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil { return }
    defer conn.Close()

    // 2. 鉴权
    token := r.URL.Query().Get("token")
    if !authenticate(token) {
        conn.WriteJSON(Error{Code: "AUTH_INVALID"})
        return
    }

    // 3. 创建会话
    session := voiceSessionPool.Acquire(r.Context())
    defer voiceSessionPool.Release(session)

    // 4. 协议循环
    for {
        frame, err := readFrame(conn)
        if err != nil { return }

        switch frame.Type {
        case TypeHELLO:
            session.OnHello(frame.Payload)
        case TypeAUDIO_FRAME:
            session.OnAudioFrame(frame.Payload)  // → ASR
        case TypeBARGE_IN:
            session.OnBargeIn()
        case TypePING:
            conn.WriteFrame(TypePONG, frame.Payload)
        }

        // 异步写来自 session 的事件
        select {
        case ev := <-session.Out():
            conn.WriteFrame(ev.Type, ev.Payload)
        default:
        }
    }
}
```

### 2.4 WebRTC SFU 选择

| 方案 | 优势 | 劣势 |
|---|---|---|
| **LiveKit** (云/自托管) | 开箱即用、扩展好、Agent 框架 | 学习曲线 |
| **Pipecat** | Python 编排 + 多个 STT/LLM/TTS 适配 | 性能不如 Go |
| **Pion** (Go) | 完全可控、高性能 | 需要自己写编排 |
| **声网/即构/火山 RTC** | 托管、稳定 | 绑定厂商 |
| **mediasoup** | C++ 性能 | 复杂 |

> 推荐：**LiveKit + Pipecat** 起步（成熟），流量大后自建 SFU + 自研编排。

---

## 3. 协议网关（Voice Gateway）

### 3.1 职责

| 职责 | 说明 |
|---|---|
| **协议适配** | 统一内部事件格式 |
| **会话编排** | ASR → LLM → TTS 调度 |
| **上下文管理** | 短期记忆 / 长期记忆 |
| **句子切分** | LLM 流式输出切分后送 TTS |
| **断点续传** | 客户端重连后恢复 |
| **风控旁路** | LLM 输出过滤 |
| **打点** | 全链路 trace |

### 3.2 编排模式

#### 模式 A：同步级联（Pipeline）

```python
# gateway/orchestrator.py (伪代码)
async def run_voice_agent(session, audio_stream):
    asr = ASRClient()
    llm = LLMClient()
    tts = TTSClient()

    async def on_asr_final(text: str):
        # 1. 推 LLM 流
        full_reply = ""
        sentence_buf = ""
        async for token in llm.stream(text):
            sentence_buf += token
            full_reply += token
            session.emit("llm.token", {"text": token})

            # 2. 句子切分 → 推 TTS
            if is_sentence_end(sentence_buf):
                async for chunk in tts.stream(sentence_buf):
                    session.emit("tts.chunk", chunk)
                sentence_buf = ""

    async def on_barge_in():
        await llm.cancel()
        await tts.cancel()
        session.emit("interrupted", ...)

    # 监听 ASR
    async for ev in asr.stream(audio_stream):
        if ev.type == "partial":
            session.emit("asr.partial", ev)
        elif ev.type == "final":
            session.emit("asr.final", ev)
            await on_asr_final(ev.text)
        elif ev.type == "vad_speech_start":
            await on_barge_in()
```

#### 模式 B：异步流水线（推荐生产）

```
上游           管道         下游
              ┌──────┐
ASR partial → │ ring │ → 前端字幕
              │ buf  │
ASR final   → └──────┘ → 触发 LLM
                  │
                  ▼
              ┌──────┐
LLM token   → │ seg  │ → 句子切分
              └──────┘
                  │
                  ▼
              ┌──────┐
sentence    → │ TTS  │ → 流式音频
              │ pool │ (并发 2~4 句)
              └──────┘
```

每个环节是独立 worker，通过 channel 连接，**完全异步**。

```python
# gateway/async_pipeline.py
import asyncio

class AsyncVoicePipeline:
    def __init__(self, session):
        self.asr_q = asyncio.Queue()
        self.llm_q = asyncio.Queue()
        self.tts_q = asyncio.Queue()
        self.session = session

    async def start(self, audio_stream):
        await asyncio.gather(
            self.asr_worker(audio_stream),
            self.llm_worker(),
            self.tts_worker(),
            self.barge_in_watcher()
        )

    async def asr_worker(self, audio_stream):
        async for ev in asr_stream(audio_stream):
            await self.asr_q.put(ev)
            if ev.type == "final":
                await self.llm_q.put(("asr_final", ev.text))
            elif ev.type == "vad_speech_start":
                await self.llm_q.put(("barge_in", None))

    async def llm_worker(self):
        buf = ""
        while True:
            cmd, data = await self.llm_q.get()
            if cmd == "asr_final":
                async for token in llm_stream(data):
                    buf += token
                    self.session.emit("llm.token", token)
                    if is_sentence_end(buf):
                        await self.tts_q.put(buf)
                        buf = ""
            elif cmd == "barge_in":
                await cancel_llm()
                await cancel_tts()
                self.session.emit("interrupted")
                buf = ""

    async def tts_worker(self):
        sem = asyncio.Semaphore(2)  # 最多并发 2 句 TTS
        while True:
            sentence = await self.tts_q.get()
            async with sem:
                async for chunk in tts_stream(sentence):
                    self.session.emit("tts.chunk", chunk)
                self.session.emit("tts.end")
```

### 3.3 句子切分器

```python
# gateway/segmenter.py
import re

SENT_END_ZH = re.compile(r'[。！？!?]')   # 中
SENT_END_EN = re.compile(r'[.!?]')       # 英
CLAUSE_END = re.compile(r'[,，;；:]')     # 短停顿

def is_sentence_end(buf: str, last_token: str, ms_since_last: int) -> bool:
    """是否应该把 buf 作为一个完整句切给 TTS"""
    if SENT_END_ZH.search(last_token) or SENT_END_EN.search(last_token):
        return True
    if CLAUSE_END.search(last_token) and ms_since_last > 400 and len(buf) > 12:
        return True  # 半句强停顿
    if len(buf) > 80:  # 长度兜底
        return True
    return False
```

### 3.4 端点检测（Endpointing）

```python
# gateway/endpointing.py
class EndpointDetector:
    def __init__(self):
        self.silence_ms = 0
        self.last_partial_text = ""
        self.stable_count = 0

    def feed(self, asr_event):
        if asr_event.type == "vad_speech_end":
            self.silence_ms += 100
        elif asr_event.type == "partial":
            if asr_event.text == self.last_partial_text:
                self.stable_count += 1
            else:
                self.stable_count = 0
                self.last_partial_text = asr_event.text
            self.silence_ms = 0

        # 触发"说完了"的条件
        if self.silence_ms > 600:  # 静音 600ms
            return "end"
        if self.stable_count > 5:  # 文字稳定 5 帧
            return "stable"
        return "continue"
```

### 3.5 上下文管理

```python
# gateway/context.py
class ContextManager:
    def __init__(self, redis):
        self.redis = redis

    async def get_messages(self, session_id, system_prompt):
        """获取短期 + 长期记忆"""
        short = await self.redis.lrange(f"ctx:{session_id}", 0, 20)
        long_summary = await self.redis.get(f"summary:{session_id}")
        messages = [{"role": "system", "content": system_prompt}]
        if long_summary:
            messages.append({"role": "system", "content": f"历史摘要：{long_summary}"})
        messages.extend(short)
        return messages

    async def append(self, session_id, role, content):
        await self.redis.rpush(f"ctx:{session_id}", json.dumps({
            "role": role, "content": content, "ts": now()
        }))
        await self.redis.ltrim(f"ctx:{session_id}", -20, -1)
        await self.redis.expire(f"ctx:{session_id}", 3600)  # 1h

    async def summarize_if_needed(self, session_id):
        # 每 20 轮做一次摘要
        length = await self.redis.llen(f"ctx:{session_id}")
        if length > 15:
            history = await self.redis.lrange(f"ctx:{session_id}", 0, -1)
            summary = await llm_summarize(history)
            await self.redis.set(f"summary:{session_id}", summary)
            await self.redis.delete(f"ctx:{session_id}")
```

### 3.6 工具调用 / RAG

```python
# gateway/tools.py
TOOLS = [
    {
        "name": "get_weather",
        "description": "查询天气",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string"}
            }
        }
    },
    {
        "name": "search_knowledge",
        "description": "在企业知识库中搜索",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            }
        }
    }
]

async def handle_tool_call(call, session):
    if call.name == "get_weather":
        return await weather_api(call.args.city)
    if call.name == "search_knowledge":
        return await rag_search(call.args.query, session.user_id)
```

### 3.7 风控与合规

```python
# gateway/guardrails.py
class Guardrails:
    def __init__(self, llm_guard, content_filter):
        self.llm_guard = llm_guard
        self.content_filter = content_filter

    async def check_input(self, text):
        if self.content_filter.has_sensitive(text):
            return False, "包含敏感词"
        return True, None

    async def check_output_stream(self, token_stream):
        async for token in token_stream:
            if self.content_filter.is_sensitive(token):
                yield "[已过滤]"
                # 终止生成
                return
            yield token
```

---

## 4. ASR 集群

### 4.1 选型对比

| 服务 | 价格 (¥/分钟) | 延迟 (P50) | 准确率 | 备注 |
|---|---|---|---|---|
| 火山引擎 ASR | 0.0014 | 200ms | 95% | 字节，质量好 |
| 讯飞 | 0.002 | 250ms | 96% | 方言强 |
| 阿里达摩院 | 0.0015 | 250ms | 94% | 性价比 |
| Deepgram Nova-3 | $0.0077 | <300ms | 6.84% WER | 流式 SOTA |
| AssemblyAI Universal-3 | - | ~1s | 高 | 自带 turn detection |
| 自建 (Whisper-large) | 服务器成本 | 500ms+ | 92% | 完全可控 |

> 生产建议：**双供应商**（火山为主 + 讯飞/Deepgram 备份），自动切换。

### 4.2 集成模式

```python
# asr/stream.py
import websockets

class VolcASR:
    URL = "wss://openspeech.bytedance.com/api/v2/asr"

    def __init__(self, app_id, access_token, cluster):
        self.headers = {"Authorization": f"Bearer; {access_token}"}
        self.config = {
            "app": {"appid": app_id, "cluster": cluster},
            "user": {"uid": "voice-gateway"},
            "audio": {
                "format": "pcm",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
                "codec": "raw"
            },
            "request": {
                "model_name": "bigmodel",
                "enable_punc": True,
                "enable_itn": True,
                "vad": True,
                "vad_silence_ms": 600
            }
        }

    async def stream(self, audio_pcm_stream):
        async with websockets.connect(self.URL, extra_headers=self.headers) as ws:
            # 1. 发配置
            await ws.send(json.dumps(self.config))

            # 2. 流式发音频
            async for chunk in audio_pcm_stream:
                await ws.send(chunk)

            # 3. 收事件
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("type") == "partial":
                    yield ASREvent.partial(msg["text"])
                elif msg.get("type") == "final":
                    yield ASREvent.final(msg["text"], msg.get("confidence", 0))
                elif msg.get("code") != 1000:  # 错误
                    raise ASRError(msg)
```

### 4.3 自建 ASR 部署（如选自建）

| 组件 | 推荐 | 备注 |
|---|---|---|
| 模型 | Whisper-large-v3 / Paraformer | 流式优化版 |
| 推理框架 | vLLM / TensorRT-LLM / Triton | 高吞吐 |
| GPU | A10 / A100 | 单卡 ~50 路并发 |
| 调度 | K8s + HPA | 按 QPS 弹性 |
| 优化 | TensorRT / INT8 | 延迟 200ms 以内 |

---

## 5. LLM 网关

### 5.1 选型

| 模型 | 场景 | 备注 |
|---|---|---|
| 豆包 Pro | 中文 | 字节，质量好，价格低 |
| 豆包 Lite | 简单 | 成本低，延迟低 |
| Qwen-Max | 中文 | 阿里，工具调用好 |
| GLM-4 | 中文 | 智谱 |
| GPT-4o | 跨语种 | 质量好但贵 |
| Claude | 推理 | 长上下文 |
| Gemini 2.0 Flash | 多模态 | 实时 |
| **豆包 S2S 实时** | **端到端** | 拟人度最高 |

### 5.2 LLM 网关设计

```python
# llm/gateway.py
class LLMGateway:
    def __init__(self, providers):
        self.providers = providers  # 多家

    async def stream(self, model, messages, **opts):
        provider = self.providers[model]
        async for token in provider.stream(messages, **opts):
            yield token

    async def tool_call(self, model, messages, tools):
        # 工具调用循环
        while True:
            resp = await self.providers[model].call(messages, tools)
            if not resp.tool_calls:
                return resp.content
            for call in resp.tool_calls:
                result = await execute_tool(call)
                messages.append({"role": "tool", "content": result})
```

### 5.3 性能优化

| 优化 | 收益 | 做法 |
|---|---|---|
| **流式输出** | -300ms | SSE 边出边取 |
| **短 system prompt** | -100ms | 控制在 200 token 以内 |
| **Few-shot 最小化** | -50ms | |
| **Prefix caching** | -200ms | 系统提示词 KV 缓存 |
| **小模型分流** | 节省成本 | 简单场景用 Lite |
| **并发** | 提高吞吐 | 多请求 batched |
| **预热** | -100ms | 提前 5s 加载模型 |

### 5.4 Prompt 设计（语音场景专用）

```python
VOICE_SYSTEM_PROMPT = """
你是一个语音助手，回答要求：
1. 口语化，避免书面语和长难句
2. 短句为主，单句不超过 30 字
3. 用换行或"。"自然分句，方便 TTS 边合成边播
4. 避免列举大段 URL / 邮箱 / 数字串
5. 不要用 markdown 格式（无 ** # 等）
6. 不要用表情符号
7. 直接回答，不要说"好的，我来帮您"等套话
"""
```

---

## 6. TTS 集群

### 6.1 选型

| 服务 | 价格 (¥/千字) | 首包延迟 | 音色 | 备注 |
|---|---|---|---|---|
| 火山豆包 TTS | 0.2 | 200ms | 50+ | 拟人度好 |
| 讯飞 | 0.4 | 250ms | 100+ | 多方言 |
| 微软 Azure | 1.5 | 300ms | 200+ | 英文好 |
| ElevenLabs | $0.3 | 350ms | 声音克隆 | 海外 |
| Cartesia | $0.05 | 100ms | 多语种 | 极快 |
| Edge TTS | 免费 | 500ms | 受限 | 兜底 |

### 6.2 双向流式 TTS（豆包）

```python
# tts/doubao.py
class DoubaoTTS:
    URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"

    async def stream(self, text_stream, voice):
        """text_stream 是异步生成器，逐句输入"""
        async with websockets.connect(self.URL, extra_headers={...}) as ws:
            # 1. 发 session 配置
            await ws.send(json.dumps({
                "speaker": voice,
                "audio": {"format": "pcm", "rate": 24000, "bits": 16, "channel": 1}
            }))

            async def send_text():
                async for sentence in text_stream:
                    await ws.send(json.dumps({
                        "text": sentence,
                        "flush": True
                    }))
                await ws.send(json.dumps({"flush": True, "end": True}))

            async def recv_audio():
                while True:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    if "audio" in data:
                        yield base64.b64decode(data["audio"])
                    if data.get("end"):
                        return

            await asyncio.gather(send_text(), consume_audio(recv_audio()))
```

### 6.3 TTS 优化

| 优化 | 做法 |
|---|---|
| **并发合成** | 2~3 句并发 |
| **预热模型** | 提前加载 |
| **音频预取** | LLM 出第 1 句时合成第 2 句 |
| **声音克隆** | 用户录音 30s 定制音色 |
| **情感合成** | 根据内容动态情感 |
| **SSML** | 关键位置 `<break>` 停顿 |

---

## 7. 实时音视频方案（类豆包 / OpenAI Realtime）

### 7.1 自建 vs 托管

| 维度 | 自建 (Pion/LiveKit + Pipecat) | 托管 (OpenAI Realtime / 豆包) |
|---|---|---|
| 延迟 | 800~1200ms | 800~1000ms |
| 控制 | 完全可控 | 受限 |
| 成本 | 高（GPU + 工程） | 按分钟付费 |
| 私有化 | ✅ | ❌ |

### 7.2 集成示例：豆包 S2S

```python
# s2s/doubao.py
class DoubaoS2S:
    """豆包实时语音大模型 - 端到端 S2S"""
    URL = "wss://openspeech.bytedance.com/api/v3/realtime"

    async def connect(self):
        self.ws = await websockets.connect(self.URL, extra_headers={...})

    async def configure(self, voice, system_prompt):
        await self.ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "voice": voice,
                "instructions": system_prompt,
                "turn_detection": {
                    "type": "server_vad",
                    "silence_duration_ms": 500
                }
            }
        }))

    async def send_audio(self, pcm_chunk):
        await self.ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(pcm_chunk).decode()
        }))

    async def commit(self):
        await self.ws.send(json.dumps({
            "type": "input_audio_buffer.commit"
        }))

    async def listen(self):
        async for msg in self.ws:
            ev = json.loads(msg)
            if ev["type"] == "input_audio_buffer.speech_started":
                yield S2SEvent.vad_start()
            elif ev["type"] == "response.output_audio.delta":
                yield S2SEvent.audio(base64.b64decode(ev["delta"]))
            elif ev["type"] == "response.output_audio.done":
                yield S2SEvent.audio_end()
```

### 7.3 集成示例：OpenAI Realtime (WebRTC)

```python
# s2s/openai_realtime.py
import asyncio
from aiohttp import ClientSession

class OpenAIRealtime:
    def __init__(self, api_key, model="gpt-realtime"):
        self.api_key = api_key
        self.model = model

    async def exchange_sdp(self, sdp_offer):
        async with ClientSession() as session:
            async with session.post(
                f"https://api.openai.com/v1/realtime?model={self.model}",
                data=sdp_offer,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/sdp"
                }
            ) as resp:
                return await resp.text()  # SDP answer
```

> 客户端走 WebRTC 直连 OpenAI，服务端只做信令代理 + 鉴权。

---

## 8. 基础设施

### 8.1 部署架构

```
┌────────────────────────────────────────────────────────────┐
│                       公有云 / 私有云                         │
│                                                            │
│   Region: 北京               Region: 上海                   │
│   ┌──────────────────┐      ┌──────────────────┐            │
│   │  K8s Cluster     │      │  K8s Cluster     │            │
│   │  - Edge-Gateway  │      │  - Edge-Gateway  │            │
│   │  - Voice-Gateway │      │  - Voice-Gateway │            │
│   │  - Tool Server   │      │  - Tool Server   │            │
│   │  - SFU (LiveKit) │      │  - SFU (LiveKit) │            │
│   │  - BFF           │      │  - BFF           │            │
│   └────────┬─────────┘      └────────┬─────────┘            │
│            │                         │                      │
│            └──────────┬──────────────┘                      │
│                       │                                     │
│            ┌──────────┴──────────┐                          │
│            ▼                     ▼                          │
│   ┌──────────────────┐  ┌──────────────────┐               │
│   │ 中心 ASR 集群     │  │ 中心 LLM 集群     │               │
│   │ (GPU 机器学习平台) │  │ (GPU)            │               │
│   └──────────────────┘  └──────────────────┘               │
│                                                            │
│   数据库: Redis (会话)、MySQL (用户)、OSS (录音)            │
│   MQ: Kafka (事件流)、RocketMQ (异步任务)                   │
│   监控: Prometheus + Grafana + Loki                        │
│   Trace: Jaeger / SkyWalking                              │
└────────────────────────────────────────────────────────────┘
```

### 8.2 K8s 部署清单

```yaml
# k8s/edge-gateway.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: voice-edge-gateway
spec:
  replicas: 20  # 按 QPS 扩缩
  selector:
    matchLabels:
      app: voice-edge-gateway
  template:
    metadata:
      labels:
        app: voice-edge-gateway
    spec:
      containers:
      - name: app
        image: voice-edge-gateway:v1.2.3
        resources:
          requests: { cpu: "500m", memory: "512Mi" }
          limits:   { cpu: "2",    memory: "2Gi" }
        ports:
        - { containerPort: 8080 }
        readinessProbe:
          httpGet: { path: /healthz, port: 8080 }
          initialDelaySeconds: 5
        livenessProbe:
          httpGet: { path: /healthz, port: 8080 }
          initialDelaySeconds: 30
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: voice-edge-gateway-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: voice-edge-gateway
  minReplicas: 10
  maxReplicas: 100
  metrics:
  - type: Resource
    resource:
      name: cpu
      target: { type: Utilization, averageUtilization: 70 }
  - type: Pods
    pods:
      metric: { name: voice_active_sessions }
      target: { type: AverageValue, averageValue: "200" }
```

### 8.3 容量规划

| QPS | Edge-GW Pod | ASR 并发 | LLM TPS | TTS 并发 | GPU | Redis |
|---|---|---|---|---|---|---|
| 100 | 5 | 100 | 50 | 50 | 1×A10 | 1×1G |
| 1k | 20 | 1k | 500 | 500 | 4×A10 | 3×4G |
| 10k | 100 | 10k | 5k | 5k | 20×A10 | 10×16G |
| 100k | 500 | 100k | 50k | 50k | 100×A10 | 30×32G |

### 8.4 边缘节点

| 节点 | 城市 | 用途 |
|---|---|---|
| 中心 1 | 北京 / 上海 / 广州 | 主集群，全功能 |
| 边缘 1 | 成都 / 武汉 | 区域接入 |
| 边缘 2 | 香港 / 新加坡 | 海外 |

边缘节点只跑 **Edge-Gateway**（协议接入 + 简单鉴权），媒体流直接转发到最近的中心。

---

## 9. 数据库设计

### 9.1 Redis 键设计

```
session:{sessionId}              # 会话元数据，TTL 1h
ctx:{sessionId}                  # 短期上下文 (List)
summary:{sessionId}              # 长期摘要
hotword:{userId}                 # 用户热词
config:{userId}                  # 用户个性化配置
rate:{userId}:{window}           # 限流计数
```

### 9.2 MySQL 表

```sql
CREATE TABLE voice_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  mode VARCHAR(32),
  start_at DATETIME(3),
  end_at DATETIME(3),
  duration_ms INT,
  asr_text TEXT,
  llm_text TEXT,
  tts_chars INT,
  error_code VARCHAR(32),
  INDEX idx_user (user_id, start_at)
);

CREATE TABLE voice_metrics (
  ts DATETIME(3),
  session_id VARCHAR(64),
  asr_p50_ms INT, asr_p95_ms INT,
  llm_ttft_ms INT,
  tts_ttfa_ms INT,
  e2e_ms INT,
  INDEX idx_ts (ts)
);

CREATE TABLE voice_recordings (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64),
  url VARCHAR(512),
  duration_ms INT,
  size_bytes BIGINT,
  created_at DATETIME(3),
  INDEX idx_session (session_id)
);
```

---

## 10. 监控与告警

### 10.1 关键指标

```yaml
# Prometheus 指标
voice_active_sessions            # 当前活跃会话
voice_asr_qps                    # ASR 每秒请求
voice_asr_p50_ms                 # ASR 延迟
voice_asr_error_rate             # ASR 错误率
voice_llm_ttft_ms                # LLM TTFT
voice_tts_ttfa_ms                # TTS 首音
voice_e2e_p50_ms                 # 端到端 P50
voice_e2e_p95_ms                 # 端到端 P95
voice_bargein_ms                 # 打断响应
voice_playback_gap_ms            # 播放卡顿
voice_network_jitter_ms          # 网络抖动
voice_gpu_util                   # GPU 利用率
voice_session_oom                # 内存溢出
```

### 10.2 告警规则

```yaml
groups:
- name: voice_alerts
  rules:
  - alert: VoiceE2EHigh
    expr: voice_e2e_p95_ms > 1800
    for: 2m
    labels: { severity: warning }
    annotations:
      summary: "端到端 P95 超过 1.8s"

  - alert: VoiceASRErrorHigh
    expr: voice_asr_error_rate > 0.05
    for: 1m
    labels: { severity: critical }

  - alert: VoiceLLMRateLimit
    expr: rate(voice_llm_429[1m]) > 10
    for: 1m
    labels: { severity: warning }

  - alert: VoiceGPUSaturation
    expr: voice_gpu_util > 90
    for: 5m
    labels: { severity: warning }
```

### 10.3 Grafana 看板

- **总览**：活跃会话、E2E P50/P95、错误率
- **延迟分位**：每个阶段的 P50/P95/P99
- **供应商对比**：火山 vs 讯飞 vs Deepgram
- **ASR 准确率**：基于转写后的二次核验
- **GPU 利用率**：每张卡的负载
- **网络质量**：RTT / 丢包 / 抖动分布

---

## 11. 录制与回放

### 11.1 录音留档

```python
# recording/recorder.py
class SessionRecorder:
    def __init__(self, oss_bucket):
        self.bucket = oss_bucket

    async def start(self, session_id):
        self.session_id = session_id
        self.audio_buffer = bytearray()
        self.events = []

    def on_audio(self, pcm_chunk, direction):
        if direction == "in":  # 用户
            self.audio_buffer.extend(pcm_chunk)

    def on_event(self, event):
        self.events.append({
            "ts": now(),
            "type": event.type,
            "data": event.payload
        })

    async def save(self):
        # 1. 写音频到 OSS
        audio_url = await self.bucket.put(
            f"voice/{self.session_id}/audio.pcm",
            bytes(self.audio_buffer)
        )
        # 2. 写事件到 MySQL
        await db.insert("voice_recordings", {
            "session_id": self.session_id,
            "url": audio_url,
            "events": json.dumps(self.events)
        })
```

### 11.2 回放工具

```python
# replay/replayer.py
async def replay_session(recording_id, sdk):
    rec = await db.get("voice_recordings", recording_id)
    audio = await oss.get(rec.url)

    # 模拟原始音频流
    sdk.feed_audio(audio)

    # 同时按时间回放事件
    for ev in rec.events:
        await sleep_until(ev.ts)
        sdk.inject_event(ev)
```

---

## 12. 性能基准与压测

### 12.1 压测工具

- **k6 / Locust**：HTTP/WS 压测
- **自定义 WebRTC 客户端**：模拟真实客户端
- **音频回放**：用真实录制的 30s 音频循环喂

### 12.2 压测指标

| 指标 | 目标 | 工具 |
|---|---|---|
| 并发会话 | 10k | Locust |
| 端到端 P95 | < 1.8s | Trace |
| ASR 错误率 | < 2% | 二次核验 |
| 长稳（24h） | 内存/CPU 无泄漏 | Prometheus |
| 故障注入 | 服务挂/网络断 | ChaosBlade |

### 12.3 容量模型

```
总并发 = 节点数 × 单机并发
单机并发 = min(CPU 限制, 内存限制, 网卡限制, 依赖并发)
            ↓
          通常 100~500 会话/Pod
```

---

## 13. 灾备与多活

### 13.1 同城双活

- 两个 K8s 集群，分担流量
- Redis 主从（跨 AZ）
- DNS 切换

### 13.2 跨城灾备

- 中心 → 灾备中心，1 RPO（实时复制）
- 灾备中心只读 + 冷备 ASR/TTS
- 切换：15 分钟内 RTO

### 13.3 供应商容灾

- **ASR**：火山主 + 讯飞备 + Deepgram 海外
- **LLM**：豆包主 + Qwen 备
- **TTS**：豆包主 + 讯飞备 + Edge TTS 兜底

切换条件：
- 错误率 > 5% 持续 1min
- 延迟 P95 > 2x 正常值

---

## 14. CI/CD

```yaml
# .github/workflows/deploy.yaml
name: Deploy Voice Gateway
on:
  push:
    branches: [main]
    paths: ['gateway/**']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: docker build -t voice-gateway:${{ github.sha }} .
      - run: docker push registry/voice-gateway:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: kubectl set image deployment/voice-gateway app=voice-gateway:${{ github.sha }}
      - run: kubectl rollout status deployment/voice-gateway
```

**金丝雀**：
- 5% 流量 → 监控 10min → 25% → 50% → 100%
- 任一阶段指标异常立即回滚

---

## 15. 成本优化

| 措施 | 节省 |
|---|---|
| ASR 自建 | 40% |
| LLM 用小模型分流 | 30% |
| TTS 字符压缩 | 10% |
| 边缘节点 | 25%（节省带宽） |
| WebRTC 替代 WS | 30%（UDP 节省重传） |
| 缓存热词/上下文 | 20% LLM token |
| 录音压缩 | 70% 存储 |

**单次会话成本**：级联 ~¥0.18，S2S ~¥1.0。

---

## 16. 运维手册（Runbook）

### 16.1 常见故障

| 故障 | 现象 | 处理 |
|---|---|---|
| ASR 全部超时 | 转写卡住 | 切备份 ASR |
| LLM 限流 | 502/429 | 切小模型 / 降级 |
| TTS 503 | 没声音 | 切 Edge TTS |
| Edge GW CPU 高 | 连不上 | 加 Pod |
| Redis 挂了 | 会话丢 | 重连重建 |
| K8s 节点挂 | 部分不可用 | Pod 漂移 |
| 证书过期 | TLS 失败 | 提前 30 天告警 |
| GPU 满 | 所有延迟高 | 排队 / 限流 |

### 16.2 应急开关

```python
# config/feature_flags.py
FLAGS = {
    "use_asr_backup": False,    # 切备份 ASR
    "use_llm_lite": False,      # 切小模型
    "tts_disabled": False,      # 关闭 TTS（仅文本）
    "record_enabled": True,     # 录音
    "max_sessions": 50000,      # 总会话上限
    "mode_disabled": []         # 禁用模式
}
```

通过配置中心实时生效，秒级切换。

---

## 17. 安全合规实现

### 17.1 鉴权

```go
// edge-gateway/auth.go
func Authenticate(token string) (*User, error) {
    // 1. 解析 JWT
    claims, err := jwt.ParseWithClaims(token, &JWTClaims{}, func(t *jwt.Token) (interface{}, error) {
        return publicKey, nil
    })
    if err != nil { return nil, ErrAuth }

    // 2. 验证签名、过期、签发方
    if !claims.Valid { return nil, ErrAuth }

    // 3. 检查用户状态
    user, err := userService.Get(claims.UserID)
    if user.Status == "banned" { return nil, ErrBanned }

    return user, nil
}
```

### 17.2 风控旁路

```
用户音频 → 主 ASR（业务）
         → 旁路 ASR（风控，异步）
         → 风控引擎（涉政/广告/辱骂）
         → 命中 → 切断会话 + 上报
```

### 17.3 数据脱敏

```python
# 合规
audio_url = generate_signed_url(recording_id, expires=3600)
# 录音路径加白名单 IP 才能下载
# 数据库录音元数据加密
```

### 17.4 算法备案（中国）

- 生成式 AI 服务备案
- 用户协议 + 隐私协议
- 用户明示同意（弹窗 + 选项）

---

## 18. 团队与开发

### 18.1 团队结构

```
Voice Tech Team
├── Voice Gateway (服务端，5人)
│   ├── Edge-Gateway (Go)
│   ├── 编排引擎 (Python/Go)
│   └── 协议 (Protobuf)
├── AI Integration (2人)
│   ├── ASR / TTS 适配
│   ├── LLM 网关
│   └── 端到端 S2S
├── Frontend SDK (2人)
│   ├── H5 / PC
│   ├── 小程序
│   └── React Components
├── Infrastructure (2人)
│   ├── K8s / 边缘
│   ├── 监控
│   └── CI/CD
└── QA (1人)
    ├── 性能压测
    └── 自动化测试
```

### 18.2 开发规范

- **代码规范**：Go (gofumpt + golangci-lint), Python (ruff + mypy), TypeScript (eslint + prettier)
- **测试**：单元 + 集成 + E2E（覆盖率 > 70%）
- **Code Review**：所有 PR 至少 1 人 review
- **文档**：每个 PR 必带 changelog

---

## 19. 进一步阅读 / 资源

- [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [LiveKit Agents](https://docs.livekit.io/agents/)
- [Pipecat Framework](https://github.com/pipecat-ai/pipecat)
- [Volcengine ASR Docs](https://www.volcengine.com/docs/6561)
- [WebRTC for the Curious](https://webrtcforthecurious.com/)
- [火山引擎对话式 AI 方案](https://www.volcengine.com/docs/82379/1393085)

---

> 下一篇：[`voice-observability-security.md`](./voice-observability-security.md) — 可观测 / 容灾 / 安全细节
