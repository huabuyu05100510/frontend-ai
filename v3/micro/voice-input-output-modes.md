# 实时语音交互：设备输入输出能力专项（用户语音输入 → 设备文字/语音输出）

> 主文档：[`voice-realtime-architecture.md`](./voice-realtime-architecture.md)
> 性能专项：[`voice-extreme-performance.md`](./voice-extreme-performance.md)
> 本篇专门拆解 **"用户语音输入 + 设备文字/语音输出"** 这条主线,给出 SDK、UI、协议、可访问性、终端差异化的完整方案。

---

## 1. 总览：输入输出解耦

### 1.1 为什么要解耦？

**传统做法**："实时转写"、"语音助手"、"同声传译"被当成三个独立产品,各自有 SDK、各自一套状态机。
**问题**：
- 大量重复代码
- 用户在不同场景切换要装不同 App
- 新场景接入成本高

**解耦做法**：把"输入"和"输出"抽象为**两条独立通道**,可任意组合:

```
       ┌─ 输入 ─┐         ┌─ 输出 ─┐
       │  Mic   │         │ Spk    │
       │  Text  │ ──SDK──→│ Screen │
       │  File  │         │ Haptic │
       └────────┘         └────────┘
```

**好处**：
- 一个 SDK,7 种输入 × 10 种输出 = 70 种产品形态
- 业务方按需开关,无需重打包
- 用户体验统一(随时切模式)

### 1.2 三种典型组合

| 组合 | 输入 | 输出 | 产品 |
|---|---|---|---|
| **A. 实时字幕** | 麦克风 | 设备屏幕文字 | 视频会议字幕、听写 |
| **B. 智能助手** | 麦克风 | 设备语音 + 字幕 | 类豆包、AI 助手 |
| **C. 博客朗读** | 文本 | 设备语音 + 字幕高亮 | AI 博客、有声书 |
| **D. 同声传译** | 麦克风 | 设备语音(双语) + 双语字幕 | 翻译耳机、会议传译 |
| **E. 文字聊天** | 文字 | 设备文字(LLM 流式) | 静音场景 |
| **F. 听书模式** | 文字 | 设备语音 | 通勤、健身 |

---

## 2. 输入模式详解

### 2.1 输入模式总览

| 模式 | 描述 | 典型设备 | 延迟指标 |
|---|---|---|---|
| `mic_continuous` | 持续录音 + VAD 触发 | 手机 / PC / 智能音箱 | 首字 ≤ 200ms |
| `mic_push_to_talk` | 按住说话 | 对讲机、车载 | 端点明确 |
| `mic_wake_word` | 唤醒词 + 命令 | 智能音箱、智能耳机 | 唤醒 ≤ 500ms |
| `text_input` | 纯文字键入 | 任何 | 即时 |
| `file_audio` | 上传音频文件 | 任何 | 离线 |
| `system_audio` | 截取系统声音 | Electron | 需特殊权限 |
| `mixed_input` | 文字 + 语音混输 | 手机 / PC | 流式融合 |
| `ble_mic` | 蓝牙耳机麦 | 蓝牙耳机 | 同 mic_continuous |

### 2.2 mic_continuous（持续录音）

**核心**：客户端 VAD 决定"什么时候算用户开始/结束说话"。

```ts
// sdk/modes/continuous.ts
class ContinuousInput {
  private capture: AudioCapture;
  private vad: VAD;
  private speaking = false;

  async start() {
    this.capture = new AudioCapture();
    this.capture.onFrame((pcm) => {
      this.vad.feed(pcm);
    });
    this.vad.on('speech_start', () => this.onSpeechStart());
    this.vad.on('speech_end', () => this.onSpeechEnd());
    await this.capture.start();
  }

  private onSpeechStart() {
    this.speaking = true;
    this.emit('user_speech_start');
    // 立即通知下游:触发打断 + 开始 ASR 流
    this.session.send({ type: 'BARGE_IN' });
  }

  private onSpeechEnd() {
    this.speaking = false;
    this.emit('user_speech_end');
    // 触发 ASR final → LLM
  }
}
```

**双层 VAD**：
- 客户端能量 VAD：< 50ms 决定打断
- 服务端精准 VAD：决定句子切分

### 2.3 mic_push_to_talk（按住说话）

**核心**：明确"开始/结束"边界,无 VAD 误判问题。

```ts
class PushToTalkInput {
  private capture: AudioCapture;
  private recording = false;

  bind(button: HTMLElement) {
    button.addEventListener('pointerdown', () => this.start());
    button.addEventListener('pointerup', () => this.stop());
    button.addEventListener('pointerleave', () => this.stop());  // 手指滑出也算停
  }

  private async start() {
    this.recording = true;
    this.emit('recording_start');
    await this.capture.start();
  }

  private async stop() {
    if (!this.recording) return;
    this.recording = false;
    this.emit('recording_end');
    await this.capture.stop();
    // 一次性发完整音频给 ASR
  }
}
```

**适合**：嘈杂环境(街头、地铁)、会议记录、对讲机。

### 2.4 mic_wake_word（唤醒词）

**核心**：端侧轻量唤醒词检测 + 触发后切到 `mic_continuous`。

```ts
class WakeWordInput {
  private detector: WakeWordDetector;  // Picovoice / Porcupine / Snowboy
  private continuous: ContinuousInput;

  async start() {
    // 端侧常驻监听（消耗 < 5% CPU）
    this.detector = await WakeWordDetector.create(['你好小助手']);
    this.detector.on('detect', () => this.onWake());

    // 平时只唤醒,真正命令用 continuous
  }

  private onWake() {
    this.emit('wake');
    this.continuous.start();  // 开始录音
    setTimeout(() => this.continuous.stop(), 10_000);  // 10s 超时
  }
}
```

**端侧唤醒词**（不耗网络、不耗电）：
- Picovoice Porcupine（商业）
- Snowboy（开源，已停维）
- MediaPipe（Google）
- 自训小模型（~50KB，端侧 ONNX）

### 2.5 text_input（纯文字输入）

**核心**：用户键入,完全绕过 ASR,直接走 LLM。

```ts
class TextInput {
  bind(textarea: HTMLTextAreaElement) {
    let buf = '';
    let timer: number;
    textarea.addEventListener('input', (e) => {
      buf = (e.target as HTMLTextAreaElement).value;
      clearTimeout(timer);
      timer = window.setTimeout(() => this.send(buf), 500);  // 500ms 防抖
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send(textarea.value);
      }
    });
  }

  private send(text: string) {
    if (!text.trim()) return;
    this.emit('user_text', { text });
    this.session.send({ type: 'ASR_FINAL', text, source: 'text_input' });
  }
}
```

### 2.6 file_audio（音频文件）

**核心**：上传文件,异步返回转写/翻译结果。

```ts
class FileAudioInput {
  async upload(file: File, options: { lang: string; mode: 'caption' | 'translate' }) {
    // 1. 客户端分片上传
    const uploaded = await this.tus.upload(file);

    // 2. 提交转写任务
    const { taskId } = await this.session.send({
      type: 'FILE_TRANSCRIBE',
      fileUrl: uploaded.url,
      lang: options.lang,
      mode: options.mode
    });

    // 3. 轮询或 WebSocket 订阅进度
    return this.pollTask(taskId);
  }
}
```

### 2.7 system_audio（系统声音捕获）

**仅 Electron 桌面端**：用 `desktopCapturer` 截取系统声音。

```ts
// electron/main.ts
const { desktopCapturer } = require('electron');

ipcMain.handle('capture-system-audio', async (e) => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    fetchWindowIcon: false
  });
  // 选择要捕获的窗口/屏幕
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sources[0].id
      }
    }
  });
  return stream;
});
```

**用途**：截屏讲解、会议旁听、视频翻译。

### 2.8 mixed_input（文字+语音混输）

**场景**：用户边说边打字(罕见但存在,例如边讲 PPT 边贴文字)。

```ts
class MixedInput {
  private voiceBuf = '';
  private textBuf = '';
  private timer: number;

  onVoicePartial(text: string) {
    this.voiceBuf = text;
    this.scheduleEmit();
  }

  onTextInput(text: string) {
    this.textBuf = text;
    this.scheduleEmit();
  }

  private scheduleEmit() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const merged = `${this.voiceBuf}\n${this.textBuf}`.trim();
      if (merged) this.emit('user_input', { text: merged });
    }, 300);
  }
}
```

---

## 3. 输出模式详解

### 3.1 输出模式总览

| 模式 | 输出位置 | 典型场景 | 延迟目标 |
|---|---|---|---|
| `voice_only` | 扬声器/耳机 | 智能音箱 | TTS ≤ 180ms |
| `text_only` | 屏幕字幕 | 实时字幕 | 显示 ≤ 50ms |
| `voice_with_caption` | 扬声器+屏幕（默认） | 类豆包 | TTS + 字幕 |
| `bilingual_caption` | 屏幕双语字幕 | 同声传译 | 翻译 ≤ 350ms |
| `bilingual_voice` | 扬声器双语 | 翻译耳机 | TTS × 2 |
| `text_streaming` | 屏幕流式 | 文字聊天 | TTFT ≤ 100ms |
| `off_silent` | 仅字幕不读 | 静音场景 | 字幕 ≤ 50ms |
| `multi_device` | 多设备同步 | 智能家居 | 同步 ≤ 100ms |
| `haptic_event` | 震动 | 重要事件 | 50ms |
| `notif_event` | 系统通知 | 后台事件 | 异步 |

### 3.2 设备文字输出（caption / subtitle）

> **核心能力**：把 ASR / 翻译 / LLM 的文字流**实时滚动渲染**到屏幕。

#### 3.2.1 字幕组件

```tsx
// react/components/SubtitlePanel.tsx
export function SubtitlePanel({ session, role, dim = false }: SubtitleProps) {
  const [items, setItems] = useState<SubtitleItem[]>([]);
  const [partial, setPartial] = useState('');

  useEffect(() => {
    if (role === 'user') {
      session.on('asr.partial', (e) => setPartial(e.text));
      session.on('asr.final', (e) => {
        setItems(arr => [...arr, { text: e.text, ts: Date.now(), role: 'user' }]);
        setPartial('');
      });
    } else if (role === 'assistant') {
      session.on('llm.token', (e) => {
        setItems(arr => {
          const last = arr[arr.length - 1];
          if (last?.role === 'assistant' && !last.committed) {
            return [...arr.slice(0, -1), { ...last, text: last.text + e.text }];
          }
          return [...arr, { text: e.text, ts: Date.now(), role: 'assistant', committed: false }];
        });
      });
      session.on('tts.start', () => {
        // TTS 开始播放时,字幕 commit
        setItems(arr => arr.map((it, i) => i === arr.length - 1 ? { ...it, committed: true } : it));
      });
    }
  }, [role]);

  return (
    <div className="subtitle-panel">
      {items.map((it, i) => (
        <Bubble key={i} {...it} dim={dim} />
      ))}
      {partial && <Bubble role={role} text={partial} dim placeholder />}
    </div>
  );
}
```

#### 3.2.2 双语字幕

```tsx
export function BilingualCaption({ session }: { session: VoiceSession }) {
  const [items, setItems] = useState<BilingualItem[]>([]);

  useEffect(() => {
    session.on('asr.final', (e) => {
      const id = crypto.randomUUID();
      setItems(arr => [...arr, { id, src: e.text, tgt: '', srcTs: Date.now() }]);

      // 触发翻译
      session.send({ type: 'TRANSLATE', text: e.text, ref: id });
    });

    session.on('translation', (e) => {
      setItems(arr => arr.map(it =>
        it.id === e.ref ? { ...it, tgt: e.text } : it
      ));
    });
  }, []);

  return (
    <div className="bilingual-caption">
      {items.map((it, i) => (
        <div key={it.id} className="caption-pair">
          <div className="src">{it.src}</div>
          <div className="tgt">{it.tgt || <Spinner />}</div>
        </div>
      ))}
    </div>
  );
}
```

#### 3.2.3 字幕渲染优化

| 优化 | 做法 | 收益 |
|---|---|---|
| 虚拟列表 | 只渲染可见行 | 万行不卡 |
| 字号自适应 | 设备 DPI / 视距 | 阅读体验 |
| 单词级高亮 | 配合 TTS 时间戳 | 跟随阅读 |
| 滚动自动聚焦 | 新行出现时滚动 | 不用手动 |
| 字号/速度调节 | 用户设置 | 可访问性 |

#### 3.2.4 字幕样式

```css
.subtitle-panel {
  font-family: -apple-system, "PingFang SC", sans-serif;
  line-height: 1.6;
}
.subtitle-panel .bubble {
  padding: 8px 16px;
  border-radius: 12px;
  margin: 4px 0;
  max-width: 80%;
}
.subtitle-panel .bubble.user {
  background: rgba(0, 122, 255, 0.1);
  align-self: flex-end;
}
.subtitle-panel .bubble.assistant {
  background: rgba(52, 199, 89, 0.1);
  align-self: flex-start;
}
.subtitle-panel .bubble.partial {
  opacity: 0.5;  /* 半透明,表示未稳定 */
}
.subtitle-panel .bubble.committed {
  opacity: 1;     /* 已稳定 */
}
```

#### 3.2.5 字幕高级能力

| 能力 | 描述 |
|---|---|
| **导出** | 一键导出为 SRT / VTT / 文本 |
| **搜索** | 历史字幕全文搜索 |
| **翻译** | 任意一段实时翻译 |
| **分享** | 生成链接 / 图片分享 |
| **AI 总结** | 一键总结为笔记 |

### 3.3 设备语音输出（speaker / earphone）

> **核心能力**：流式 TTS + 调度播放 + 打断响应。

#### 3.3.1 流式播放器（Web）

```ts
// sdk/playback/stream-player.ts
export class StreamPlayer {
  private ctx: AudioContext;
  private nextPlayTime = 0;
  private scheduled: AudioBufferSourceNode[] = [];
  private interrupted = false;

  enqueue(pcm: Int16Array, sampleRate = 24000) {
    if (this.interrupted) return;
    const buffer = this.pcmToBuffer(pcm, sampleRate);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now + 0.05;

    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
    this.scheduled.push(source);
  }

  interrupt() {
    this.interrupted = true;
    this.scheduled.forEach(s => { try { s.stop(); } catch {} });
    this.scheduled = [];
    this.nextPlayTime = 0;
    this.ctx.resume();  // 唤醒
    setTimeout(() => { this.interrupted = false; }, 50);
  }

  private pcmToBuffer(pcm: Int16Array, sampleRate: number): AudioBuffer {
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const buffer = this.ctx.createBuffer(1, f32.length, sampleRate);
    buffer.getChannelData(0).set(f32);
    return buffer;
  }
}
```

#### 3.3.2 流式播放器（小程序）

```ts
// wechat-mp/playback/stream-player.ts
export class MpStreamPlayer {
  private audio = wx.createInnerAudioContext({ useWebAudioImplement: true });
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private interrupted = false;

  enqueue(pcm: ArrayBuffer, sampleRate = 24000) {
    if (this.interrupted) return;
    this.queue.push(pcm);
    this.drain();
  }

  private async drain() {
    if (this.playing || this.queue.length === 0) return;
    this.playing = true;

    // 合并队列中所有 PCM 为一个 WAV（更顺滑）
    const merged = this.mergeQueue();
    const wav = this.pcmToWav(merged, 24000);
    const path = `${wx.env.USER_DATA_PATH}/t_${Date.now()}.wav`;

    wx.getFileSystemManager().writeFileSync(path, wav, 'binary');
    this.audio.src = path;
    this.audio.play();
    this.audio.onEnded(() => {
      this.playing = false;
      this.drain();
    });
  }

  interrupt() {
    this.interrupted = true;
    this.audio.stop();
    this.queue = [];
    this.playing = false;
    setTimeout(() => { this.interrupted = false; }, 50);
  }
}
```

#### 3.3.3 设备路由（扬声器 / 耳机 / 蓝牙）

```ts
// 切换输出设备
async function setSinkDevice(deviceId: string) {
  // Web
  if (audio.setSinkId) {
    await audio.setSinkId(deviceId);
  }
  // 小程序（蓝牙）
  // wx.openBluetoothAdapter() + A2DP
}
```

```tsx
// 设备选择 UI
function DevicePicker() {
  return (
    <select onChange={e => setSinkDevice(e.target.value)}>
      <option value="default">📱 扬声器</option>
      <option value="bluetooth">🎧 蓝牙耳机</option>
      <option value="airpods">🎧 AirPods</option>
      <option value="speaker">🔊 桌面音箱</option>
    </select>
  );
}
```

### 3.4 双语语音（先源后译 / 同时播放）

```ts
class BilingualVoicePlayer {
  private sourcePlayer = new StreamPlayer();
  private targetPlayer = new StreamPlayer();
  private targetDelayMs = 800;  // 译文延后 800ms（让用户先听到源语）

  enqueueSource(pcm: ArrayBuffer) {
    this.sourcePlayer.enqueue(pcm);
  }

  enqueueTarget(pcm: ArrayBuffer) {
    setTimeout(() => this.targetPlayer.enqueue(pcm), this.targetDelayMs);
  }

  interrupt() {
    this.sourcePlayer.interrupt();
    this.targetPlayer.interrupt();
  }
}
```

**用户体验**：
- 源语先播 0.8s
- 译文跟进
- 用户听到"今天天气不错"→ 0.8s 后听到"Nice weather today"
- 自然语流,不打架

### 3.5 文字流式输出（LLM Token 级）

```tsx
// 屏幕流式渲染 LLM 文字,不等 TTS
export function TextStream({ session }: { session: VoiceSession }) {
  const [text, setText] = useState('');
  const [tokens, setTokens] = useState<{ text: string; ts: number }[]>([]);

  useEffect(() => {
    session.on('llm.token', (e) => {
      setText(t => t + e.text);
      setTokens(arr => [...arr, { text: e.text, ts: Date.now() }]);
    });
    session.on('llm.end', () => {
      // commit
    });
  }, []);

  return (
    <div className="text-stream">
      {text}
      <Cursor />  {/* 闪烁光标 */}
    </div>
  );
}
```

**应用**：用户静音场景(办公室、图书馆)。

### 3.6 字幕高亮（与 TTS 同步）

> 博客 / 有声书 / 听课时,屏幕文字跟随 TTS 朗读高亮。

```ts
// 接收 TTS 时间戳,驱动高亮
session.on('tts.chunk', (e) => {
  if (e.textRange) {
    // textRange: [startIdx, endIdx] 在原文中的位置
    highlightTextRange(e.textRange[0], e.textRange[1]);
  }
});
```

```tsx
// 高亮组件
function HighlightedText({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}
```

### 3.7 多设备同步输出

```ts
// 主控设备广播时间戳
class MultiDeviceSync {
  private devices: Device[] = [];

  async broadcastAudio(pcm: ArrayBuffer, ts: number) {
    // 1. 通知所有从设备"在 ts 时间播放这段音频"
    this.devices.forEach(d => {
      d.send({
        type: 'PLAY_AT',
        audio: pcm,
        at: ts
      });
    });
  }

  async registerDevice(d: Device) {
    // NTP 时间对齐（误差 < 10ms）
    const offset = await this.ntpSync(d);
    d.timeOffset = offset;
    this.devices.push(d);
  }
}
```

**应用场景**：
- 智能家居：手机发起对话,小爱/小度同步播
- 会议：笔记本 + 会议室大屏同步显示字幕
- 车载：手机发起,车机同步

### 3.8 震动反馈（Haptic）

```ts
// 重要事件震动
function hapticOnEvent(session: VoiceSession) {
  const patterns = {
    'wake': [100],                    // 短震
    'user_speech_start': [50],
    'user_speech_end': [50],
    'ai_speech_start': [30, 30, 30],  // 三短震"滴答滴"
    'ai_speech_end': [200],           // 长震"嘟"
    'error': [100, 50, 100, 50, 100]  // SOS
  };

  session.on('*', (event) => {
    const pattern = patterns[event.type];
    if (pattern) navigator.vibrate(pattern);
  });
}
```

**应用**：盲人辅助、智能手表、健身场景。

### 3.9 系统通知

```ts
async function notifyOnEvent(event: VoiceEvent) {
  if (event.type === 'ai_speech_end' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('AI 回复完毕', {
        body: event.lastSentence,
        icon: '/logo.png',
        tag: 'voice-session',
        requireInteraction: false
      });
    }
  }
}
```

**应用**：后台运行、视障用户。

---

## 4. SDK 统一 API

### 4.1 主 API

```ts
// 任何端通用
import { createVoiceSession } from '@voice-sdk/core';

const session = createVoiceSession({
  endpoint: 'wss://voice.example.com/v1',
  auth: async () => ({ appId, token, userId }),

  // 1. 输入模式
  input: 'mic_continuous',  // 'mic_continuous' | 'mic_push_to_talk' | 'mic_wake_word' | 'text_input' | 'file_audio' | 'mixed_input'
  inputConfig: {
    hotwords: ['豆包', '兜底'],
    wakeWord: '你好小助手',  // 仅 wake_word 模式
  },

  // 2. 输出模式（可多选,自动按设备能力）
  output: ['voice', 'caption'],  // 'voice' | 'caption' | 'bilingual_caption' | 'bilingual_voice' | 'text_streaming' | 'multi_device' | 'haptic'
  outputConfig: {
    voice: {
      device: 'auto',  // 'auto' | 'speaker' | 'bluetooth' | 'airpods'
      volume: 1.0,
      speed: 1.0
    },
    caption: {
      position: 'bottom',  // 'top' | 'bottom' | 'inline'
      bilingual: 'both',  // 'source' | 'target' | 'both' | null
      highlight: true,
      autoScroll: true
    }
  },

  // 3. 业务模式
  mode: 'voice_agent',  // 'voice_caption' | 'voice_translate' | 'voice_agent' | 'tts_blog' | 's2s' | 'custom'

  // 4. 性能偏好
  performance: 'extreme',  // 'normal' | 'fast' | 'extreme'  // 影响是否启用 speculative / 边缘 / 量化
});

// 事件（统一）
session.on('user_speech_start', () => {});
session.on('user_speech_end',   () => {});
session.on('asr.partial',       (e) => {});
session.on('asr.final',         (e) => {});
session.on('translation',       (e) => {});
session.on('llm.token',         (e) => {});
session.on('ai_speech_start',   () => {});
session.on('ai_speech_end',     () => {});
session.on('barge_in',          () => {});
session.on('error',             (e) => {});

// 控制
await session.start();
session.setInput('text_input');  // 运行时切换输入
session.setOutput(['caption']);  // 运行时切换输出(切到静音)
session.bargeIn();
await session.mute(true);
await session.stop();

// 数据
const stats = session.getStats();
```

### 4.2 模式选择指南

| 业务 | input | output | mode | 关键配置 |
|---|---|---|---|---|
| 视频会议字幕 | `mic_continuous` | `['caption']` | `voice_caption` | 多人分离 |
| 听写 | `mic_push_to_talk` | `['caption']` | `voice_caption` | 高准确率 |
| AI 助手 | `mic_continuous` | `['voice', 'caption']` | `voice_agent` | wake_word |
| 类豆包 | `mic_continuous` | `['voice', 'caption']` | `s2s` | extreme |
| 听书 | `text_input` | `['voice']` | `tts_blog` | highlight |
| 同声传译 | `mic_continuous` | `['bilingual_voice', 'bilingual_caption']` | `voice_translate` | 流式翻译 |
| 视障辅助 | `mic_continuous` | `['voice', 'haptic']` | `s2s` | 高可读 |
| 听障辅助 | `mic_continuous` | `['caption']` | `voice_caption` | 大字号 |
| 智能音箱 | `mic_wake_word` | `['voice']` | `s2s` | 远场麦 |

---

## 5. 终端差异化

### 5.1 H5（iOS Safari / Android Chrome / 微信内）

| 能力 | 状态 |
|---|---|
| Mic | ✅ `getUserMedia` |
| Speaker | ✅ `AudioContext` |
| 蓝牙 | ⚠️ 受限（iOS 需 user gesture） |
| 后台 | ❌ 浏览器后台会停 |
| AudioWorklet | ✅ 现代浏览器 |
| WebRTC | ✅ 主流支持 |
| 微信内 X5 | ⚠️ 部分受限,降级 WS |

**关键代码**（同主文档）：
- AudioWorklet 捕获
- Web Audio 播放
- WebRTC / WebSocket 传输

### 5.2 PC（浏览器 + Electron）

| 能力 | 浏览器 | Electron |
|---|---|---|
| Mic | ✅ | ✅ |
| Speaker | ✅ | ✅ |
| 系统音频捕获 | ❌ | ✅ desktopCapturer |
| 全局快捷键 | ❌ | ✅ globalShortcut |
| 系统通知 | ✅ | ✅ Native |
| 多声道 | ⚠️ | ✅ |
| 后台运行 | ❌ | ✅ Tray + 进程 |

**Electron 特殊能力**：

```ts
// 主进程：全局快捷键
import { globalShortcut } from 'electron';
globalShortcut.register('CommandOrControl+Shift+Space', () => {
  mainWindow.webContents.send('voice:toggle');
});

// 托盘菜单
const tray = new Tray(icon);
tray.setContextMenu(Menu.buildFromTemplate([
  { label: '开始录音', click: () => startRecording() },
  { label: '设置', click: () => openSettings() },
  { label: '退出', click: () => app.quit() }
]));
```

### 5.3 微信小程序

| 能力 | 状态 |
|---|---|
| Mic | ✅ `wx.getRecorderManager` |
| Speaker | ✅ `wx.createInnerAudioContext` |
| 后台 | ⚠️ 受限（需类目） |
| WebRTC | ❌ 无 |
| WebSocket | ✅ |
| 蓝牙 | ❌ 需原生插件 |

**关键代码**（同主文档）：
- `RecorderManager.onFrameRecorded` 分片
- 主线程 VAD
- `InnerAudioContext` 流播放

**后台运行限制**：
```json
// app.json
{
  "requiredBackgroundModes": ["audio"],  // 需要"教育/医疗"等类目
  "permission": { "scope.record": { "desc": "用于实时语音" } }
}
```

### 5.4 智能音箱 / 车载 / IoT

| 设备 | 适配 |
|---|---|
| **智能音箱** | 远场麦阵列(多麦) + 唤醒词 + 无屏幕 |
| **车载** | 远场麦 + 车载音响 + 中控屏 + CAN 总线集成 |
| **智能耳机** | 真无线 TWS + 蓝牙 + 端侧唤醒 |
| **智能眼镜** | 骨传导 + Mic + 极小屏幕 |
| **智能手表** | 短文本输入 + Mic + 震动 + 屏 |

```ts
// 智能音箱适配
class SmartSpeaker {
  private micArray: MicArray;  // 6 麦阵列
  private beamformer: Beamformer;  // 波束成形
  private aec: AEC;  // 远场回声消除

  async start() {
    // 远场优化：降噪、波束、回声消除
    this.beamformer = new Beamformer(this.micArray);
    this.aec = new AEC({ reference: this.speaker.getOutputStream() });
  }
}
```

### 5.5 多设备 Cast

| 协议 | 平台 |
|---|---|
| **AirPlay** | iOS / macOS |
| **Chromecast** | Android / Chrome |
| **DLNA** | 智能电视 |
| **Miracast** | Windows / Android |
| **蓝牙 A2DP** | 蓝牙耳机 / 音箱 |
| **私有 LAN 协议** | 自研 IoT 设备 |

---

## 6. 可访问性（A11y）

### 6.1 视障辅助

**输入**：语音（连续）
**输出**：语音 + 强震动

```ts
session.setOutput({
  voice: { device: 'auto', speed: 1.0 },
  haptic: { events: ['wake', 'user_speech_start', 'user_speech_end', 'ai_speech_start', 'ai_speech_end'] }
});
```

UI：
- 高对比度（白底黑字 / 黑底白字）
- 大字号（可调）
- 屏幕阅读器兼容（aria-live）
- 全键盘操作

### 6.2 听障辅助

**输入**：语音
**输出**：纯文字（无语音）

```ts
session.setOutput({ voice: false, caption: true });
```

UI：
- 大字号字幕（可调）
- 颜色标识（不同人不同颜色）
- 历史回看
- 导出为文本

### 6.3 老年友好

- 慢速 TTS（0.8x）
- 大字号
- 方言识别（上海话/粤语/四川话）
- 简单 UI（少按钮）

### 6.4 儿童模式

- 内容过滤
- 趣味音色
- 限时长

---

## 7. UI 模式（按"输入×输出"组合）

### 7.1 模式矩阵 → UI 模板

| 组合 | UI 模板 | 关键元素 |
|---|---|---|
| mic + voice | 语音球 | Mic 图标 + 状态环 |
| mic + caption | 字幕条 | 滚动文字 + 状态条 |
| mic + voice+caption | 类豆包 | 语音球 + 字幕面板 |
| mic + bilingual_voice | 翻译耳机 | 源/译 切换 |
| mic + bilingual_caption | 同传字幕 | 双语对照 |
| text + voice | 听书 | 文本框 + 播放控制 |
| text + caption | 文字聊天 | 流式文字 + 光标 |
| text + voice+caption | AI 助手 | 输入框 + 球 + 字幕 |
| file + caption | 文档转写 | 进度条 + 结果 |
| wake + voice | 智能音箱 | 灯环 + 状态色 |

### 7.2 完整 UI 示例：AI 助手（mic + voice + caption + text）

```tsx
function AIAssistantUI({ session }: { session: VoiceSession }) {
  return (
    <div className="ai-assistant">
      {/* 顶部状态栏 */}
      <StatusBar session={session} />

      {/* 主对话区 */}
      <ChatPanel session={session} />

      {/* 底部输入区 */}
      <InputBar>
        <WakeWordIndicator session={session} />     {/* "👂 正在听" */}
        <TextInput placeholder="或者输入文字..." />  {/* 文字输入 */}
        <PushToTalkButton />                       {/* 按住说话 */}
        <VoiceOrb session={session} />             {/* 语音球 */}
      </InputBar>

      {/* 浮动字幕 */}
      <FloatingCaption session={session} />

      {/* 设备控制 */}
      <DevicePicker />
      <OutputSwitcher session={session} />         {/* 切到"只字幕不读" */}
    </div>
  );
}
```

### 7.3 实时字幕 UI

```tsx
function LiveCaptionUI({ session }: { session: VoiceSession }) {
  return (
    <div className="live-caption">
      <Header>
        <StatusLight state={session.state} />
        <span>{session.userName} 正在说话</span>
        <LanguageSwitcher />
      </Header>

      <SubtitlePanel session={session} />

      <BilingualToggle />  {/* 中/英 / 中+英 */}
      <ScrollToLatest />
    </div>
  );
}
```

### 7.4 博客朗读 UI

```tsx
function BlogTTSUI({ session }: { session: VoiceSession }) {
  return (
    <div className="blog-tts">
      <ProgressBar value={progress} />

      <ArticleContent>
        {paragraphs.map(p => (
          <Paragraph
            key={p.id}
            text={p.text}
            highlighted={p.id === currentParagraphId}
            onClick={() => session.seekTo(p.id)}
          />
        ))}
      </ArticleContent>

      <PlayerControls>
        <PlayButton session={session} />
        <SpeedControl />
        <VoicePicker voices={['温暖女声', '磁性男声', '童声']} />
        <SleepTimer />  {/* 30 分钟后自动停 */}
      </PlayerControls>
    </div>
  );
}
```

---

## 8. 性能与可访问性的平衡

### 8.1 大字号 vs 渲染性能

- 虚拟列表
- 字号变化时不重排（用 transform: scale）
- 减少字体回退

### 8.2 高频字幕 vs 流畅

- 字符级增量更新（不是整体重渲染）
- requestAnimationFrame 批处理
- Web Worker 解析

### 8.3 弱视模式（高对比度）

- 强制 dark/light mode
- 加粗字体
- 减少动画

---

## 9. 测试矩阵

### 9.1 功能测试

| 测试项 | 输入 | 输出 | 期望 |
|---|---|---|---|
| 持续录音 | 麦克风 | 字幕 | 实时显示 |
| 文字输入 | 键盘 | 语音 | TTS 播放 |
| 双语字幕 | 麦克风 | 双语字幕 | 中+英 |
| 打断 | 麦克风 | - | 100ms 内停 |
| 静音模式 | 麦克风 | 字幕 | 无声 |
| 切换输出 | - | 切到字幕 | 实时切 |
| 唤醒词 | "你好小助手" | 唤醒 | < 500ms |

### 9.2 性能测试

| 测试项 | 目标 | 工具 |
|---|---|---|
| 首字延迟 | ≤ 200ms | Lighthouse |
| 字幕显示 | ≤ 50ms | 自研打点 |
| 语音首音 | ≤ 180ms | 自研打点 |
| 打断响应 | ≤ 100ms | 自研打点 |
| 60fps 滚动 | 无卡顿 | DevTools |

### 9.3 兼容性测试

| 设备 | OS | 浏览器 | 重点 |
|---|---|---|---|
| iPhone 15 | iOS 17 | Safari | AirPlay / 蓝牙 |
| 小米 14 | Android 14 | Chrome | 蓝牙 |
| 华为 Mate 60 | HarmonyOS | 内置 | 系统通知 |
| iPad | iPadOS 17 | Safari | 大屏布局 |
| MacBook | macOS 14 | Chrome | 系统音频 |
| Surface | Windows 11 | Edge | WebRTC |
| 小米电视 | Android TV | WebView | 大屏 |
| Apple Watch | watchOS 10 | - | 短文本 |

---

## 10. 进阶能力

### 10.1 离线模式

- **端侧 ASR**（Whisper-tiny / Paraformer-small）：1MB 模型,端侧推理
- **端侧 LLM**（Gemma-2B / Qwen-1.8B / Phi-3-mini）：2GB 模型,WebGPU / 端侧 Native
- **端侧 TTS**（VITS / Tacotron）：50MB,质量一般但能响

```ts
const session = createVoiceSession({
  offline: {
    asr: 'whisper-tiny',  // 端侧
    llm: 'gemma-2b',      // 端侧
    tts: 'edge-tts'        // 浏览器原生
  }
});
```

### 10.2 多语种切换

```ts
session.setLanguage('zh-CN');   // 普通话
session.setLanguage('en-US');
session.setLanguage('ja-JP');
session.setLanguage('粤语');

// 同会话切换
session.on('language_changed', (e) => {
  console.log('切换到', e.lang);
});
```

### 10.3 个性化

```ts
session.config({
  user: {
    voiceprint: true,          // 声纹识别
    personal_hotwords: ['产品名', '同事名'],
    preferred_voice: '磁性男声',
    speech_speed: 1.2,
    caption_font_size: 'large'
  }
});
```

### 10.4 情感识别

- 服务端情感 ASR（开心/悲伤/愤怒/中性）
- LLM 情感理解
- TTS 情感合成（开心/平静/严肃）

```ts
session.on('emotion', (e) => {
  console.log('用户情绪:', e.emotion, '强度:', e.intensity);
});
```

### 10.5 内容审核

```ts
// 服务端在流式返回时实时过滤
session.on('llm.token', (e) => {
  if (e.sensitive) {
    // 自动替换 / 终止
  }
});
```

---

## 11. 数据流与状态机

### 11.1 输入状态机

```
IDLE → LISTENING (mic 持续录音)
   ↓ 用户说话
SPEAKING (VAD 检测)
   ↓ VAD 静音 / 端点
ENDPOINT (ASR final)
   ↓ 推下游
IDLE (等待下次说话)
```

### 11.2 输出状态机

```
IDLE → SPEAKING (TTS 开始)
   ↓ 流式合成
STREAMING (持续输出)
   ↓ TTS end / 打断
DONE / INTERRUPTED
   ↓
IDLE
```

### 11.3 输入输出协同

```
输入状态: SPEAKING
  → 输出状态: INTERRUPT (立即停)
  → 输入状态: CONTINUE (继续收)

输入状态: ENDPOINT
  → 输出状态: SPEAKING (开始 AI 回复)
  → 输入状态: IDLE (停止录音)
```

---

## 12. 关键指标

| 指标 | 目标 | 测量 |
|---|---|---|
| ASR 首字 | ≤ 200ms | Trace |
| 字幕渲染 | ≤ 50ms | PerformanceObserver |
| TTS 首音 | ≤ 180ms | Trace |
| 语音打断 | ≤ 100ms | 客户端打点 |
| 双语字幕 | ≤ 350ms | Trace |
| 唤醒响应 | ≤ 500ms | 端侧打点 |

---

## 13. 总结

**"用户语音输入 + 设备文字/语音输出"** 是 5 种业务中**最常见、最通用**的形态。我们的方案:

1. **输入/输出解耦**:7 种输入 × 10 种输出 = 70 种产品形态
2. **设备能力自动检测**:扬声器/屏幕/震动/蓝牙/多设备
3. **极低延迟**:首字 200ms、首音 180ms、打断 100ms
4. **三端统一**:H5/PC/小程序/智能硬件同一 SDK
5. **可访问性**:视障/听障/老年/儿童友好
6. **可降级**:无麦/无声/弱网均可用
7. **可扩展**:唤醒词/声纹/情感/多语种

> **设计哲学**：**让产品力回归到"输入"和"输出"本身**,而不是被"Pipeline"绑死。技术服务于产品,而不是反过来。

---

## 附录：参考实现

- [MediaRecorder 实时流（Web 标准）](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Web Audio API（Web 标准）](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Web Speech API（浏览器原生 ASR/TTS 兜底）](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Porcupine 唤醒词](https://picovoice.ai/docs/porcupine/)
- [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

---

> 配套子文档：
> - [`voice-realtime-architecture.md`](./voice-realtime-architecture.md) — 主方案
> - [`voice-extreme-performance.md`](./voice-extreme-performance.md) — 极致性能专项
> - [`voice-realtime-protocol.md`](./voice-realtime-protocol.md) — 协议与状态机
> - [`voice-sdk-client.md`](./voice-sdk-client.md) — SDK 详细设计
> - [`voice-backend-infra.md`](./voice-backend-infra.md) — 服务端与基础设施
> - [`voice-observability-security.md`](./voice-observability-security.md) — 可观测/容灾/安全
