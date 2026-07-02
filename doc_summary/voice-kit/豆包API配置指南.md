# 豆包API配置与运行指南

## 一、API凭证配置

### 1.1 环境变量配置

在 `voice-kit` 根目录创建 `.env` 文件：

```bash
# 豆包/火山引擎配置
VK_DOUBAO_API_KEY=api-key-20260114184514
VK_DOUBAO_RESOURCE_ID=77c3e13e-35c8-45fd-b784-7cb0e6b15365

# 默认ASR端点
VK_DOUBAO_ASR_ENDPOINT=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async

# 默认TTS端点
VK_DOUBAO_TTS_ENDPOINT=wss://openspeech.bytedance.com/api/v3/tts/bidirection

# 网关端口
VK_GATEWAY_PORT=8787
```

### 1.2 凭证说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `VK_DOUBAO_API_KEY` | `api-key-20260114184514` | 新版控制台API密钥 |
| `VK_DOUBAO_RESOURCE_ID` | `77c3e13e-35c8-45fd-b784-7cb0e6b15365` | 默认体验中心资源ID |

---

## 二、架构说明

### 2.1 为什么需要Gateway？

**浏览器WebSocket的限制**：无法设置自定义Headers，而豆包API需要认证Headers。

**解决方案**：
1. **Gateway（Node.js）**：运行在服务端，接收浏览器WS连接
2. **签名代理**：Gateway向豆包API发起带认证Headers的WS连接
3. **双向透传**：浏览器 ←→ Gateway ←→ 豆包API

### 2.2 数据流

```
浏览器 (playground-web)
  ↓ WebSocket (v3/sauc 二进制协议)
Gateway (Node.js, 8787端口)
  ↓ WebSocket + 认证Headers
豆包ASR/TTS API (openspeech.bytedance.com)
```

---

## 三、运行步骤

### 3.1 安装依赖

```bash
cd voice-kit
pnpm install
```

### 3.2 启动Gateway

```bash
# 在 voice-kit 根目录
pnpm --filter @voice-kit/gateway dev
```

Gateway会监听 `ws://localhost:8787/api/asr/doubao`

### 3.3 启动Playground

```bash
pnpm --filter @voice-kit/playground-web dev
```

访问 `http://localhost:5173`

### 3.4 一键启动（推荐）

```bash
pnpm dev
```

Turbo会并行启动Gateway和Playground。

---

## 四、核心代码解读

### 4.1 Gateway签名逻辑

**文件**：`apps/gateway/src/asr-proxy.ts`

```typescript
// 构建认证Headers
const headers = buildAuthHeaders({
  apiKey: 'api-key-20260114184514',
  resourceId: '77c3e3e-35c8-45fd-b784-7cb0e6b15365'
});
// 结果：
// {
//   'X-Api-Key': 'api-key-20260114184514',
//   'Authorization': 'Bearer; ',
//   'X-Api-Resource-Id': '77c3e13e-35c8-45fd-b784-7cb0e6b15365'
// }

// 向豆包发起WS连接
const upstream = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', {
  headers: upstreamHeaders
});
```

### 4.2 浏览器端调用

**文件**：`packages/provider-doubao/src/asr-session.ts`

```typescript
const provider = new DoubaoASRProvider({ 
  gatewayUrl: 'ws://localhost:8787/api/asr/doubao' 
});

const session = await provider.openStream({
  language: 'zh-CN',
  punctuation: true,
  diarization: true,  // 说话人分离
  audioFormat: { sampleRate: 16000, encoding: 'pcm-s16le', channels: 1 }
});

// 推送音频
session.pushAudio(pcmChunk);

// 消费结果
for await (const result of session.results()) {
  if (result.kind === 'partial') {
    console.log('实时识别:', result.text);
  } else if (result.kind === 'final') {
    console.log('最终结果:', result.utterances);
  }
}
```

### 4.3 二进制协议编解码

**文件**：`packages/provider-doubao/src/codec.ts`

**帧结构**（8字节头 + 变长体）：
```
byte0 = 0x11              # 协议版本1
byte1 = (msgType << 4) | flags  # msgType: 1=配置, 2=音频
byte2 = (serial << 4) | compression  # serial: 1=JSON, compression: 0=无, 1=gzip
byte3 = 0x00              # 保留
bytes 4-7 = payload size (big-endian)
bytes 8+ = payload
```

**编码示例**：
```typescript
// 初始配置帧
const frame = encodeFullClientRequest({
  user: { uid: 'anonymous' },
  audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
  request: { 
    model_name: 'bigmodel',
    enable_punc: true,
    show_utterances: true,
    enable_speaker_info: true  // 说话人分离
  }
});

// 音频帧
const audioFrame = encodeAudioOnly(pcmData);

// 结束帧
const lastFrame = encodeAudioLast(new ArrayBuffer(0));
```

---

## 五、已实现的技术亮点

### 5.1 Volcengine v3/sauc协议TS重写

**亮点**：凭抓包+Python源码参考，纯TS实现二进制编解码器

**文件**：`packages/provider-doubao/src/codec.ts` (222行)

**能力**：
- 支持3种帧类型：FULL_REQUEST / AUDIO_ONLY / AUDIO_LAST
- 支持gzip压缩（可选pako集成）
- 解析服务端响应：提取utterances、speaker_id、words
- 黄金fixture测试覆盖

### 5.2 Gateway透明代理

**亮点**：零修改透传，支持任意协议升级

**文件**：`apps/gateway/src/asr-proxy.ts` (112行)

**能力**：
- 浏览器WS → Gateway → 豆包WSS 双向管道
- 自动注入认证Headers
- 连接生命周期管理
- 错误传播与清理

### 5.3 四路径去重Reducer

**亮点**：处理累积模式乱序partial，纯函数513行

**文件**：`packages/scene-transcribe/src/reducer.ts`

**路径**：
- A路径：文本扩展 → 增量更新
- B路径：子串回滚 → 跳过
- C路径：70%前缀重叠 → 续接
- D路径：新卡片

---

## 六、调试技巧

### 6.1 查看二进制帧

```typescript
// 在 provider-doubao/src/asr-session.ts 的 sendFullRequest() 中
console.log('TX frame:', new Uint8Array(frame));
```

### 6.2 查看服务端响应

```typescript
// 在 gateway/src/asr-proxy.ts 的 upstream.on('message') 中
console.log('RX from volcengine:', new Uint8Array(data as ArrayBuffer));
```

### 6.3 测试无Gateway直连

**仅用于Node.js环境**（浏览器无法设置Headers）：

```typescript
import { DoubaoASRProvider, buildAuthHeaders } from '@voice-kit/provider-doubao';

// 直连豆包（需要设置Headers，浏览器不支持）
const provider = new DoubaoASRProvider({
  gatewayUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  createWebSocket: (url) => {
    // Node.js ws库支持headers
    return new WebSocket(url, { headers: buildAuthHeaders({...}) });
  }
});
```

---

## 七、常见问题

### Q1: 浏览器报错 "DOMException: Failed to construct 'WebSocket'"

**原因**：浏览器WS无法设置Headers，必须通过Gateway

**解决**：确保Gateway已启动，`gatewayUrl` 指向 `ws://localhost:8787/api/asr/doubao`

### Q2: Gateway报错 "Upstream error"

**原因**：豆包API认证失败

**排查**：
1. 检查 `.env` 中 `VK_DOUBAO_API_KEY` 是否正确
2. 检查 `VK_DOUBAO_RESOURCE_ID` 是否匹配
3. 查看Gateway日志中的详细错误

### Q3: 识别结果为空

**原因**：音频格式不匹配

**检查**：
1. 确保采样率为16000Hz
2. 确保格式为PCM Int16单声道
3. 确保音频块大小合理（推荐20ms = 320 samples）

---

## 八、下一步

1. **运行Playground**：`pnpm dev` 启动完整demo
2. **测试实时转写**：点击"开始录音"，查看识别结果
3. **查看Reducer状态**：观察cards数组如何增量更新
4. **学习面试资料**：阅读 `voice-kit-面试突击.md`
