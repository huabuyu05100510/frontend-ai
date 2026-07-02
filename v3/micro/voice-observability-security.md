# 实时语音交互：可观测 / 容灾 / 安全

> 主文档：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> 协议：[`voice-realtime-protocol.md`](./voice-realtime-protocol.md)
> 客户端：[`voice-sdk-client.md`](./voice-sdk-client.md)
> 服务端：[`voice-backend-infra.md`](./voice-backend-infra.md)
> 本篇聚焦：**Metrics / Trace / Log / 告警、容灾降级、安全合规、压测演练**。

---

## 1. 可观测性体系

### 1.1 三大支柱

```
                    实时语音交互系统
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
    ┌────────┐       ┌────────┐       ┌────────┐
    │Metrics │       │  Logs  │       │ Traces │
    │(指标)  │       │(日志)  │       │(链路)  │
    └────────┘       └────────┘       └────────┘
       │                 │                 │
       ▼                 ▼                 ▼
    Prometheus        Loki/ES          Jaeger
       │                 │                 │
       └────────┬────────┴────────┬────────┘
                ▼                 ▼
             Grafana          AlertManager
```

### 1.2 RED + USE + 业务指标

| 类别 | 指标 | 含义 |
|---|---|---|
| **RED** (服务) | Rate / Errors / Duration | 每秒请求、错误率、延迟 |
| **USE** (资源) | Utilization / Saturation / Errors | CPU/内存/IO/网络 |
| **业务** | 活跃会话 / 字符量 / 命中率 | 业务核心指标 |

### 1.3 关键业务指标

```yaml
# 端到端质量
voice_session_start_total              # 总会话数
voice_session_end_total{reason}        # 结束原因分布
voice_session_active                   # 当前活跃
voice_session_duration_p50/p95         # 会话时长分布
voice_session_duration_max             # 最长会话

# 延迟
voice_capture_buffer_ms                # 采集缓冲延迟
voice_upload_rtt_ms                    # 上行 RTT
voice_asr_first_partial_ms             # ASR 首字
voice_asr_final_ms                     # ASR final 延迟
voice_translation_first_ms             # 翻译首字
voice_llm_ttft_ms                      # LLM TTFT
voice_llm_first_sentence_ms            # LLM 首句
voice_tts_ttfa_ms                      # TTS 首音
voice_e2e_ms                           # 端到端
voice_bargein_ms                       # 打断响应
voice_playback_gap_ms                  # 播放卡顿

# 容量
voice_asr_qps                          # ASR 每秒请求
voice_llm_tokens_per_sec               # LLM TPS
voice_tts_chars_per_sec                # TTS 字符/秒
voice_concurrent_sessions              # 并发

# 错误
voice_asr_error_total{code}            # ASR 错误
voice_llm_error_total{code}            # LLM 错误
voice_tts_error_total{code}            # TTS 错误
voice_session_error_rate               # 会话错误率

# 网络
voice_network_rtt_ms                   # RTT
voice_packet_loss_pct                  # 丢包率
voice_jitter_ms                        # 抖动

# 资源
voice_pod_cpu_util                     # Pod CPU
voice_pod_memory_used                  # Pod 内存
voice_gpu_util                         # GPU 利用率
voice_gpu_memory_used                  # GPU 显存
```

### 1.4 Prometheus 指标实现

#### 客户端 SDK

```ts
// core/metrics.ts
import { Counter, Histogram, Gauge } from './prom-client';

export const metrics = {
  // 计数
  sessionStart: new Counter({ name: 'voice_session_start_total', labelNames: ['mode'] }),
  sessionEnd: new Counter({ name: 'voice_session_end_total', labelNames: ['mode', 'reason'] }),
  asrError: new Counter({ name: 'voice_asr_error_total', labelNames: ['code'] }),
  
  // 直方图
  asrFirstPartial: new Histogram({ name: 'voice_asr_first_partial_ms', buckets: [50, 100, 200, 400, 600, 1000, 2000] }),
  e2e: new Histogram({ name: 'voice_e2e_ms', buckets: [500, 800, 1200, 1500, 2000, 3000] }),
  bargein: new Histogram({ name: 'voice_bargein_ms', buckets: [50, 100, 200, 400, 600] }),
  
  // Gauge
  rtt: new Gauge({ name: 'voice_upload_rtt_ms', labelNames: ['session'] }),
  activeSessions: new Gauge({ name: 'voice_active_sessions' })
};
```

```ts
// 使用
const t0 = performance.now();
// ... 等待 ASR 第一个 partial
metrics.asrFirstPartial.observe(performance.now() - t0);
```

#### 服务端 Go

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    ASRFirstPartial = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "voice_asr_first_partial_ms",
            Buckets: []float64{50, 100, 200, 400, 600, 1000, 2000},
        },
        []string{"provider"},
    )
)
```

### 1.5 Grafana 看板

#### 总览看板（业务侧）

```
┌────────────────────────────────────────────────────────┐
│  实时语音 - 业务总览                                       │
├──────────────────┬──────────────────────────────────────┤
│ 活跃会话: 3,245  │  P50 端到端: 920ms   目标 1200ms     │
│ 今日会话: 89k    │  P95 端到端: 1.65s   目标 1800ms     │
│ 错误率: 0.3%     │  打断 P95: 280ms     目标 400ms      │
├──────────────────┴──────────────────────────────────────┤
│  [延迟分布]  [流量趋势]  [错误率]  [网络质量]  [GPU]       │
│  - 各阶段 P50/P95/P99  - 实时 QPS  - 5xx 占比  - RTT    │
│  - 供应商对比           - 早高峰    - 错误码分布          │
└────────────────────────────────────────────────────────┘
```

#### 排错看板（运维侧）

- 单个 session 的 trace 详情
- 慢请求 TopN
- 异常供应商占比
- 资源水位

### 1.6 告警分级

| 级别 | 触发 | 通知 | 响应 |
|---|---|---|---|
| **P0** | 全面不可用 | 电话+短信+企业微信 | 5 分钟 |
| **P1** | 错误率 > 5% 或 P95 > 2x 目标 | 企业微信+电话 | 15 分钟 |
| **P2** | 错误率 > 1% 或 P95 > 1.5x 目标 | 企业微信 | 1 小时 |
| **P3** | 资源水位高 / 性能退化 | 企业微信 | 当日 |

### 1.7 告警规则示例

```yaml
groups:
- name: voice-customer
  rules:
  # P0: 完全不可用
  - alert: VoiceAllDown
    expr: voice_session_start_total:rate1m == 0 and voice_active_sessions < 10
    for: 1m
    labels: { severity: p0, team: voice }
    annotations:
      summary: "语音服务可能完全不可用"
      runbook: "https://wiki/runbook/voice-down"

  # P1: 错误率
  - alert: VoiceSessionErrorHigh
    expr: voice_session_error_rate > 0.05
    for: 1m
    labels: { severity: p1 }
  
  # P1: 端到端 P95 超标
  - alert: VoiceE2EHigh
    expr: voice_e2e_p95_ms > 1800
    for: 2m
    labels: { severity: p1 }
  
  # P1: ASR 错误
  - alert: VoiceASRErrorHigh
    expr: rate(voice_asr_error_total[1m]) > 0.1
    for: 1m
    labels: { severity: p1 }
  
  # P2: 单供应商劣化
  - alert: VoiceProviderASRSlow
    expr: voice_asr_first_partial_ms{provider="volc"} > 600
    for: 3m
    labels: { severity: p2 }
  
  # P2: GPU 高
  - alert: VoiceGPUSaturation
    expr: voice_gpu_util > 90
    for: 10m
    labels: { severity: p2 }
```

### 1.8 链路追踪（Trace）

#### Trace 设计

```yaml
# 完整 trace 树
traceId: vt_abc123
├─ span: voice.session
│   ├─ span: capture
│   ├─ span: transport.upload
│   ├─ span: asr.recognition
│  │   ├─ span: asr.first_partial
│  │   └─ span: asr.final
│  ├─ span: llm.stream
│  │   ├─ span: llm.first_token
│  │   └─ span: llm.tool_call (optional)
│  ├─ span: tts.synth
│  │   ├─ span: tts.first_chunk
│  │   └─ span: tts.done
│  ├─ span: transport.download
│  └─ span: playback
```

#### 客户端打点

```ts
class Tracer {
  spans: Span[] = [];
  current: Span | null = null;
  
  startSpan(name: string, tags: object = {}): Span {
    const span = {
      traceId: this.current?.traceId ?? crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      parentSpanId: this.current?.spanId,
      name,
      startTime: Date.now(),
      tags
    };
    this.spans.push(span);
    this.current = span;
    return span;
  }
  
  endSpan(tags: object = {}) {
    if (!this.current) return;
    this.current.endTime = Date.now();
    this.current.tags = { ...this.current.tags, ...tags };
    this.report();
    this.current = this.current.parentSpanId
      ? this.spans.find(s => s.spanId === this.current!.parentSpanId)!
      : null;
  }
  
  report() {
    // 1. 上报到 trace 收集服务
    fetch('/api/trace', { method: 'POST', body: JSON.stringify(this.spans) });
    // 2. 会话结束批量上报
  }
}

// 使用
const t = new Tracer();
t.startSpan('voice.session', { mode: 'voice_agent' });
t.startSpan('asr.first_partial');
// ...
t.endSpan({ latencyMs: 240 });
```

#### 服务端 OpenTelemetry

```python
# gateway/tracing.py
from opentelemetry import trace
from opentelemetry.exporter.jaeger.thrift import JaegerExporter

tracer = trace.get_tracer("voice-gateway")

async def handle_session(session_id, audio_stream):
    with tracer.start_as_current_span("voice.session") as span:
        span.set_attribute("session.id", session_id)
        span.set_attribute("session.mode", "voice_agent")
        
        async for ev in asr_stream(audio_stream):
            if ev.type == "first_partial" and not span_first_partial:
                span_first_partial.set_attribute("latency_ms", ...)
```

### 1.9 日志规范

#### 客户端日志

```ts
logger.info({
  event: 'asr.partial',
  traceId: 'vt_xxx',
  sessionId: 's_xxx',
  text: '今天天气',
  ts: 15230
});
```

#### 服务端日志（结构化 JSON）

```json
{
  "ts": "2026-06-19T16:09:00.123Z",
  "level": "INFO",
  "service": "voice-gateway",
  "traceId": "vt_xxx",
  "spanId": "sp_xxx",
  "sessionId": "s_xxx",
  "userId": "u_123",
  "event": "asr.final",
  "data": {
    "text": "今天天气不错",
    "confidence": 0.97,
    "latencyMs": 720
  }
}
```

#### 日志收集

- 客户端 → 走 Kafka / HTTP → ES / Loki
- 服务端 → stdout JSON → Filebeat → ES

#### 关键日志事件

| 事件 | 字段 | 用途 |
|---|---|---|
| `session.start` | mode, userAgent, network | 用户画像 |
| `asr.first_partial` | text, latencyMs | ASR 质量 |
| `asr.final` | text, confidence, latencyMs | ASR 准确率 |
| `llm.first_token` | latencyMs | LLM 响应 |
| `tts.first_chunk` | textRange, latencyMs | TTS 响应 |
| `barge_in` | reason, ms | 打断率 |
| `session.end` | reason, durationMs, totalChars | 会话统计 |
| `error` | code, message, stack | 错误排查 |

### 1.10 用户体验指标（QoE）

| 指标 | 采集方式 | 目标 |
|---|---|---|
| **音频卡顿率** | 客户端 audio gap > 100ms | < 0.5% |
| **转写正确率** | 用户手动修改 | > 95% |
| **打断成功率** | barge_in 后 200ms 内无 AI 声音 | > 99% |
| **首音延迟** | E2E P50 | < 1.2s |
| **CSAT** | 会话结束 1-5 星评分 | > 4.5 |

---

## 2. 容灾

### 2.1 容灾层级

```
L1  网络抖动         → 重传 / NACK
L2  单一服务异常      → 自动切换供应商
L3  机房网络异常      → 切边缘节点
L4  机房故障         → 切灾备中心
L5  全局故障         → 降级文字模式
```

### 2.2 多级降级开关

```python
# config/flags.py
DEGRADATION_LEVEL = 0

async def select_asr():
    if DEGRADATION_LEVEL == 0:
        return VolcASR()       # 正常
    elif DEGRADATION_LEVEL == 1:
        return IflytekASR()    # 备用
    elif DEGRADATION_LEVEL == 2:
        return DeepgramASR()   # 海外备
    else:
        return None           # 关闭 ASR → 文字模式

async def select_tts():
    if DEGRADATION_LEVEL <= 2:
        return DoubaoTTS()
    elif DEGRADATION_LEVEL == 3:
        return EdgeTTS()       # 浏览器内置
    else:
        return None
```

### 2.3 自动降级策略

```python
class AutoDegrader:
    def __init__(self):
        self.level = 0
        self.error_window = []

    def record_error(self, code):
        self.error_window.append((now(), code))
        # 保留最近 1min
        self.error_window = [e for e in self.error_window if now() - e[0] < 60]

        # 计算错误率
        if len(self.error_window) > 100:
            errors = sum(1 for _, c in self.error_window if c != 'OK')
            if errors / len(self.error_window) > 0.05 and self.level < 4:
                self.level += 1
                notify("降级到 L" + self.level)
            else:
                self.level = max(0, self.level - 1)  # 错误恢复
```

### 2.4 故障注入 / 演练

```python
# chaos/faults.py
class FaultInjector:
    def inject_latency(self, ms, duration_s):
        """在某个服务加 ms 延迟"""
        pass
    
    def inject_error(self, code, rate, duration_s):
        """注入错误"""
        pass
    
    def kill_pod(self, name):
        """杀 Pod"""
        pass

# 演练
injector = FaultInjector()
injector.inject_latency(asr_service, 500, 60)  # ASR 加 500ms 延迟
# 观察客户端 ASR 指标、告警、自动降级是否触发
```

### 2.5 切流 / 灰度

```bash
# 10% 流量切到新版本
kubectl patch svc voice-gateway -p '
{
  "spec": {
    "selector": {
      "version": "v2"
    }
  }
}'

# 通过 Istio 灰度
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: voice-gateway
spec:
  hosts: [voice-gateway]
  http:
  - match:
    - headers:
        x-gray-tag:
          exact: canary
    route:
    - destination: { host: voice-gateway, subset: v2 }
  - route:
    - destination: { host: voice-gateway, subset: v1 }
      weight: 90
    - destination: { host: voice-gateway, subset: v2 }
      weight: 10
```

### 2.6 灾备演练

| 演练 | 频率 | 操作 |
|---|---|---|
| 单服务故障 | 周 | 杀 ASR Pod |
| 节点故障 | 月 | 杀一个 K8s 节点 |
| 机房断网 | 季 | 网络 ACL 切 |
| 全局故障 | 半年 | 主中心全挂 → 切灾备 |
| 数据恢复 | 半年 | 备份恢复演练 |

### 2.7 数据备份

| 数据 | 备份策略 | RPO | RTO |
|---|---|---|---|
| Redis | 主从 + AOF | 0 | 30s |
| MySQL | 主从 + binlog | 0 | 5min |
| 录音 | OSS 跨 region 复制 | 1h | 1h |
| 配置 | Nacos 导出 | 0 | 5min |

---

## 3. 安全

### 3.1 安全体系

```
┌──────────────────────────────────────────────┐
│  应用安全                                       │
│  - 鉴权 (OAuth/JWT)                            │
│  - 限流 (QPS/带宽)                              │
│  - 输入校验 (协议/内容)                          │
│  - 输出过滤 (LLM Guard)                         │
├──────────────────────────────────────────────┤
│  数据安全                                       │
│  - 传输加密 (TLS 1.3)                          │
│  - 存储加密 (AES-256)                          │
│  - 密钥管理 (KMS)                              │
│  - 脱敏 (PII 数据)                             │
├──────────────────────────────────────────────┤
│  基础设施安全                                    │
│  - VPC + 安全组                                 │
│  - WAF (Web 应用防火墙)                        │
│  - DDoS 防护                                   │
│  - 主机入侵检测                                 │
├──────────────────────────────────────────────┤
│  合规与审计                                      │
│  - 操作日志                                     │
│  - 访问审计                                     │
│  - 数据生命周期                                  │
│  - 法规合规 (GDPR/CCPA/网安法)                  │
└──────────────────────────────────────────────┘
```

### 3.2 鉴权设计

```go
// edge-gateway/auth.go
type AuthMiddleware struct {
    jwks       *JWKSCache
    rateLimit  *RateLimiter
    userService UserService
}

func (m *AuthMiddleware) Authenticate(r *http.Request) (*User, error) {
    // 1. 取 token
    token := extractToken(r)

    // 2. 解析 + 验签
    claims, err := m.jwks.Verify(token)
    if err != nil {
        return nil, ErrAuthInvalid
    }

    // 3. 检查 token 撤销
    if m.isRevoked(claims.JTI) {
        return nil, ErrTokenRevoked
    }

    // 4. 取用户
    user, err := m.userService.Get(claims.Sub)
    if err != nil || user.Status != "active" {
        return nil, ErrUserInvalid
    }

    return user, nil
}
```

**Token 设计**：

```json
// 短令牌（10min TTL）
{
  "iss": "voice-auth",
  "sub": "u_123",
  "aud": "voice-gateway",
  "exp": 1718789400,
  "iat": 1718788800,
  "jti": "tok_xxx",
  "scope": ["voice:agent", "voice:tts"]
}
```

### 3.3 限流

```go
// 令牌桶
type RateLimiter struct {
    buckets sync.Map
}

func (r *RateLimiter) Allow(userId string, action string) bool {
    key := userId + ":" + action
    bucket := r.getBucket(key, /* capacity */ 100, /* refillPerSec */ 10)
    return bucket.Take()
}

// 使用
if !rateLimiter.Allow(userId, "voice_session") {
    return ErrRateLimit
}
if !rateLimiter.Allow(userId, "voice_audio_kbps:32") {
    // 带宽限流
    downgradeBitrate()
}
```

### 3.4 输入校验

```python
# gateway/input_validator.py
class InputValidator:
    def __init__(self):
        self.max_audio_seconds = 60
        self.max_text_length = 5000
        self.forbidden_patterns = [...]  # 敏感词

    def validate_hello(self, payload):
        # 1. 协议版本
        if payload.version != "1.0":
            raise ProtocolError("UNSUPPORTED_VERSION")
        # 2. 模式合法
        if payload.mode not in VALID_MODES:
            raise ProtocolError("INVALID_MODE")
        # 3. 配置范围
        if payload.config.audio.sampleRate not in [8000, 16000, 24000]:
            raise ProtocolError("INVALID_SAMPLE_RATE")

    def validate_audio_frame(self, frame):
        # 1. 大小
        if len(frame.data) > MAX_FRAME_SIZE:
            raise ProtocolError("FRAME_TOO_LARGE")
        # 2. 序号连续
        # 3. 时间戳合理

    def validate_text(self, text):
        if len(text) > self.max_text_length:
            raise ProtocolError("TEXT_TOO_LONG")
        for pattern in self.forbidden_patterns:
            if pattern.search(text):
                raise ProtocolError("TEXT_FORBIDDEN")
```

### 3.5 输出过滤（LLM Guard）

```python
# gateway/output_filter.py
class OutputFilter:
    def __init__(self):
        self.sensitive_words = load_sensitive_words()  # 100k+
        self.llm_judge = LLMJudge()  # 用 LLM 评判

    async def filter_stream(self, token_stream):
        buf = ""
        async for token in token_stream:
            buf += token

            # 1. 敏感词（实时检查，避免长串敏感词）
            if self.has_sensitive(buf):
                yield "[已过滤]"
                return  # 终止

            # 2. 异步评判（每 100 token 调一次）
            if len(buf) % 100 < len(token):
                asyncio.create_task(self.llm_judge.check(buf))

            yield token

    def has_sensitive(self, text: str) -> bool:
        # AC 自动机 O(n) 检测
        return self.ac_automaton.match(text)
```

### 3.6 数据加密

#### 传输加密

```
客户端 ─── TLS 1.3 ──→ Edge Gateway
                      ↓ (内网 mTLS)
                  Voice Gateway
                      ↓ (mTLS)
                  ASR / LLM / TTS
```

- 外部：TLS 1.3（强加密套件）
- 内部：mTLS（双向证书）

#### 存储加密

```python
# 录音加密
class RecordingEncryptor:
    def __init__(self, kms):
        self.kms = kms
        self.data_key = kms.generate_data_key()  # 一次一密

    def encrypt(self, pcm_bytes):
        # 1. 用 data_key 加密（高效对称）
        encrypted = AES_GCM.encrypt(pcm_bytes, self.data_key)
        # 2. data_key 本身用 KMS 主密钥加密后存
        wrapped_key = self.kms.wrap(self.data_key)
        return {"data": encrypted, "key": wrapped_key}
```

#### 密钥管理

- 使用 **KMS**（阿里/腾讯/AWS KMS）
- 主密钥永不离开 KMS
- 数据密钥每次会话生成
- 定期轮换主密钥

### 3.7 隐私保护

#### 用户数据最小化

```yaml
采集原则:
  - 仅采集业务必需数据
  - 明确告知用户
  - 用户可关闭

录音:
  - 默认不录制
  - 用户授权后录制
  - 留档期 90 天（业务可配）
  - 用户可主动删除
```

#### GDPR / CCPA 合规

- **数据可携**：用户可导出全部数据
- **被遗忘权**：用户可删除全部数据
- **明示同意**：第一次使用时明确勾选
- **数据本地化**：欧盟用户数据存欧盟

#### 脱敏

```python
# 敏感信息脱敏
def mask_sensitive(text: str) -> str:
    text = re.sub(r'\d{11}', '[手机号]', text)  # 手机号
    text = re.sub(r'\d{17}[\dXx]', '[身份证]', text)  # 身份证
    text = re.sub(r'[\w.-]+@[\w.-]+', '[邮箱]', text)  # 邮箱
    text = re.sub(r'\d{16,19}', '[银行卡]', text)  # 银行卡
    return text
```

### 3.8 风控体系

```
┌────────────────────────────────────────────────┐
│  内容风控                                        │
│  - ASR 旁路 → 实时敏感词                          │
│  - LLM 输入 → 提示词注入防御                      │
│  - LLM 输出 → 敏感词 + LLM 评判                  │
│  - TTS 旁路 → 关键词监测                          │
├────────────────────────────────────────────────┤
│  行为风控                                        │
│  - 设备指纹                                       │
│  - 频率限制                                       │
│  - 异常模式识别                                    │
│  - 撞库检测                                       │
├────────────────────────────────────────────────┤
│  业务风控                                        │
│  - 资金风险（金融场景）                             │
│  - 舆情风险                                       │
│  - 监管合规                                       │
└────────────────────────────────────────────────┘
```

#### 旁路 ASR 风控

```python
# 风控旁路 ASR
class RiskControlASR:
    def __init__(self, main_asr, risk_asr):
        self.main_asr = main_asr
        self.risk_asr = risk_asr

    async def stream(self, audio):
        # 主 ASR 走业务
        main_task = self.main_asr.stream(audio)

        # 旁路 ASR 走风控（用更便宜/更快的模型）
        risk_task = self.risk_asr.stream(audio)

        # 任一命中敏感词 → 切流
        async def watch_risk():
            async for text in risk_task:
                if self.is_sensitive(text):
                    await self.alert(text)
                    await self.cutoff_session()
        asyncio.create_task(watch_risk())

        async for ev in main_task:
            yield ev
```

#### 提示词注入防御

```python
# 防御"忽略之前的指令"类攻击
class PromptInjectionGuard:
    BLOCK_PATTERNS = [
        r"忽略.*指令",
        r"ignore.*previous",
        r"system\s*prompt",
        r"<\|im_start\|>",
    ]

    def check(self, text: str) -> bool:
        return any(re.search(p, text, re.I) for p in self.BLOCK_PATTERNS)
```

### 3.9 法规合规清单

#### 中国

- [x] **《生成式人工智能服务管理暂行办法》**：算法备案、用户协议、内容审核
- [x] **《互联网信息服务深度合成管理规定》**：深度合成标识
- [x] **《数据安全法》**：数据分类分级、加密、审计
- [x] **《个人信息保护法》**：明示同意、最小化、可删除
- [x] **《网络安全法》**：等保 2.0 三级
- [x] **内容审核**：实时过滤违规内容

#### 欧盟

- [x] **GDPR**：数据可携、被遗忘、明示同意
- [x] **AI Act**（2024 通过）：高风险 AI 系统评估
- [x] **ePrivacy**：Cookie 同意

#### 美国

- [x] **CCPA**（加州）：数据可携、删除
- [x] **州级录音法**：双方/单方同意
- [x] **HIPAA**（医疗）：BAA 协议
- [x] **COPPA**（儿童）：13 岁以下特别保护

#### 行业

- [x] **金融**：持牌经营、录音留档、反洗钱
- [x] **医疗**：HIPAA、PHI 加密
- [x] **教育**：未成年人保护、内容审核

### 3.10 深度合成标识（中国法规要求）

```python
# 所有 TTS 输出加隐形水印 + 显式标识
def add_watermark(audio, text):
    # 1. 显式：播报前加 "以下为 AI 合成"
    # 2. 隐形：频域水印（无法听出但可检测）
    # 3. 元数据：在音频文件 metadata 写 AI 标识
    return watermarked_audio
```

### 3.11 安全审计

```python
# 审计日志
audit_log.info({
    "ts": now(),
    "user_id": user_id,
    "action": "session.start",
    "ip": client_ip,
    "user_agent": ua,
    "session_id": session_id,
    "result": "success"
})
```

**关键审计**：
- 登录/登出
- 会话开始/结束
- 录音下载
- 敏感数据访问
- 管理员操作

### 3.12 红蓝对抗

| 项目 | 频率 | 内容 |
|---|---|---|
| 渗透测试 | 半年 | Web/API 渗透 |
| 漏洞扫描 | 周 | 自动化扫描 |
| 红蓝对抗 | 年 | 真实攻击演练 |
| 第三方审计 | 年 | 外部安全公司 |

---

## 4. 压测与容量规划

### 4.1 压测方法

#### 工具

- **k6 / Locust**：HTTP/WS 压测
- **自研语音客户端**：模拟真实音频流
- **云厂商压测服务**：阿里 PTS / 腾讯压测大师

#### 测试场景

```javascript
// k6 压测脚本
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },    // 100 并发
    { duration: '5m', target: 1000 },   // 1000 并发
    { duration: '5m', target: 5000 },   // 5000 并发
    { duration: '2m', target: 0 }       // 降
  ]
};

export default function () {
  const url = 'wss://voice.example.com/v1/ws?token=' + __ENV.TOKEN;
  const res = ws.connect(url, null, (socket) => {
    socket.on('open', () => {
      // 发 HELLO
      socket.send(JSON.stringify({ type: 'HELLO', mode: 'voice_caption', ... }));
      // 发音频
      setInterval(() => {
        socket.send(audioFrame());
      }, 100);
    });
    socket.on('message', (data) => {
      check(data, { 'received partial': (d) => d.includes('asr.partial') });
    });
    socket.setTimeout(() => socket.close(), 60000);
  });
  check(res, { 'connected': (r) => r && r.status === 101 });
}
```

#### 关键指标

| 指标 | 目标 | 采集 |
|---|---|---|
| 最大并发 | 10k | 服务端 |
| E2E P95 | < 1.8s | Trace |
| 错误率 | < 0.5% | Metrics |
| 长稳（24h） | 内存无泄漏 | 监控 |
| 故障注入 | 恢复时间 < 1min | 演练 |

### 4.2 容量模型

```
# 单 Pod 容量
single_pod_capacity = min(
    cpu_capacity / per_session_cpu,  # CPU 限制
    memory_capacity / per_session_mem,  # 内存限制
    nic_capacity / per_session_bandwidth,  # 带宽限制
    downstream_concurrent_limit  # 依赖服务限制
)

# 假设：
# - Pod 2 CPU, 4Gi
# - 单会话 0.02 CPU, 50MB
# - 单会话上下行 50kbps
# - ASR 限制 1000 并发 / 实例

single_pod_capacity = min(2/0.02, 4*1024/50, 1000/8, 1000) = 100 (按最严限制)
```

### 4.3 性能基准

| 组件 | 单实例容量 | 备注 |
|---|---|---|
| Edge-Gateway (Go) | 500~1000 会话 | CPU 密集 |
| Voice-Gateway (Python) | 100~200 会话 | IO 密集 |
| ASR 服务（自建，A10） | 50~100 并发 | GPU |
| LLM 服务（A10） | 200~500 TPS | 取决于模型 |
| TTS 服务（A10） | 50~100 并发 | 字符/秒 |

### 4.4 长稳测试

- **24h 持续压测**：5000 并发
- 观察：内存增长、CPU 趋势、错误率、连接数
- 重点：**内存泄漏**（最常见问题）

### 4.5 性能优化清单

| 优化 | 效果 |
|---|---|
| Go 替代 Python（热点） | +5x |
| 协议用 Protobuf | -30% 流量 |
| 连接池复用 | -50% 握手 |
| Goroutine 池 | -40% 内存 |
| 零拷贝 (io_uring) | +30% IO |
| 预热/预连接 | -200ms E2E |
| 模型量化 (INT8) | -50% GPU |
| GPU 共享 (MIG) | +50% 利用率 |

---

## 5. 事故复盘模板

```markdown
## 事故复盘：[简短标题]

### 基本信息
- 时间：2026-06-19 16:00 - 16:30
- 等级：P1
- 影响：30% 用户端到端延迟 > 5s
- 持续：30 min

### 时间线
- 16:00 告警触发：E2E P95 > 5s
- 16:02 oncall 介入
- 16:05 发现 ASR 服务响应慢
- 16:10 切到备用 ASR
- 16:15 流量恢复
- 16:30 完全恢复

### 根因
- 主 ASR 集群 GPU OOM，因为新版本内存泄漏
- HPA 未及时扩缩

### 改进措施
- [ ] 灰度时增加内存监控告警（owner: 张三, deadline: 06-26）
- [ ] ASR 服务增加自动重启（owner: 李四, deadline: 06-26）
- [ ] 增加备用 ASR 流量比例（owner: 王五, deadline: 07-03）
```

---

## 6. 变更管理

### 6.1 发布流程

```
代码合并 → 自动化测试 → 灰度 5% → 灰度 25% → 全量
  ↓           ↓            ↓          ↓
 开发     单元/集成/E2E   监控 10min   监控 30min
```

### 6.2 灰度策略

- 按 **用户 ID 哈希** 分流
- 按 **地域** 分流（新功能先小城市）
- 按 **版本** 分流（强制升级）

### 6.3 回滚

- **金丝雀回滚**：HPA / 流量切回 v1
- **代码回滚**：`kubectl rollout undo`
- **配置回滚**：Nacos 一键回滚
- **数据库回滚**：蓝绿发布 / 影子表

### 6.4 数据库迁移

- 兼容老代码（先加字段，不删字段）
- 灰度（先 1% 流量切到新 schema）
- 全量后保留老字段 7 天再清理

---

## 7. SLA 与可用性

### 7.1 SLA 目标

| 指标 | 目标 | 计算 |
|---|---|---|
| 可用性 | 99.9% | 月停服 < 43min |
| E2E P95 | < 1.8s | |
| E2E P50 | < 1.2s | |
| ASR 准确率 | > 95% | |
| 错误率 | < 0.5% | |
| 客户支持 | 5min 内响应（P1）| |

### 7.2 SLA 监控

```python
# 月度 SLA 计算
def calculate_sla(month):
    total_minutes = 30 * 24 * 60
    downtime = sum(
        incident.duration_minutes
        for incident in month.incidents
    )
    availability = 1 - downtime / total_minutes
    return {
        "availability": f"{availability * 100:.3f}%",
        "downtime_minutes": downtime,
        "sla_met": availability >= 0.999
    }
```

### 7.3 补偿策略

未达到 SLA → 自动赠送时长 / 退款

```python
def compensate(user, sla_breach):
    if sla_breach > 0.5:
        return user.extend_premium(days=7)
    elif sla_breach > 0.2:
        return user.extend_premium(days=3)
```

---

## 8. 文档与知识沉淀

### 8.1 必备文档

| 文档 | 受众 | 更新频率 |
|---|---|---|
| 架构总览 | 全员 | 季度 |
| 协议规范 | 开发 | 月 |
| API 参考 | 业务 | 周 |
| Runbook | 运维 | 周 |
| 事故复盘 | 全员 | 每次事故 |
| 安全合规 | 合规 | 半年 |
| 性能基线 | 性能 | 月 |

### 8.2 知识库

- **Wiki**：所有文档
- **ADR**（架构决策记录）：重要决策记录
- **AAR**（事后回顾）：事故复盘
- **RFC**（请求评论）：重要技术变更

---

## 9. 上线检查清单

### 9.1 上线前（必做）

- [ ] 协议版本兼容
- [ ] 鉴权配置正确
- [ ] 限流配置正确
- [ ] 监控指标全
- [ ] 告警规则配
- [ ] 灰度方案定
- [ ] 回滚方案定
- [ ] 故障预案明
- [ ] 文档更新

### 9.2 上线后（24h 内）

- [ ] 错误率 < 0.5%
- [ ] 延迟 P95 < 1.8s
- [ ] 资源水位正常
- [ ] 无内存泄漏
- [ ] 日志无异常
- [ ] 用户反馈正常

---

## 10. 总结：可观测/容灾/安全核心原则

| 原则 | 解释 |
|---|---|
| **可观测先行** | 没监控就别上线 |
| **假设一切都会挂** | 依赖服务都可能故障 |
| **自动恢复** | 人不在也能自愈 |
| **最小权限** | 每个人/服务只给必需权限 |
| **零信任** | 任何请求都验证 |
| **默认安全** | 安全设计而非补丁 |
| **合规底线** | 不触碰法规红线 |
| **持续演练** | 灾备不练等于没有 |

---

## 11. 资源

- [SRE Workbook (Google)](https://sre.google/workbook/table-of-contents/)
- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [中国《生成式 AI 服务管理办法》](http://www.cac.gov.cn/)
- [欧盟 AI Act](https://artificialintelligenceact.eu/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Chaos Engineering (Netflix)](https://principlesofchaos.org/)

---

> **完结**：本套文档共 5 篇，覆盖了实时语音交互系统的**架构 / 协议 / 客户端 / 服务端 / 可观测与安全**全链路。
> - 主架构：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> - 协议与状态机：[`voice-realtime-protocol.md`](./voice-realtime-protocol.md)
> - 客户端 SDK：[`voice-sdk-client.md`](./voice-sdk-client.md)
> - 服务端基础设施：[`voice-backend-infra.md`](./voice-backend-infra.md)
> - 可观测/容灾/安全：[`voice-observability-security.md`](./voice-observability-security.md)（本篇）
