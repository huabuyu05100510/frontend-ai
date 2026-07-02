# 实时语音交互：客户端 SDK 设计

> 主文档：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> 协议文档：[`voice-realtime-protocol.md`](./voice-realtime-protocol.md)
> 本篇聚焦：**Voice SDK 的统一 API、H5/PC/小程序三端适配、AudioWorklet / Web Audio / 录音器细节、UI 规范**。

---

## 1. SDK 总体目标

| 目标 | 说明 |
|---|---|
| **统一 API** | 一套 API 覆盖 H5 / PC / 小程序 |
| **传输透明** | WebRTC / WebSocket 自动选择，业务不感知 |
| **低延迟** | AudioWorklet、libsamplerate、流式、分片 |
| **可降级** | 网络差 / 设备差自动降级 |
| **可观测** | 内置打点、错误上报 |
| **可扩展** | 插件化（VAD、自定义 TTS、自定义字幕 UI） |

---

## 2. SDK 目录结构

```
@company/voice-sdk/
├── packages/
│   ├── core/                  # 平台无关核心
│   │   ├── state-machine/     # 状态机
│   │   ├── protocol/          # 协议编解码
│   │   ├── vad/               # VAD 引擎
│   │   ├── transport/         # 传输抽象
│   │   ├── session/           # 会话管理
│   │   └── events/            # 事件总线
│   ├── web/                   # H5 / PC 浏览器
│   │   ├── audio/
│   │   │   ├── capture-worklet.ts
│   │   │   ├── playback.ts
│   │   │   └── resampler.ts
│   │   ├── transport/
│   │   │   ├── webrtc.ts
│   │   │   └── websocket.ts
│   │   └── index.ts
│   ├── wechat-mp/             # 微信小程序
│   │   ├── audio/
│   │   │   ├── recorder.ts
│   │   │   ├── inner-audio.ts
│   │   │   └── vad.ts         # 主线程轻量
│   │   ├── transport/
│   │   │   └── websocket.ts
│   │   └── index.ts
│   ├── electron/              # Electron
│   │   └── index.ts
│   └── react/                 # React Hooks + UI
│       ├── hooks/
│       │   ├── useVoiceSession.ts
│       │   ├── useSubtitles.ts
│       │   └── useVoiceAgent.ts
│       └── components/
│           ├── VoiceButton.tsx
│           ├── SubtitlePanel.tsx
│           ├── VoiceWave.tsx
│           └── VoiceOrb.tsx
```

---

## 3. 统一 API（业务侧）

```ts
// 任何端通用
import { createVoiceSession } from '@company/voice-sdk';

const session = createVoiceSession({
  endpoint: 'wss://voice.example.com/v1',
  auth: async () => ({ appId, token, userId }),
  mode: 'voice_agent',  // voice_caption | voice_translate | voice_agent | tts | s2s
  transport: 'auto',    // auto | webrtc | websocket
  config: {
    lang: 'zh-CN',
    voice: 'zh_female_warm',
    hotwords: ['豆包'],
    systemPrompt: '你是友好的语音助手'
  },
  ui: { mount: '#voice-root' }  // 可选, 渲染内置 UI
});

// 事件
session.on('ready',      () => console.log('已就绪'));
session.on('state',      (s) => console.log('状态', s));
session.on('asr.partial',(e) => updateSubtitle(e.text));
session.on('asr.final',  (e) => commitSubtitle(e.text));
session.on('llm.token',  (e) => appendReply(e.text));
session.on('tts.start',  () => showSpeaking());
session.on('tts.end',    () => hideSpeaking());
session.on('bargein',    () => console.log('用户打断'));
session.on('error',      (e) => toast(e.message));
session.on('metric',     (m) => analytics.track(m.name, m.value));

// 控制
await session.start();
session.pushText('要朗读的文本');
session.bargeIn();
await session.mute(true);
await session.stop();

// 数据
const stats = session.getStats();
```

---

## 4. 终端能力检测与传输选择

```ts
// core/transport/selector.ts
export async function pickTransport(preferred?: string): Promise<'webrtc' | 'websocket'> {
  if (preferred && preferred !== 'auto') return preferred;

  // 1. 小程序：必走 WS
  if (isWechatMP()) return 'websocket';

  // 2. 浏览器：探测 RTCPeerConnection
  if (typeof RTCPeerConnection === 'undefined') return 'websocket';

  // 3. 网络测速
  const rtt = await probeRTT();
  if (rtt > 300) return 'websocket';  // 弱网降级

  // 4. 默认 RTC
  return 'webrtc';
}

async function probeRTT(): Promise<number> {
  const t = performance.now();
  await fetch('/ping', { cache: 'no-store' });
  return performance.now() - t;
}
```

**自适应**：会话中监测 RTT / 丢包 / 延迟，动态切换。

---

## 5. Web 端：H5 / PC

### 5.1 音频采集（AudioWorklet）

**目标**：在独立线程采集 → 重采样到 16k → 编码 Opus → 100ms 分片。

```ts
// web/audio/capture-worklet.ts
import { SRC_SINC_FASTEST } from 'libsamplerate-js/wasm';

class CaptureProcessor extends AudioWorkletProcessor {
  private rs: any;
  private chunkSamples = 1600; // 100ms @ 16k
  private ringBuffer: Float32Array = new Float32Array(0);

  async init() {
    // 加载重采样器
    const wasm = await import('libsamplerate-js/wasm');
    this.rs = new wasm.SampleRate(48000, 16000, 1, SRC_SINC_FASTEST);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    // 1. 重采样
    const resampled = this.rs.full(input) as Float32Array;

    // 2. 拼接到 ring buffer
    const newBuf = new Float32Array(this.ringBuffer.length + resampled.length);
    newBuf.set(this.ringBuffer);
    newBuf.set(resampled, this.ringBuffer.length);
    this.ringBuffer = newBuf;

    // 3. 按 100ms 分片上行
    while (this.ringBuffer.length >= this.chunkSamples) {
      const chunk = this.ringBuffer.slice(0, this.chunkSamples);
      this.ringBuffer = this.ringBuffer.slice(this.chunkSamples);
      this.postMessage(this.encodeOpus(chunk), []);
    }
    return true;
  }

  encodeOpus(samples: Float32Array): ArrayBuffer {
    // Float32 → Int16 → ArrayBuffer
    const pcm16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16.buffer;
  }
}
registerProcessor('capture', CaptureProcessor);
```

**主线程**：

```ts
// web/audio/capture.ts
export async function createCapture(ctx: AudioContext, onFrame: (buf: ArrayBuffer) => void) {
  await ctx.audioWorklet.addModule('/worklets/capture-worklet.js');
  const source = ctx.createMediaStreamSource(await getMic());
  const node = new AudioWorkletNode(ctx, 'capture');
  source.connect(node);
  node.port.onmessage = (e) => onFrame(e.data);
  return { source, node };
}

async function getMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // 不设 sampleRate: 浏览器会给我们 48k
      echoCancellation: true,    // 重要: 抗 AI 声音回声
      noiseSuppression: true,
      autoGainControl: false      // 关闭: AGC 会让 AI 声音被听见
    }
  });
}
```

### 5.2 音频播放（Web Audio）

```ts
// web/audio/playback.ts
export class StreamPlayer {
  private ctx = new AudioContext();
  private nextPlayTime = 0;
  private ahead = 0.05;
  private sources: AudioBufferSourceNode[] = [];
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private interrupted = false;

  enqueue(pcm16: ArrayBuffer, sampleRate = 24000) {
    if (this.interrupted) return;
    this.queue.push(pcm16);
    if (!this.playing) this.drain();
  }

  private async drain() {
    this.playing = true;
    while (this.queue.length > 0 && !this.interrupted) {
      const buf = this.queue.shift()!;
      const source = this.createSource(buf, this.ctx.sampleRate);
      this.sources.push(source);

      const now = this.ctx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now + this.ahead;
      source.start(this.nextPlayTime);
      this.nextPlayTime += source.buffer!.duration;
    }
    this.playing = false;
  }

  private createSource(buf: ArrayBuffer, sampleRate: number): AudioBufferSourceNode {
    const pcm16 = new Int16Array(buf);
    const f32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768;

    const ab = this.ctx.createBuffer(1, f32.length, sampleRate);
    ab.getChannelData(0).set(f32);

    const src = this.ctx.createBufferSource();
    src.buffer = ab;
    src.connect(this.ctx.destination);
    return src;
  }

  interrupt() {
    this.interrupted = true;
    this.sources.forEach(s => { try { s.stop(); } catch {} });
    this.sources = [];
    this.queue = [];
    this.nextPlayTime = 0;
    // 立即恢复可接受新音频
    setTimeout(() => { this.interrupted = false; }, 50);
  }

  destroy() {
    this.interrupt();
    this.ctx.close();
  }
}
```

### 5.3 WebRTC 传输

```ts
// web/transport/webrtc.ts
export class WebRTCTransport implements Transport {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel;
  private audioSender: RTCRtpSender;
  private audioReceiver: RTCRtpReceiver;

  async connect(endpoint: string, token: string) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.example.com' }],
      bundlePolicy: 'max-bundle'
    });

    // 接收 AI 音频
    this.pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0];
      audio.play();
    };

    // 控制数据通道
    this.dc = this.pc.createDataChannel('control', { ordered: true });
    this.dc.onmessage = (e) => this.handleMessage(e.data);

    // 推本地音频
    const stream = await getMic();
    this.audioSender = this.pc.addTrack(stream.getAudioTracks()[0], stream);

    // SDP 握手
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);

    const res = await fetch(`${endpoint}?token=${token}`, {
      method: 'POST',
      body: offer.sdp,
      headers: { 'Content-Type': 'application/sdp' }
    });
    const answer = await res.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  send(frame: Frame) {
    if (this.dc.readyState === 'open') this.dc.send(frame.encode());
  }
}
```

### 5.4 WebSocket 传输（降级用）

```ts
// web/transport/websocket.ts
export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private queue: ArrayBuffer[] = [];
  private sendSeq = 0;

  connect(endpoint: string, token: string) {
    this.ws = new WebSocket(`${endpoint}?token=${token}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => this.flush();
    this.ws.onmessage = (e) => this.handleMessage(e.data);
  }

  send(frame: Frame) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame.encode());
    } else {
      this.queue.push(frame.encode());
    }
  }

  private flush() {
    while (this.queue.length) this.ws.send(this.queue.shift()!);
  }
}
```

### 5.5 VAD（双层）

```ts
// core/vad/energy-vad.ts
export class EnergyVAD {
  speaking = false;
  private silenceMs = 0;
  private speechMs = 0;
  private listeners: ((e: 'start' | 'end') => void)[] = [];

  on(ev: 'start' | 'end', cb: () => void) { this.listeners.push(cb); }

  feed(pcm16: Int16Array) {
    let sum = 0;
    for (let i = 0; i < pcm16.length; i++) sum += pcm16[i] * pcm16[i];
    const rms = Math.sqrt(sum / pcm16.length) / 32768;

    if (rms > 0.02) {
      this.silenceMs = 0;
      this.speechMs += 100;
      if (!this.speaking && this.speechMs > 200) {
        this.speaking = true;
        this.listeners.forEach(cb => cb('start'));
      }
    } else {
      this.speechMs = 0;
      this.silenceMs += 100;
      if (this.speaking && this.silenceMs > 500) {
        this.speaking = false;
        this.listeners.forEach(cb => cb('end'));
      }
    }
  }
}
```

### 5.6 完整 Web SDK 入口

```ts
// web/index.ts
import { createVoiceSession } from '@company/voice-sdk-core';

export function createWebVoiceSession(opts: VoiceOptions) {
  return createVoiceSession({
    ...opts,
    factories: {
      capture: createCapture,
      playback: () => new StreamPlayer(),
      transport: async (endpoint, token) => {
        const mode = await pickTransport(opts.transport);
        return mode === 'webrtc'
          ? new WebRTCTransport()
          : new WebSocketTransport();
      },
      vad: () => new EnergyVAD()
    }
  });
}
```

---

## 6. 微信小程序

### 6.1 录音（PCM 分片）

```ts
// wechat-mp/audio/recorder.ts
export class MpRecorder {
  private manager = wx.getRecorderManager();
  private onFrame: (buf: ArrayBuffer) => void;
  private started = false;

  constructor(onFrame: (buf: ArrayBuffer) => void) {
    this.onFrame = onFrame;
    this.manager.onFrameRecorded((res) => {
      // res.frameBuffer: ArrayBuffer, PCM 16k 16bit
      this.onFrame(res.frameBuffer);
    });
    this.manager.onError((err) => console.error('录音错误', err));
  }

  start() {
    if (this.started) return;
    this.manager.start({
      duration: 60 * 60 * 1000,    // 1 小时
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 256000,
      format: 'PCM',
      frameSize: 5                 // 5KB 触发 onFrameRecorded
    });
    this.started = true;
  }

  stop() {
    if (!this.started) return;
    this.manager.stop();
    this.started = false;
  }
}
```

### 6.2 播放（InnerAudioContext + 缓冲队列）

```ts
// wechat-mp/audio/playback.ts
export class MpStreamPlayer {
  private audio = wx.createInnerAudioContext({ useWebAudioImplement: true });
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private interrupted = false;

  constructor() {
    this.audio.onEnded(() => this.drain());
    this.audio.onError((e) => console.error('播放错误', e));
  }

  enqueue(pcm16: ArrayBuffer, sampleRate = 24000) {
    if (this.interrupted) return;
    this.queue.push(pcm16);
    if (!this.playing) this.drain();
  }

  private drain() {
    if (this.queue.length === 0) { this.playing = false; return; }
    const buf = this.queue.shift()!;
    // PCM → wav 临时文件
    const wav = pcmToWav(buf, 24000);
    const fs = wx.getFileSystemManager();
    const path = `${wx.env.USER_DATA_PATH}/t_${Date.now()}.wav`;
    fs.writeFileSync(path, wav, 'binary');
    this.audio.src = path;
    this.audio.play();
    this.playing = true;
  }

  interrupt() {
    this.interrupted = true;
    this.audio.stop();
    this.queue = [];
    setTimeout(() => { this.interrupted = false; }, 50);
  }

  destroy() {
    this.interrupted = true;
    this.audio.destroy();
  }
}

function pcmToWav(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  // 16bit mono PCM → WAV 头
  const headerSize = 44;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  // RIFF
  view.setUint32(0, 0x52494646, false); // 'RIFF'
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // 'WAVE'
  // fmt
  view.setUint32(12, 0x666d7420, false); // 'fmt '
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  // data
  view.setUint32(36, 0x64617461, false); // 'data'
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, headerSize).set(new Uint8Array(pcm));
  return buffer;
}
```

### 6.3 小程序 WebSocket

```ts
// wechat-mp/transport/websocket.ts
export class MpWebSocketTransport {
  private task: WechatMiniprogram.SocketTask;
  private queue: ArrayBuffer[] = [];

  connect(url: string, token: string) {
    this.task = wx.connectSocket({
      url: `${url}?token=${token}`,
      success: () => this.flush(),
      fail: (e) => console.error('WS 失败', e)
    });
    this.task.onMessage((res) => this.handleMessage(res.data));
    this.task.onClose(() => this.handleClose());
    this.task.onError((e) => console.error('WS 错误', e));
  }

  send(buf: ArrayBuffer) {
    if (this.task.readyState === 1) {  // OPEN
      this.task.send({ data: buf });
    } else {
      this.queue.push(buf);
    }
  }
}
```

### 6.4 小程序 VAD

小程序没有 AudioWorklet，VAD 在主线程跑（计算简单，不卡顿）：

```ts
// wechat-mp/audio/vad.ts
export class MpVAD {
  speaking = false;
  private buffer: Int16Array = new Int16Array(1600); // 100ms
  private idx = 0;
  private silenceMs = 0;
  private onSpeechStart: () => void;
  private onSpeechEnd: () => void;

  feed(frame: ArrayBuffer) {
    const pcm = new Int16Array(frame);
    for (let i = 0; i < pcm.length; i++) {
      this.buffer[this.idx++] = pcm[i];
      if (this.idx === this.buffer.length) {
        this.analyze();
        this.idx = 0;
      }
    }
  }

  private analyze() {
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] ** 2;
    const rms = Math.sqrt(sum / this.buffer.length) / 32768;

    if (rms > 0.02) {
      this.silenceMs = 0;
      if (!this.speaking) { this.speaking = true; this.onSpeechStart(); }
    } else {
      this.silenceMs += 100;
      if (this.speaking && this.silenceMs > 500) {
        this.speaking = false;
        this.onSpeechEnd();
      }
    }
  }
}
```

### 6.5 小程序权限

```json
// app.json
{
  "permission": {
    "scope.record": {
      "desc": "用于实时语音交互"
    }
  }
}
```

```ts
// 首次启动引导
async function ensurePermission() {
  try {
    await wx.authorize({ scope: 'scope.record' });
    return true;
  } catch {
    wx.showModal({
      title: '需要麦克风权限',
      content: '请在设置中开启麦克风权限',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) wx.openSetting();
      }
    });
    return false;
  }
}
```

### 6.6 小程序后台限制

**关键**：小程序切后台会被限制（5s 内无操作会回收音频）。需要：

```ts
// app.js
App({
  onHide() {
    // 通知 SDK 切后台
    voiceSDK?.suspend();
  },
  onShow() {
    voiceSDK?.resume();
  }
});
```

也可以使用 **"后台持续运行"** 能力（特定类目：教育、医疗、出行等）+ `wx.setKeepScreenOn`。

---

## 7. Electron 端

```ts
// electron/main.ts
import { ipcMain, BrowserWindow } from 'electron';
import { createVoiceSession } from '@company/voice-sdk-core';

ipcMain.handle('voice:start', async (e, opts) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const session = createVoiceSession({
    ...opts,
    factories: {
      capture: () => createDesktopCapture(),
      playback: () => new StreamPlayer(),
      transport: ...
    }
  });
  // 转发事件到渲染进程
  ['asr.partial', 'llm.token', 'tts.end', 'error'].forEach(ev => {
    session.on(ev, (data) => win.webContents.send(`voice:${ev}`, data));
  });
  await session.start();
  return session.id;
});

// 用 systemAudio / macOS CoreAudio 采集系统声音（用于截屏+语音讲解）
```

### 7.1 桌面端特有能力

| 能力 | 用途 |
|---|---|
| 系统音频捕获 | 截屏/录屏 + AI 实时讲解 |
| 全局快捷键 | `Ctrl+Shift+Space` 唤起语音 |
| 系统通知 | 打断时系统级提示 |
| 多声道选择 | 麦克风 + 系统声音分轨 |

---

## 8. UI 组件库

### 8.1 核心组件

```tsx
// react/components/VoiceButton.tsx
export function VoiceButton({ session }: { session: VoiceSession }) {
  const [state, setState] = useState(session.state);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    session.on('state', setState);
    session.on('audio.level', setLevel);
  }, [session]);

  return (
    <button
      className={`voice-btn voice-btn--${state}`}
      onPointerDown={() => session.start()}
      onPointerUp={() => session.bargeIn()}
    >
      {state === 'listening' && <VoiceWave level={level} />}
      {state === 'tts_streaming' && <VoiceOrb speaking />}
      {state === 'idle' && <MicIcon />}
    </button>
  );
}
```

### 8.2 字幕

```tsx
// react/components/SubtitlePanel.tsx
export function SubtitlePanel({ session, lang = 'zh' }: any) {
  const [partial, setPartial] = useState('');
  const [finals, setFinals] = useState<{ role: string; text: string }[]>([]);

  useEffect(() => {
    session.on('asr.partial', (e) => setPartial(e.text));
    session.on('asr.final', (e) => {
      setFinals(f => [...f, { role: 'user', text: e.text }]);
      setPartial('');
    });
    session.on('llm.token', (e) => {/* 追加 AI 回复 */});
  }, []);

  return (
    <div className="subtitle-panel">
      {finals.map((f, i) => <Bubble key={i} {...f} />)}
      {partial && <Bubble role="user" text={partial} dim />}
    </div>
  );
}
```

### 8.3 波形可视化

```ts
// 实时显示音浪
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
source.connect(analyser);

const data = new Uint8Array(analyser.frequencyBinCount);
function tick() {
  analyser.getByteTimeDomainData(data);
  const rms = Math.sqrt(data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length) / 128;
  session.emit('audio.level', rms);
  requestAnimationFrame(tick);
}
tick();
```

### 8.4 豆包风格"语音球"（类 Orbe）

```tsx
export function VoiceOrb({ speaking, level }: { speaking: boolean; level: number }) {
  return (
    <div className={`orb ${speaking ? 'orb--speaking' : ''}`}>
      <div className="orb__halo" style={{ transform: `scale(${1 + level * 2})` }} />
      <div className="orb__core" />
      <div className="orb__rings">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="orb__ring" style={{ '--i': i } as any} />
        ))}
      </div>
    </div>
  );
}
```

CSS 用 SVG / Canvas 做径向波动 / 频谱环。

---

## 9. 性能与电量

### 9.1 浏览器

| 优化 | 做法 |
|---|---|
| 后台暂停 | `document.visibilityState === 'hidden'` 时暂停 capture |
| 采样率自适应 | 弱网切 8k / 静音 30s 暂停上行 |
| 电量 | 关闭 VAD 动画、降低 UI 重绘频率 |
| CPU | 关闭浏览器开发者工具（影响 30%） |

### 9.2 移动端 H5

- iOS Safari 限制：AudioContext 必须在用户交互后才能 resume
- 微信内：X5 内核对 WebRTC 支持有限，**优先 WS**
- 后台运行：iOS 锁屏后会断开 WebRTC（除非使用后台音频 + LiveKit 等）

### 9.3 小程序

- 音频后台播放：使用 `wx.getBackgroundAudioManager`（需要类目）
- 电量：录音时屏幕长亮 `wx.setKeepScreenOn({ keepScreenOn: true })`

---

## 10. 调试工具

### 10.1 调试面板

```ts
// SDK 开启 debug
const session = createVoiceSession({ debug: true });

// 内部暴露
session.debug = {
  state: () => session.state,
  stats: () => session.stats,
  network: () => session.transport.getStats(),
  audio: () => session.capture.getStats(),
  inject: (frame) => session.transport.send(frame),  // 注入测试
  replay: (recording) => replayRecording(recording)  // 回放录制
};
```

### 10.2 录制与回放

```ts
// 录制
session.on('frame', (f) => recorder.write(f));
const rec = await recorder.save();  // .voice 文件

// 回放
await session.debug.replay(rec);  // 模拟真实输入
```

### 10.3 性能面板 UI

```tsx
<DebugPanel>
  <StateGraph machine={stateMachine} />
  <MetricsLine data={latencies} />
  <NetworkQuality rtt={rtt} loss={loss} />
  <AudioWaveform source={recording} />
  <EventLog events={events} />
</DebugPanel>
```

---

## 11. SDK 包体积

| 包 | 体积 (gzip) |
|---|---|
| `@voice-sdk/core` | 18KB |
| `@voice-sdk/web` | 22KB（含 worklet） |
| `@voice-sdk/wechat-mp` | 12KB |
| `@voice-sdk/react` | 5KB |
| libsamplerate-js (WASM) | 35KB |

**总计 H5 端 ~80KB gzip**，可接受。

按需加载：`import { createWebVoiceSession } from '@voice-sdk/web'` 触发 split chunk。

---

## 12. 浏览器兼容性

| 浏览器 | WebRTC | AudioWorklet | libsamplerate |
|---|---|---|---|
| Chrome ≥ 80 | ✅ | ✅ | ✅ |
| Edge ≥ 80 | ✅ | ✅ | ✅ |
| Safari ≥ 14.1 | ✅ | ✅ | ✅（14.5+）|
| Firefox ≥ 76 | ✅ | ✅ | ✅ |
| 微信内 (X5) | ⚠️ | ❌ | - |
| 微信小程序 | - | - | - |
| 鸿蒙浏览器 | ✅ | ✅ | ✅ |

**降级路径**：AudioWorklet 不支持 → 用 `ScriptProcessorNode`（低版本兼容）；X5 → 走 WS + MP3；Safari < 14.1 → 走 WS + PCM。

---

## 13. 单元测试

```ts
import { describe, it, expect } from 'vitest';
import { StreamPlayer, EnergyVAD } from '@voice-sdk/core';

describe('StreamPlayer', () => {
  it('应该按时间线顺序播放分片', async () => {
    const player = new StreamPlayer();
    const events: number[] = [];
    // 注入 mock AudioContext
    player.enqueue(mockPcm(1000));
    // 验证 nextPlayTime 累加
    expect(player.nextPlayTime).toBeCloseTo(1.0, 1);
  });

  it('interrupt() 应该清空队列和调度', () => {
    const player = new StreamPlayer();
    player.enqueue(mockPcm(1000));
    player.interrupt();
    expect(player.queue.length).toBe(0);
  });
});

describe('EnergyVAD', () => {
  it('持续语音应该判定为 speaking', () => {
    const vad = new EnergyVAD();
    const loud = new Int16Array(1600).fill(5000);
    for (let i = 0; i < 5; i++) vad.feed(loud);
    expect(vad.speaking).toBe(true);
  });
});
```

---

## 14. E2E 测试

```ts
// e2e/voice.test.ts
import { test, expect } from '@playwright/test';

test('实时转写应该端到端工作', async ({ page }) => {
  await page.goto('/voice-demo');
  await page.click('#start');

  // 注入测试音频
  await page.evaluate(async () => {
    const audio = await fetch('/test-data/zh-30s.wav').then(r => r.arrayBuffer());
    window.__voiceSdk.feedAudio(audio);
  });

  // 等待 ASR 输出
  await expect(page.locator('.subtitle')).toContainText('今天', { timeout: 5000 });
});
```

---

## 15. SDK 升级与灰度

- **API 稳定性**：核心 API (`start/stop/on/pushText/bargeIn`) 保持 SemVer
- **小版本**：新增事件、新增选项
- **大版本**：协议升级时配合服务端灰度
- **降级兼容**：SDK 内置多协议版本，自动协商

```ts
// SDK 内部
const protocolVersion = await negotiate(helloResponse);
if (protocolVersion === 'v1') useV1Protocol();
else if (protocolVersion === 'v0.9') useLegacyProtocol();
```

---

## 16. 文档与示例

| 文档 | 内容 |
|---|---|
| 快速开始 | 5 分钟集成 |
| API 参考 | 所有方法 / 事件 / 选项 |
| 模式指南 | 5 种模式的典型用法 |
| 适配指南 | 移植到新终端 |
| 性能调优 | 延迟优化、内存控制 |
| 故障排查 | 常见问题清单 |

**示例仓库**：`@company/voice-examples`
- `examples/caption/` 实时字幕
- `examples/translate/` 翻译转写
- `examples/agent/` 语音助手
- `examples/tts-blog/` 博客播放
- `examples/s2s-doubao/` 端到端

---

## 17. SDK 团队协作

- **包管理**：Monorepo (pnpm + turborepo)
- **构建**：tsup / vite / esbuild
- **发布**：changesets（自动生成 changelog）
- **测试**：vitest + playwright
- **CI**：GitHub Actions，跑 build/test/lint/example
- **文档**：Typedoc + VitePress

---

## 18. 完整调用示例：实时语音助手

```tsx
// app/voice-agent.tsx
import { useEffect, useState } from 'react';
import { createWebVoiceSession } from '@voice-sdk/web';
import { VoiceButton, SubtitlePanel, VoiceOrb } from '@voice-sdk/react';

export function VoiceAgent() {
  const [session, setSession] = useState<VoiceSession>();
  const [state, setState] = useState('idle');
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const s = createWebVoiceSession({
      endpoint: import.meta.env.VITE_VOICE_ENDPOINT,
      auth: async () => ({
        appId: 'xxx', token: 'Bearer xxx', userId: 'u_123'
      }),
      mode: 'voice_agent',
      config: {
        lang: 'zh-CN',
        voice: 'zh_female_warm',
        systemPrompt: '你是友好的语音助手'
      }
    });
    s.on('state', setState);
    s.on('asr.final', (e) => setMessages(m => [...m, { role: 'user', text: e.text }]));
    s.on('llm.token', (e) => setMessages(m => {
      const last = m[m.length - 1];
      if (last?.role === 'assistant') {
        return [...m.slice(0, -1), { ...last, text: last.text + e.text }];
      }
      return [...m, { role: 'assistant', text: e.text }];
    }));
    setSession(s);
  }, []);

  return (
    <div className="voice-agent">
      <SubtitlePanel messages={messages} />
      <VoiceOrb state={state} />
      <VoiceButton session={session!} />
    </div>
  );
}
```

---

> 下一篇：[`voice-backend-infra.md`](./voice-backend-infra.md) — 服务端与基础设施
