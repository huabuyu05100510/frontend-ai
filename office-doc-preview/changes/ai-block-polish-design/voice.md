# VoicePage 五子模式行业对标 + 设计稿

> **模型声明**:claude-sonnet-4-6
> **生成日期**:2026-07-01
> **方法**:WebSearch / WebFetch 工具在当前网络环境持续返回 API 错误,所有"业界案例"基于模型 2024-2026 训练知识 + 仓库 memory 沉淀;具体数字 / 截图不可实时核实
> **本报告纯只读**

---

## 子模式 1 ── 实时语音转写 (Realtime ASR / Speech-to-Text)

### 1. 行业最佳实践 (Industry best practices)

| 产品 | 一句话亮点 |
| --- | --- |
| **Otter.ai** | "Live Notes" 把 Zoom/Teams/Meet 音频直接接入浏览器扩展 + AI Chat 问答转写内容（"帮我总结 Q3 预算讨论"）；发言人声纹聚类 + 头像自动匹配。 |
| **飞书妙记** | 会议结束秒出"智能章节"按话题切片 + 一键生成待办；中英粤实时互译 + 双列对照。 |
| **讯飞听见** | 中英实时转写延迟 < 200ms；"AI 写稿"把会议录音转成新闻稿；支持 23 种方言。 |
| **通义听悟** | 阿里达摩院底座，"角色分离"精度业界领先；音视频分离导入 + 实时标注关键决策。 |
| **Microsoft Teams Premium** | "Intelligent Recap" 把 1h 会议切成 5 段 AI 摘要 + 个人专属"To-do"清单。 |

### 2. 亮点挖掘 (Highlight mining, ≥8)

1. **声波实时可视化** — 32 根竖向 `WaveformBars` 按 RMS 振幅跳动，激活段用 `--color-primary`、静音段灰阶 `--color-text-tertiary`，`transform: scaleY()` 60fps。
2. **说话人头像自动聚类** — Web Audio API 提取声纹向量 → 后端 `dbscan` 聚类，前端彩色头像卡 (Speaker A/B/C)，点击可重命名。
3. **置信度热力文本** — 转写文本背景色按 token 置信度映射 `green-2 / amber-2 / red-2`，hover 显示具体概率，方便人工校对。
4. **关键决策/待办高亮** — 通义听悟式 "AI 自动标记"，识别到"决定""下周完成""TODO"等关键词自动加 `.xf-token.action` 紫色边框 + 右侧"AI 提取"面板展开。
5. **⌘K 跳转任意段落** — `palette` 注册"跳转到第 N 分钟"动作，`goto(timestamp)` 直接 `seek + highlight`。
6. **章节切片时间轴** — 顶部横向 `Timeline`，按话题切分彩色段落，hover 显示标题，click 跳转。
7. **实时多语种互译** — 中 → 英 / 英 → 中 双列对照显示，译文字号小 30%、颜色 `--color-text-secondary`。
8. **麦克风权限引导** — 未授权时显示空状态插画 + "如何允许麦克风？"按钮 + `navigator.mediaDevices.getUserMedia({ audio: true })` retry。
9. **离线降级** — `networkidle` 检测失败时自动切到本地 Whisper-tiny WASM，状态栏显示 "🔌 离线模式 · 精度降低"。
10. **导出富文本** — 一键复制 Markdown 表格（含发言人、时间戳、原文），或导出 `.srt` / `.vtt` 字幕文件。

### 3. ASCII 线框图 (Wireframe)

```
┌─ VoicePage ─ Realtime ASR ────────────────────────────────────────────────┐
│ ┌─ Top Bar ─────────────────────────────────────────────────────────┐    │
│ │ 🎙 实时转写   ▾ zh-CN ▾ 标准普通话   ◉ 录制中 00:03:42   ⌘K 搜索  │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Speakers ──┐ ┌─ Timeline ────────────────────────────────────────┐    │
│ │ 👤 张经理 ● │ │ 0:00├─议题1─┤├─议题2─┤├议题3─┤├─决议─┤ 03:42      │    │
│ │ 👤 李总   ● │ └──────────────────────────────────────────────────┘    │
│ │ 👤 + 新建 │                                                           │
│ └────────────┘                                                           │
│ ┌─ Waveform ────────────────────────────────────────────────────────┐    │
│ │ ▁▂▆█▇▅▃▂▁▂▄▆█▇▅▃▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂ │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Transcript ─────────────────────┐ ┌─ AI Insights ──────────────────┐   │
│ │ 00:12 [张经理] 我们 [决定: ●]  │ │ 🎯 决策点                       │   │
│ │        下周一上线新版本。        │ │   • 下周一上线新版本 (00:12)    │   │
│ │ 00:18 [李总]   同意, [TODO: ●] │ │   • 预算追加 20 万 (02:14)     │   │
│ │        记得同步给客户。          │ │ ✅ 待办                          │   │
│ │ 00:25 [张经理] OK, 我来 follow.│ │   • @李总 同步客户 (00:18)      │   │
│ │        ...                       │ │   • @张经理 准备上线清单 (00:12)│   │
│ │  [置信度: 🟢🟢🟡🟢🟢🟢🟢🟢🟢🟢] │ │ 📝 AI 摘要 (1 段话)              │   │
│ └──────────────────────────────────┘ └─────────────────────────────────┘   │
│ ┌─ Footer ───────────────────────────────────────────────────────────┐   │
│ │ ⏸ 暂停  ⏹ 停止  📋 复制MD  ⬇ SRT  📤 飞书妙记  ⚙ 设置            │   │
│ └────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4. 关键交互流 (Key interaction flow)

```
[进入页面]
    │
    ▼
[检查麦克风权限]──否──▶ [引导弹窗: 如何允许？]──▶ [重试]
    │是
    ▼
[点击"开始录制"]──▶ [WebAudio getUserMedia + AudioContext(16kHz mono)]
    │                                    │
    │                                    ▼
    │                          [MediaRecorder.start(1000ms slice)]
    │                                    │
    │                                    ▼ (每 1s)
    │                          [POST /api/speech/asr-segments]
    │                          header: X-ASR-Engine=mock|Xunfei|iFlytek
    │                                    │
    │                                    ▼
    │                          [追加到 transcript + 更新 speakers + 触发 AI 提取]
    ▼
[⌘K 打开 palette]──▶ [输入 "跳转到 1:30"]──▶ [seek + highlight 当前段]
    ▼
[点击"⏹ 停止"]──▶ [调用 /api/speech/asr-finalize]──▶ [保存到 workspace]
    │                                            │
    │                                            ▼
    │                                  [Toast: 已保存到 /files/<id>]
    ▼
[导出: 复制 MD / SRT / VTT]
```

### 5. 动效规范 (Animation specs)

| 元素 | 属性 | 时长 | Easing |
| --- | --- | --- | --- |
| Waveform 振幅 | `transform: scaleY(var(--amp))` | 60ms per frame | linear |
| Speaker 加入 | `opacity 0→1` + `translateX(-8px→0)` | 240ms | `cubic-bezier(0.4,0,0.2,1)` |
| Transcript 新行插入 | `max-height 0→auto` + `opacity 0→1` | 280ms | `cubic-bezier(0,0,0.2,1)` |
| AI 提取卡片弹出 | `scale(0.92→1)` + `opacity` | 200ms | `cubic-bezier(0.4,0,0.2,1)` |
| Confidence 热力背景 | `background-color` | 150ms | ease-out |
| Recording 红点呼吸 | `transform: scale(1→1.15)` + opacity | 1200ms infinite | ease-in-out |
| Timeline segment hover | `background-color` | 100ms | ease-out |
| Reduced-motion 模式 | 全部降级为瞬时切换 (`duration: 0`) | — | step |

### 6. 响应式断点 (Responsive breakpoints)

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| Mobile (sm) | < 640px | 单列 transcript + 底部 sheet 显示 AI Insights（fab 按钮切换） |
| Tablet (md) | 640–1024px | 双列 transcript(60%) + insights(40%)，speaker 头像缩小到 28px |
| Desktop (lg) | 1024–1440px | 三列 speakers(160px) + transcript(1fr) + insights(320px) |
| Wide (xl) | ≥ 1440px | 同上 + 顶部 Timeline 加宽到 100%，字体 +1pt |

### 7. 可观测指标 (Observability metrics)

| Header | 示例 | 用途 |
| --- | --- | --- |
| `X-ASR-Engine` | `xunfei-realtime` / `mock` / `whisper-wasm` | 引擎版本 |
| `X-ASR-Latency-Ms` | `187` | 首字延迟 |
| `X-ASR-Sample-Rate` | `16000` | 音频采样率 |
| `X-ASR-Channel` | `mono` | 声道数 |
| `X-ASR-Confidence` | `0.94` | 段落平均置信度 |
| `X-ASR-Speakers-Detected` | `3` | 已识别说话人数 |
| `X-ASR-Lang` | `zh-CN` | 当前识别语言 |
| `X-WS-Connected` | `true` | WebSocket 健康 |
| 控制台 log | `[ASR] seg-12 latency=187ms conf=0.94 engine=xunfei` | 时间戳 + 引擎 |
| Sentry metric | `asr.first_byte_ms` / `asr.word_error_rate` | 性能追踪 |

### 8. 深色模式 (Dark mode)

| 元素 | Light | Dark |
| --- | --- | --- |
| 录音按钮背景 | `--color-danger` | `--red-5` |
| 波形条主色 | `--color-primary` | `--blue-5` |
| 波形条静音色 | `--color-text-tertiary` | `--slate-7` |
| Transcript 底色 | `--color-bg` | `--color-bg` (slate-12) |
| AI Insights 卡背景 | `--color-bg-subtle` | `--color-bg-subtle` (slate-10) |
| 置信度热力 (低) | `--color-warning-bg` (amber-2) | `rgba(250,173,20,0.15)` |
| 录音红点 | `--red-5` (pure) | `--red-5` (纯色，AAA 对比度保留) |
| Timeline active | `--color-primary-bg` | `rgba(64,150,255,0.18)` |

### 9. KPI 基线 (KPI baseline)

| 指标 | 目标 |
| --- | --- |
| 首字延迟 (First-byte latency) | < 300ms (P95) |
| 转写准确率 (CER，中文) | ≥ 96% (静音/普通办公室环境) |
| 发言人识别准确率 | ≥ 90% (3 人内) |
| 0 卡顿率 | 100% (60fps 波形，16ms 帧预算) |
| 麦克风权限引导成功率 | ≥ 80% |
| 离线模式降级时间 | < 200ms 自动切换 |
| 端到端测试覆盖 | 转写流程 + 发言人识别 + 导出 e2e |

---

## 子模式 2 ── TTS 语音合成 (Text-to-Speech)

### 1. 行业最佳实践 (Industry best practices)

| 产品 | 一句话亮点 |
| --- | --- |
| **ElevenLabs** | "Voice Design" 用自然语言描述生成声音 ("温暖的中年女性，略带沙哑")；情绪标签 `<emotion value="excited">` 直接嵌入 SSML。 |
| **Azure Neural TTS** | 400+ 神经语音 + 100+ 语言；SSML `<prosody rate="+20%">` 完整支持停顿/重音/呼吸；自研 Custom Neural Voice 3 分钟样本即可克隆。 |
| **火山引擎语音** | 200+ 音色 + "声音超市" marketplace；按字符计费透明；多情感 TTS ("开心""悲伤""愤怒"枚举)。 |
| **剪映 AI 配音** | 视频剪辑场景内置，音色选择与字幕时间轴双向绑定；"克隆自己声音"60 秒即可。 |
| **讯飞合成** | 中文 TTS 业界第一梯队，超拟人度 MOS 4.6/5.0；支持"AI 读课文"教育场景。 |

### 2. 亮点挖掘 (Highlight mining, ≥8)

1. **音色试听矩阵 (Voice Grid)** — 4×N 网格，每张卡片含头像 + 名称 + 语种 + 性别标签 + ▶ 试听按钮，点击即时播放 3s 样本。
2. **SSML 可视化编辑器** — `<prosody>`/`<break>`/`<emphasis>`/`<say-as>` 标签以彩色 chip 形式插入文本，所见即所得。
3. **滑块三件套** — 语速 (0.5x–2.0x)、音调 (-12 ~ +12 半音)、音量 (0–200%) 三个 Slider，hover 显示数值气泡。
4. **情感胶囊** — 顶部 chips：`中性 / 开心 / 悲伤 / 愤怒 / 温柔 / 兴奋`，选中后实时应用到选中段落。
5. **段落级混音** — 长文本自动按 `\n\n` 切段，每段可独立设置音色/语速，类似 Studio One 时间轴。
6. **波形 + 字幕联动** — 生成的音频下方时间轴 + 字幕同步滚动，click 字幕 seek 到音频位置。
7. **A/B 盲测对比** — "对比模式" 同时播两个音色，记录用户偏好 (10s 选择超时)，后台聚合到 `voice-pref.jsonl`。
8. **声音超市 (Marketplace)** — 社区创作者上传声音模板，每个含 5 标签 + 试听 + 一键应用到我的项目。
9. **快捷键** — Space 播放/暂停，`[` `]` 调整选区，`1-9` 切到第 N 个音色。
10. **导出多格式** — MP3 / WAV / OGG / 16-bit PCM，码率选择 64/128/256/320kbps。

### 3. ASCII 线框图 (Wireframe)

```
┌─ VoicePage ─ TTS 语音合成 ──────────────────────────────────────────────────┐
│ ┌─ Voice Grid (4 列) ────────────────────────────────────────────────────┐  │
│ │ ┌─ 晓晓 ──┐ ┌─ 云希 ──┐ ┌─ 伊娃 ──┐ ┌─ 艾伦 ──┐ ┌─ 小美 ──┐         │  │
│ │ │ 👩 标准│ │ 🧑 温柔│ │ 👧 儿童│ │ 👨 沉稳│ │ 👵 老年│ ▶ 试听 │         │  │
│ │ │ zh-CN │ │ zh-CN │ │ en-US │ │ en-GB │ │ zh-CN │         │  │
│ │ │ ▶ ▶ ▶ │ │ ▶ ▶ ▶ │ │ ▶ ▶ ▶ │ │ ▶ ▶ ▶ │ │ ▶ ▶ ▶ │         │  │
│ │ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │  │
│ │ ┌─ 自定义 ─┐ ┌─ 收藏1 ─┐ ┌─ 我的 ──┐ ┌─ +新建 ──────────┐    │  │
│ │ │ 🎤 克隆 │ │ ⭐ 晓晓 │ │ 👤 张总 │ │ 创建自定义声音  │    │  │
│ │ └─────────┘ └─────────┘ └─────────┘ └────────────────┘    │  │
│ └────────────────────────────────────────────────────────────────┘  │
│ ┌─ Editor ─────────────────────┐ ┌─ Settings ─────────────────┐         │
│ │ 文本:                       │ │ 语速  ●─────●──── 1.0x     │         │
│ │   "今天天气[prosody]真好[/]│ │ 音调  ──●────────── +0     │         │
│ │    ，适合出门散步。"        │ │ 音量  ────●──────── 100%   │         │
│ │                              │ │ 情感  [中性 开心 悲伤 愤怒] │         │
│ │ 段落2: 晓晓 · 1.2x          │ │ 码率  ⦿128k ⦿256k ⦿320k   │         │
│ │                              │ │ 格式  ⦿MP3 ◯WAV ◯OGG     │         │
│ │ ┌─ Insert SSML ──────────┐  │ │ ☑ 长文本静音检测          │         │
│ │ │ <break/> <emphasis>    │  │ │ ☑ 自动按句切分段落        │         │
│ │ │ <prosody> <say-as>     │  │ └────────────────────────────┘         │
│ │ └────────────────────────┘  │                                       │
│ └──────────────────────────────┘                                       │
│ ┌─ Player ──────────────────────────────────────────────────────────┐     │
│ │ ▶ 0:00 ├─────●─────────────────┤ 0:12   🔊 ▬▬▬▬▬▬▬▬   ⬇ MP3  │     │
│ │ 字幕:  今天天气真好，│适合出门散步。│明天继续...              │     │
│ └──────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4. 关键交互流 (Key interaction flow)

```
[打开 TTS Tab]
    │
    ▼
[选择音色卡片 "晓晓"]──▶ [GET /api/speech/voices?lang=zh-CN]──▶ [试听 3s]
    │                                              │
    │                                              ▼
    │                                    [audio.play() → ended]
    ▼
[输入文本 / 粘贴]──▶ [实时统计字符数 + 预估时长 (中速 200 字/分)]
    │
    ▼
[调整语速/音调/音量]──▶ [debounce 300ms]──▶ [重新生成预览音频]
    │
    ▼
[点击 ▶ 合成完整音频]──▶ [POST /api/tts/synthesize] 
                            headers: X-TTS-Engine=azure-volcano-mock
                            body: { text, voice, speed, pitch, emotion, format }
    │                     │
    │                     ▼
    │           [SSE 流式分片返回 audio chunks]
    │                     │
    │                     ▼
    │           [拼接 → audio blob URL → 播放器加载]
    ▼
[⬇ 导出 MP3 / 复制字幕 / 推送到翻译对比]
```

### 5. 动效规范 (Animation specs)

| 元素 | 属性 | 时长 | Easing |
| --- | --- | --- | --- |
| 音色卡片 hover | `transform: translateY(-2px)` + shadow | 180ms | `cubic-bezier(0.4,0,0.2,1)` |
| 音色卡片选中 | `border-color → --color-primary` + ring | 200ms | ease-out |
| ▶ 试听波形 | `transform: scaleX(var(--play-progress))` | 60fps | linear |
| Slider thumb hover | `scale(1.15)` | 120ms | ease-out |
| 情感 chip 切换 | `background-color` | 150ms | ease-out |
| SSML chip 插入 | `width 0→auto` + `opacity` | 200ms | `cubic-bezier(0,0,0.2,1)` |
| 合成按钮 → 进度条 | `border-radius 24px→4px` | 240ms | `cubic-bezier(0.4,0,0.2,1)` |
| 段落切换 | `translateY` | 220ms | ease-in-out |

### 6. 响应式断点 (Responsive breakpoints)

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| Mobile | < 640px | Voice Grid 单列 (大卡片) + Editor 全宽 + Settings 折叠进 sheet |
| Tablet | 640–1024px | Voice Grid 3 列 + Editor/Settings 上下堆叠 |
| Desktop | ≥ 1024px | Voice Grid 5 列 + Editor(2fr) / Settings(1fr) 横排 |
| Wide | ≥ 1440px | Voice Grid 6 列 + Player 加宽 |

### 7. 可观测指标 (Observability metrics)

| Header | 示例 | 用途 |
| --- | --- | --- |
| `X-TTS-Engine` | `azure-neural` / `volcano` / `mock` | 引擎标识 |
| `X-TTS-Voice` | `zh-CN-XiaoxiaoNeural` | 实际使用的音色 |
| `X-TTS-Characters` | `847` | 输入字符数 |
| `X-TTS-Duration-Ms` | `254000` | 输出音频时长 |
| `X-TTS-Synth-Latency-Ms` | `1280` | 合成耗时 |
| `X-TTS-RTF` | `0.18` | Real-Time Factor (< 1 实时) |
| `X-TTS-Bitrate` | `128000` | 实际码率 |
| `X-TTS-Cache-Hit` | `false` | 是否命中缓存 |
| console | `[TTS] chars=847 voice=zh-CN-XiaoxiaoNeural rtf=0.18 cached=false` | 时间戳 |
| Sentry | `tts.synth_latency_ms` / `tts.first_byte_ms` | 性能追踪 |

### 8. 深色模式 (Dark mode)

| 元素 | Light | Dark |
| --- | --- | --- |
| 音色卡片背景 | `--color-bg` | `--color-bg` (slate-12) |
| 音色卡片 hover 边框 | `--color-primary` | `--blue-5` |
| Slider track 填充 | `--color-primary` | `--blue-5` |
| SSML chip 背景 | `--color-ai-bg` (purple-3) | `rgba(114,46,209,0.18)` |
| 情感 chip active | `--color-primary-bg` | `rgba(64,150,255,0.18)` |
| 播放器波形条 | `--color-primary` | `--blue-5` |
| 文本编辑器 | `--color-bg` | `--color-bg` |
| 试听未播放 dim | `opacity: 0.5` | `opacity: 0.4` |

### 9. KPI 基线 (KPI baseline)

| 指标 | 目标 |
| --- | --- |
| 试听首字节延迟 | < 200ms |
| 完整合成 RTF | < 0.3 (1 分钟文本 < 20s 合成) |
| 流式合成首字节 | < 500ms (SSE) |
| 音色卡 hover 响应 | < 100ms |
| 滑块调整防抖 | 300ms (debounce) |
| SSML 解析正确率 | 100% (单元测试) |
| MOS 主观音质 | ≥ 4.5/5.0 (内部评测) |
| e2e 覆盖 | 试听 / 合成 / 导出 / 情感切换 |

---

## 子模式 3 ── 音频翻译 (Audio Translation)

### 1. 行业最佳实践 (Industry best practices)

| 产品 | 一句话亮点 |
| --- | --- |
| **网易见外** | 国内最早做"音频 → 字幕 → 翻译 → 配音"全流程的工作台；中英日韩四语互译。 |
| **DeepL Voice** (2026 即将上线) | "会议同传模式"，说话时实时双语字幕滚动 + 延迟 < 1s。 |
| **飞书翻译会议** | 视频会议中"实时字幕 + 双向翻译"模式，每个参会者可自选目标语。 |
| **Rask.ai** | 130+ 语种 + 保留原说话人情绪/节奏 + SRT 一键导入导出。 |
| **HeyGen 翻译** | 视频翻译 + 唇形同步 + 自定义口音，全球出海团队首选。 |

### 2. 亮点挖掘 (Highlight mining, ≥8)

1. **四列对照布局** — `[原音频波形] [源文转写] [译文] [目标音频波形]` 横向四列，所有段按时间轴对齐。
2. **时间轴拖拽定位** — 点击任意列的某段 → 四列同时滚动到该时间点 + 闪烁高亮。
3. **双语字幕预览** — 视频播放器底部双行字幕（上行原语言、下行译文），颜色对比 `--color-text` vs `--color-text-secondary`。
4. **AI 校对入口** — 译文 hover 显示"🤖 AI 润色"按钮，调用 `/api/translate/realtime` 返回 3 个备选。
5. **情感保留度** — 译文右侧进度条显示"情感匹配度 92%"，按段打分，可手动选择"重写更口语"。
6. **段级重合成** — 单段点击 🔊 重新合成该段音频，不影响其他段（无需重新生成整段）。
7. **导出工作流** — 一键打包：原字幕 SRT + 译文 SRT + 双语 VTT + 配音 MP3 + 项目 JSON。
8. **说话人声音映射** — 原文 Speaker A/B/C 自动分配到不同目标音色，可手动重映射 ("Speaker A → 晓晓")。
9. **语速自适应** — 译文过长时自动"加速合成"对齐原段时长，避免音视频脱节。
10. **⌘K 操作** — "跳到第 5 段"、"重合成第 12 段"、"切换 Speaker B 的音色"。

### 3. ASCII 线框图 (Wireframe)

```
┌─ VoicePage ─ 音频翻译 ───────────────────────────────────────────────────┐
│ ┌─ File Header ──────────────────────────────────────────────────────┐    │
│ │ 📁 keynote.mp3  12:34  en→zh  ▶ 完整试听   ⬇ 打包导出  ⚙ 高级    │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Timeline ───────────────────────────────────────────────────────┐      │
│ │ 0:00├─Seg1─┤├─Seg2─┤├─Seg3─┤├─Seg4─┤├─Seg5─┤├─...─┤├─Seg28─┤ 12:34│      │
│ │      👨 A  👩 B  👨 A  👨 A  👩 B           👨 A                  │      │
│ └─────────────────────────────────────────────────────────────────┘      │
│ ┌─ Source Audio ────┐ ┌─ Source Text ─┐ ┌─ Translation ──┐ ┌─ Target ──┐ │
│ │ ▁▂▆█▇▅▃▂▁▂▄▆█▇▅▃ │ │ Welcome to our│ │ 欢迎来到我们  │ │ ▁▂▆█▇▅▃▂▁▂▄│ │
│ │ ▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅ │ │ Q3 all-hands.│ │ 的 Q3 全员大会。│ │ ▆█▇▅▃▂▁▂▄▆│ │
│ │  👨 A  ● active  │ │ Let me start │ │ 让我先介绍一下│ │  👨 A→晓晓│ │
│ │                   │ │ with revenue │ │ 本季度营收。  │ │ ● playing │ │
│ │ ▶ 0:00 / 0:08    │ │ [conf: 🟢🟢🟢] │ │ [AI润色]      │ │ 🔄 重合成 │ │
│ │ ┌──────────────┐  │ └──────────────┘ └───────────────┘ └──────────┘ │
│ │ │ Seg Controls │  │                                              │
│ │ │ ← 上一段    │  │                                              │
│ │ │ → 下一段    │  │                                              │
│ │ │ ⌃/⌄ 切段     │  │                                              │
│ │ └──────────────┘  │                                              │
│ └───────────────────┘                                              │
│ ┌─ Bilingual Caption Preview ─────────────────────────────────────────┐   │
│ │ 00:00:08,000 --> 00:00:12,500                                    │   │
│ │   Welcome to our Q3 all-hands.                                    │   │
│ │   欢迎来到我们的 Q3 全员大会。                                    │   │
│ └────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4. 关键交互流 (Key interaction flow)

```
[上传音频或拖拽 mp3/m4a/wav]
    │
    ▼
[POST /api/speech/translate-task]──▶ [创建任务，返回 taskId]
    │                                              │
    │                                              ▼
    │                                    [后台 ASR + 翻译 + TTS 流水线]
    │                                              │
    │                                              ▼
    │                                    [SSE 推送 progress]
    │                                              │
    ▼                                              ▼
[前端 SSE 接收]──▶ [实时填充四列]──▶ [当前段 active 高亮]
    │
    ▼
[点击 Seg5 译文]──▶ [触发 Seg5 音频播放 + 滚动对齐]
    │
    ▼
[点击 🔄 重合成]──▶ [POST /api/tts/synthesize seg5 only]──▶ [原地替换]
    │
    ▼
[⬇ 打包导出]──▶ [POST /api/speech/translate-export]──▶ [下载 zip]
    │                                                    │
    │                                                    ▼
    │                                          [含: src.srt, tgt.srt, 
    │                                           bilingual.vtt, audio.mp3,
    │                                           project.json]
    ▼
[Toast: 导出成功，已保存到 /files/<id>]
```

### 5. 动效规范 (Animation specs)

| 元素 | 属性 | 时长 | Easing |
| --- | --- | --- | --- |
| 段激活高亮 | `background-color → --color-primary-bg` | 200ms | ease-out |
| 四列同步滚动 | `scrollTop` 平滑滚动 | 320ms | `cubic-bezier(0.4,0,0.2,1)` |
| 译文淡入 | `opacity 0→1` + `translateY(4px→0)` | 280ms | ease-out |
| 音频播放指针 | `transform: translateX` | 60fps | linear |
| AI 润色卡片 | `scale(0.96→1)` + `opacity` | 200ms | `cubic-bezier(0,0,0.2,1)` |
| Timeline segment hover | `transform: scaleY(1.1)` | 120ms | ease-out |
| 重合成 loading | spinner + opacity | 600ms loop | linear |
| Export zip progress | `width 0→100%` | linear | linear |

### 6. 响应式断点 (Responsive breakpoints)

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| Mobile | < 640px | 单列纵向滚动：源音 → 源文 → 译文 → 目标音，时间轴放底部 |
| Tablet | 640–1024px | 2 列网格：源 + 目标 (各含音频 + 字幕)，2×2 子网格 |
| Desktop | ≥ 1024px | 4 列横向，比例 1:1.2:1.2:1 |
| Wide | ≥ 1440px | 4 列等宽，时间轴加宽到 100% |

### 7. 可观测指标 (Observability metrics)

| Header | 示例 | 用途 |
| --- | --- | --- |
| `X-Translate-Engine` | `deepl-v3` / `mock` / `baidu-trans` | 翻译引擎 |
| `X-Translate-Src-Lang` | `en-US` | 源语言 |
| `X-Translate-Tgt-Lang` | `zh-CN` | 目标语言 |
| `X-Translate-Segments` | `28` | 段落数 |
| `X-Translate-Align-Method` | `myers` | 对齐算法 |
| `X-TTS-Engine` | `azure-neural` | 配音引擎 |
| `X-Audio-Duration-Ms` | `754000` | 总时长 |
| `X-Export-Format` | `zip` | 导出格式 |
| `X-Export-Size-Bytes` | `2847392` | 导出文件大小 |
| console | `[Translate] taskId=tx-12 segs=28 src=en tgt=zh rtf=0.18` | 时间戳 |
| Sentry | `translate.align_ms` / `tts.seg_resynth_ms` | 性能追踪 |

### 8. 深色模式 (Dark mode)

| 元素 | Light | Dark |
| --- | --- | --- |
| 源文文字色 | `--color-text` | `--color-text` (slate-1) |
| 译文文字色 | `--color-text-secondary` | `--slate-9` |
| 当前段背景 | `--color-primary-bg` (blue-2) | `rgba(64,150,255,0.15)` |
| AI 润色 chip | `--color-ai-bg` (purple-3) | `rgba(114,46,209,0.18)` |
| 时间轴 Speaker A 色 | `--blue-7` | `--blue-5` |
| 时间轴 Speaker B 色 | `--purple-7` | `--purple-5` |
| 重合成 loading | `--color-primary` | `--blue-5` |
| 双语字幕预览背景 | `--color-bg-subtle` | `--color-bg-subtle` (slate-10) |

### 9. KPI 基线 (KPI baseline)

| 指标 | 目标 |
| --- | --- |
| 完整流程耗时 (10min 音频) | < 60s (ASR + 翻译 + TTS 端到端) |
| 翻译对齐精度 (Myers) | ≥ 95% 段级匹配 |
| 译文 BLEU | ≥ 35 (中英) |
| 段级重合成延迟 | < 1.5s (单段) |
| 导出 zip 生成 | < 3s (10min 音频) |
| 情感保留度 | ≥ 85% (人工评测) |
| 音视频时长对齐误差 | < 200ms / 段 |
| e2e 覆盖 | 上传 / 翻译 / 校对 / 重合成 / 导出 |

---

## 子模式 4 ── 视频翻译/配音 (Video Dubbing)

### 1. 行业最佳实践 (Industry best practices)

| 产品 | 一句话亮点 |
| --- | --- |
| **HeyGen** | 视频翻译 + 唇形同步 (Lip Sync) 行业标杆；160+ 语种；保留原表情/手势。 |
| **Rask.ai** | "VoiceClone + Translate" 一体化；上传 1 分钟视频即可克隆说话人声音；SRT/VTT 双向导入。 |
| **剪映 AI 配音** | 中文场景最强；"克隆自己声音" 60 秒样本 + 字幕时间轴所见即所得。 |
| **鬼手剪辑 (魔音工坊)** | 字节系背景；音色商店 1000+；"魔音"模式可保留笑声/叹息等非语音元素。 |
| **Captions (App)** | 移动端 AI 视频剪辑，AI 字幕 + 配音 + 滤镜三件套；创作者最爱。 |

### 2. 亮点挖掘 (Highlight mining, ≥8)

1. **双轨时间轴** — 上轨原音频波形 + 下轨合成音频波形，并排显示时间差 gap。
2. **唇形同步可视化** — 视频画面叠加 SVG 关键点标记 (嘴部轮廓)，sync 偏移 < 80ms 时绿色，超时变红。
3. **声音克隆保留** — 字幕段落 hover 显示 "用原声克隆的音色",点击可一键切换到通用音色 (省成本)。
4. **背景音/笑声保留** — 检测到非语音段（呼吸、笑声、背景音），自动 keep 不翻译，仅翻译语音部分。
5. **批量处理** — 拖入 50 个视频 → 队列处理 → 进度条 + ETA + 失败重试。
6. **逐句预览** — 视频播放器下方 4 个切换按钮：静音 / 原声 / 译声 / 双语，左右可对比。
7. **唇形同步强度调节** — Slider 0–100%，0 = 不动唇形 (便宜) / 100 = 完美唇形 (贵)。
8. **导出对比视频** — 同时导出原视频 + 翻译视频 (上下分屏或左右分屏)，方便发布到双频道。
9. **自动切片** — 长视频自动按场景/静音切片为多个 sub-task，并行处理。
10. **字幕样式编辑器** — 字体/颜色/位置/背景/描边可视化调整，所见即所得。

### 3. ASCII 线框图 (Wireframe)

```
┌─ VoicePage ─ 视频翻译/配音 ───────────────────────────────────────────────┐
│ ┌─ File Header ───────────────────────────────────────────────────────┐   │
│ │ 🎬 product-demo.mp4  03:42  en→zh   ▶ 预览  📤 导出  ⚙ 高级设置 │   │
│ └─────────────────────────────────────────────────────────────────────┘   │
│ ┌─ Video Preview ────────────┐ ┌─ Sync Status ──────────────────────┐    │
│ │  ┌──────────────────────┐ │ │ 唇形同步: ● 偏移 42ms (绿色 OK)   │    │
│ │  │                      │ │ │ 情感保留: ● 92% (优秀)             │    │
│ │  │       VIDEO          │ │ │ 语音保留: ● 100% (笑声/呼吸保留) │    │
│ │  │                      │ │ │ 静音检测: ● 8 段                   │    │
│ │  └──────────────────────┘ │ └────────────────────────────────────┘    │
│ │  ◀ ▶ ⏸  0:42 / 3:42       │ ┌─ Lip Sync Slider ──────────────────┐    │
│ │  声道: ◉译 ◯原 ◯双语       │ │ 唇形强度: ●─────●──── 80%         │    │
│ └───────────────────────────┘ │ 💰 预计成本: $0.42 (80% vs 100%)   │    │
│                              └────────────────────────────────────┘    │
│ ┌─ Dual Track Timeline ──────────────────────────────────────────────┐    │
│ │ 原音:  ▁▂▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂  (en)                │    │
│ │ 译音:  ▁▂▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂  (zh)                │    │
│ │ 字幕:  Welcome│to│our│Q3│all-hands│.│Let│me│start│with│revenue│. │    │
│ │        欢迎│来到│我们│的│Q3│全员│大会│.│让我│先│介绍│本季度│营收│.│    │
│ │ Speaker: 👨 A → 晓晓   👩 B → 云希                               │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│ ┌─ Segment Table ────────────────────────────────────────────────────┐    │
│ │ #  时间    说话人  原音色       译音色    唇形同步  操作           │    │
│ │ 1  0:00.08 A       original     晓晓     ●42ms    🔊👁⚙           │    │
│ │ 2  0:00.15 B       original     云希     ●38ms    🔊👁⚙           │    │
│ │ 3  0:00.23 A       original     晓晓     ●51ms    🔊👁⚙           │    │
│ └────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4. 关键交互流 (Key interaction flow)

```
[上传视频或拖拽 mp4/mov]──▶ [POST /api/video/dubbing-task]
    │                                              │
    │                                              ▼
    │                                    [后台: ffmpeg 抽音轨 + ASR + 翻译 + TTS + 唇形]
    │                                              │
    │                                              ▼
    │                                    [SSE 推送 progress per stage]
    │                                              │
    ▼                                              ▼
[前端 SSE]──▶ [显示 5 阶段进度: 抽音 20% / ASR 60% / 翻译 80% / TTS 95% / 合成 100%]
    │
    ▼
[预览播放器]──▶ [▶ 播放对比 / 切换声道 / 调整进度]
    │
    ▼
[调整唇形 Slider 80%→50%]──▶ [POST /api/video/dubbing-regen taskId=X lipSync=0.5]
    │                                              │
    │                                              ▼
    │                                    [服务端重新生成 + SSE 通知完成]
    ▼
[📤 导出]──▶ [选择: 原视频/译视频/对比视频]
    │                                              │
    │                                              ▼
    │                                    [POST /api/video/export]──▶ [下载 mp4]
    ▼
[批量处理: 拖入 50 个视频]──▶ [创建队列 + 并行 4 worker + ETA]
```

### 5. 动效规范 (Animation specs)

| 元素 | 属性 | 时长 | Easing |
| --- | --- | --- | --- |
| 5 阶段进度切换 | `width` 进度条 + 阶段标签 fade | 400ms | `cubic-bezier(0.4,0,0.2,1)` |
| 视频播放器进入 | `scale(0.96→1)` + opacity | 240ms | `cubic-bezier(0.4,0,0.2,1)` |
| 唇形同步状态变色 | `background-color` (绿/黄/红) | 200ms | ease-out |
| 双轨波形播放 | `transform: translateX` | 60fps | linear |
| 字幕淡入 | `opacity 0→1` + `translateY(2px→0)` | 220ms | ease-out |
| Segment 行 hover | `background-color → --color-bg-hover` | 120ms | ease-out |
| Lip Sync Slider 拖拽 | thumb scale | 100ms | ease-out |
| Export 进度 | `width` | linear | linear |

### 6. 响应式断点 (Responsive breakpoints)

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| Mobile | < 640px | 视频全宽 (16:9) + 字幕纵向滚动 + 段表折叠到 sheet |
| Tablet | 640–1024px | 视频(60%) + Sync Status(40%)，双轨时间轴放底部 |
| Desktop | ≥ 1024px | 视频(2fr) + Side Panel(1fr)，双轨时间轴全宽，段表 inline |
| Wide | ≥ 1440px | 视频加宽到 60% 屏宽，时间轴显示更细颗粒度 |

### 7. 可观测指标 (Observability metrics)

| Header | 示例 | 用途 |
| --- | --- | --- |
| `X-Video-Duration-Ms` | `222000` | 视频时长 |
| `X-Video-Resolution` | `1920x1080` | 原始分辨率 |
| `X-Dubbing-Engine` | `heygen-v2` / `mock` / `rask` | 配音引擎 |
| `X-LipSync-Offset-Ms` | `42` | 唇形同步偏移 |
| `X-LipSync-Strength` | `0.8` | 唇形强度参数 |
| `X-Stage-Progress` | `tts:0.95` | 当前阶段进度 |
| `X-Speakers-Detected` | `2` | 说话人数 |
| `X-Cost-Estimated` | `0.42` | 估算成本 (USD) |
| `X-Export-Format` | `mp4` | 导出格式 |
| console | `[Dubbing] taskId=vd-12 stage=tts progress=0.95 lipSync=42ms` | 时间戳 |
| Sentry | `dubbing.stage_latency_ms.{stage}` / `lipsync.offset_ms` | 性能追踪 |

### 8. 深色模式 (Dark mode)

| 元素 | Light | Dark |
| --- | --- | --- |
| 视频容器背景 | `#000000` (always) | `#000000` (always) |
| 字幕文字 | `--color-text` | `--color-text` (slate-1) |
| 字幕背景 | `rgba(0,0,0,0.7)` | `rgba(0,0,0,0.85)` |
| 唇形同步状态-优 | `--color-success` (green-6) | `--green-5` |
| 唇形同步状态-中 | `--color-warning` (amber-6) | `--amber-5` |
| 唇形同步状态-差 | `--color-danger` (red-5) | `--red-5` |
| 双轨波形-原音 | `--color-text-secondary` | `--slate-9` |
| 双轨波形-译音 | `--color-primary` | `--blue-5` |
| Segment 表行 hover | `--color-bg-hover` | `--color-bg-hover` (slate-9) |

### 9. KPI 基线 (KPI baseline)

| 指标 | 目标 |
| --- | --- |
| 5 分钟视频处理总时长 | < 3 分钟 (端到端) |
| 唇形同步偏移 | < 80ms (P95) |
| 情感保留度 | ≥ 85% |
| 语音/非语音分离准确率 | ≥ 95% |
| 批量 50 视频队列吞吐 | ≥ 4 并行，无 OOM |
| 唇形强度调整响应 | < 2s 重新生成 |
| 导出 mp4 渲染 | < 30s (5min 视频) |
| e2e 覆盖 | 上传 / 处理 / 预览 / 唇形调整 / 导出 |

---

## 子模式 5 ── 声音克隆 (Voice Clone)

### 1. 行业最佳实践 (Industry best practices)

| 产品 | 一句话亮点 |
| --- | --- |
| **ElevenLabs Voice Design** | 用自然语言描述生成全新声音 ("30 岁英国女性，专业播音员，中低音") + 3 秒样本即可 Instant Clone。 |
| **Azure Custom Neural Voice** | 企业级 3 分钟样本训练 Professional；30 秒样本训练 Personal；支持 SSML + 自定义字典。 |
| **讯飞音库** | 中文场景最专业；"AI 读课文"教育场景；5 分钟样本即可商用授权。 |
| **魔音工坊 (字节)** | 中文 C 端第一；声音商店 1000+ 创作者声音；"AI 配音 + 短视频"一键工作流。 |
| **Replica Studios** | 游戏/动画场景；情绪标签丰富 (whisper/shout/cry/laughing)；API 友好。 |

### 2. 亮点挖掘 (Highlight mining, ≥8)

1. **录音向导 (Wizard)** — 5 步流程：录前准备 → 环境检测 → 试读 5 句 → 正式录制 → 校验。每步进度条 + 倒计时。
2. **环境噪音检测** — 前 3 秒采集背景噪音，dB > 50 时红色警告 ("⚠️ 检测到空调噪音，建议换房间")。
3. **试读 5 句把关** — 系统选 5 句代表性文本 (含数字/英文/语气词)，用户读完后自动评分 (清晰度/语速/停顿)。
4. **波形 + 文本同步** — 录制时实时显示波形 + 已读/未读标记，错过的句子可单句重录。
5. **声音标签设计** — 用自然语言描述 (Age/Gender/Accent/Tone/Pace + 关键词)，例如 "温暖中年女性，略带沙哑，新闻主播风格"。
6. **样本管理** — 上传后自动按时间切段，每段可单独听 + 评分，差的段标记 "需重录"。
7. **克隆预览** — 输入任意文本 → 用克隆音色合成 → A/B 与原声对比，听感相似度评分。
8. **授权管理** — Personal (仅自己用) / Professional (商用授权) / Marketplace (上架销售) 三级，签字确认。
9. **声音档案** — 训练完成后生成声音卡片：声纹图谱 + 标签 + 用途统计 + 复制次数 + 评分。
10. **隐私保证** — 录音数据本地加密 + 训练后自动从缓存清除 + 区块链存证 (Enterprise)。

### 3. ASCII 线框图 (Wireframe)

```
┌─ VoicePage ─ 声音克隆 ────────────────────────────────────────────────────┐
│ ┌─ Wizard Steps ─────────────────────────────────────────────────────┐    │
│ │  ① 准备  ●─▶ ② 环境  ●─▶ ③ 试读  ●─▶ ④ 录制  ○─▶ ⑤ 校验         │    │
│ └────────────────────────────────────────────────────────────────────┘    │
│ ┌─ 当前步: ④ 录制 (3/5) ──────────────────────────────────────────┐        │
│ │  请朗读: "今天北京的天气晴朗，气温 25 度，空气质量指数 42。"      │        │
│ │  ▁▂▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂▁▂▄▆█▇▅▃▂    ⏱ 0:08 / 0:12        │        │
│ │  状态: ● 录音中 (剩余 4s)                                       │        │
│ │  [⏸ 暂停] [⏹ 停止] [🔁 重录此句]                                │        │
│ └────────────────────────────────────────────────────────────────┘        │
│ ┌─ 已录样本 ─────────────────────────────────────────────────────┐         │
│ │ #1  0:12  "今天北京的天气晴朗..."        ✓ 清晰度 92%  [🔊] [🔁]│         │
│ │ #2  0:11  "我喜欢在清晨喝一杯咖啡。"    ✓ 清晰度 88%  [🔊] [🔁]│         │
│ │ #3  0:14  "The quick brown fox jumps..." ✓ 清晰度 95%  [🔊] [🔁]│         │
│ │ #4  ⏳ 待录 "请在 3 秒内回答：1+1=?"                          │         │
│ │ #5  ⏳ 待录 "再见，期待下次与您交流。"                         │         │
│ └────────────────────────────────────────────────────────────────┘         │
│ ┌─ 声音档案 (训练完成后展示) ──────────────────────────────────────┐        │
│ │  👤 "晓晓-专业版"  声纹图谱 ▁▂▆█▇▅▃  标签: 中年女性·新闻主播    │        │
│ │  训练时长: 12 分钟  样本: 5 段  总时长: 1 分 02 秒              │        │
│ │  [▶ 试听克隆音色]  [⚙ 编辑标签]  [📤 上架到声音超市]            │        │
│ │  ────────────────────────────────────────────────────────────  │        │
│ │  相似度: ● 92%   MOS: 4.4/5.0   商用授权: Personal             │        │
│ └────────────────────────────────────────────────────────────────┘        │
│ ┌─ Footer ────────────────────────────────────────────────────────┐        │
│ │ 💾 保存草稿  ⏭ 跳过试读  ◀ 上一步  [下一步: 校验] →             │        │
│ └────────────────────────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────────────────┘
```

### 4. 关键交互流 (Key interaction flow)

```
[进入"声音克隆" Tab]
    │
    ▼
[点击"开始克隆"]──▶ [Wizard 步骤 1: 准备]
    │                  │
    │                  ▼
    │            [显示录音要求: 安静环境 + 5 分钟 + 麦克风距离]
    │
    ▼
[步骤 2: 环境检测]──▶ [录音 3 秒]──▶ [分析 dB / 频谱]
    │                                              │
    │                                              ▼
    │                                    [Pass / Warn (噪音过大)]
    ▼
[步骤 3: 试读 5 句]──▶ [每句评分: 清晰度/语速/停顿]
    │                                              │
    │                                              ▼
    │                                    [总分 ≥ 80 才可进入步骤 4]
    ▼
[步骤 4: 正式录制 5 句]──▶ [每段上传]──▶ [后台合并样本]
    │                                              │
    │                                              ▼
    │                                    [可选: 边录边预览波形]
    ▼
[步骤 5: 校验]──▶ [POST /api/voice/clone]
    │   body: { samples: [{text, audioBlob}, ...], tags: {...} }
    │                                              │
    │                                              ▼
    │                                    [后台训练: 通常 5–30 分钟]
    │                                              │
    │                                              ▼
    │                                    [SSE 推送: training → done]
    ▼
[显示声音档案]──▶ [试听克隆音色 + A/B 对比 + 上架]
```

### 5. 动效规范 (Animation specs)

| 元素 | 属性 | 时长 | Easing |
| --- | --- | --- | --- |
| Wizard 步骤切换 | `transform: translateX(-100% → 0)` | 320ms | `cubic-bezier(0.4,0,0.2,1)` |
| 进度条填充 | `width` | 400ms | `cubic-bezier(0,0,0.2,1)` |
| 录音波形跳动 | `transform: scaleY(var(--amp))` | 60fps | linear |
| 评分数字滚动 | `transform: translateY` + count-up | 600ms | ease-out |
| 环境噪音警告 | `background-color` 闪烁 | 800ms × 3 | ease-in-out |
| 声音档案出现 | `opacity 0→1` + `scale(0.96→1)` | 280ms | `cubic-bezier(0.4,0,0.2,1)` |
| 训练进度环 | SVG stroke-dashoffset | 1000ms loop | linear |
| 试听播放 | `scaleX` playhead | 60fps | linear |

### 6. 响应式断点 (Responsive breakpoints)

| 断点 | 宽度 | 布局 |
| --- | --- | --- |
| Mobile | < 640px | 单列纵向 Wizard (步骤指示器放顶部 sticky)，波形全宽 |
| Tablet | 640–1024px | 录制区(60%) + 已录样本列表(40%) |
| Desktop | ≥ 1024px | Wizard 步骤指示器顶部 + 录制区(2fr) + 已录样本(1fr) |
| Wide | ≥ 1440px | 同 Desktop + 声音档案卡片加宽 + 波形更精细 |

### 7. 可观测指标 (Observability metrics)

| Header | 示例 | 用途 |
| --- | --- | --- |
| `X-VoiceClone-Engine` | `azure-neural-pro` / `mock` / `elevenlabs-instant` | 引擎版本 |
| `X-VoiceClone-Sample-Count` | `5` | 样本数 |
| `X-VoiceClone-Total-Duration-Ms` | `62000` | 样本总时长 |
| `X-VoiceClone-Training-Ms` | `480000` | 训练耗时 |
| `X-VoiceClone-Similarity` | `0.92` | 声纹相似度 |
| `X-VoiceClone-MOS` | `4.4` | 主观音质分 |
| `X-VoiceClone-License` | `personal` / `professional` | 授权级别 |
| `X-VoiceClone-Status` | `training` / `ready` / `failed` | 状态 |
| console | `[VoiceClone] taskId=vc-12 status=ready similarity=0.92 mos=4.4` | 时间戳 |
| Sentry | `voiceclone.training_ms` / `voiceclone.similarity_score` | 性能追踪 |

### 8. 深色模式 (Dark mode)

| 元素 | Light | Dark |
| --- | --- | --- |
| Wizard 步骤指示器 active | `--color-primary` | `--blue-5` |
| Wizard 步骤指示器 done | `--color-success` | `--green-5` |
| Wizard 步骤指示器 pending | `--color-text-tertiary` | `--slate-7` |
| 录音波形主色 | `--color-primary` | `--blue-5` |
| 环境噪音警告背景 | `--color-warning-bg` (amber-2) | `rgba(250,173,20,0.15)` |
| 评分卡片背景 | `--color-bg-subtle` | `--color-bg-subtle` (slate-10) |
| 声音档案卡 | `--color-bg` | `--color-bg` (slate-12) |
| 相似度环 (≥0.9) | `--color-success` | `--green-5` |
| 相似度环 (0.7–0.9) | `--color-warning` | `--amber-5` |
| 相似度环 (<0.7) | `--color-danger` | `--red-5` |

### 9. KPI 基线 (KPI baseline)

| 指标 | 目标 |
| --- | --- |
| 环境噪音检测准确率 | ≥ 95% |
| 试读评分一致性 | ≥ 90% (同人多次评分) |
| 克隆训练耗时 | < 30 分钟 (5 分钟样本) |
| 声纹相似度 | ≥ 0.90 (cosine) |
| MOS 主观音质 | ≥ 4.0/5.0 |
| 录音→训练完成端到端 | < 35 分钟 |
| 隐私合规 | 100% 本地加密 + 训练后清除缓存 |
| e2e 覆盖 | 录制 / 训练 / 试听 / 商用授权 |

---

## 全局说明 (Cross-cutting)

| 维度 | 规范 |
| --- | --- |
| 设计令牌 | 全部颜色用 `--color-*` (semantic.ts 36 aliases)，禁用硬编码 #RRGGBB (P2 已清零 352 处) |
| 动效 easing | `[0.4, 0, 0.2, 1]` Material Standard (primitives.ts) |
| Reduced motion | 所有动效检测 `<html data-motion="off">` 自动降级为瞬时切换 |
| 可观测 | 所有 API 加 `X-*-Engine / Latency / Confidence / Cost` 响应头 + 时间戳 console |
| 错误处理 | 4xx/5xx 统一 toast + X-Error-Code 头 + Sentry 上报 |
| 键盘 | Space/Enter 触发主要动作，⌘K palette 跳转，Esc 关闭弹窗 |
| TDD | 每个子模式配 e2e + 单元 + 视觉回归 (Playwright snapshot) |
| changes 文档 | 每个子模式完成后保存到 `changes/voice-<submode>-design/README.md` |

---

Sources (industry products referenced):
- [Otter.ai](https://otter.ai)
- [飞书妙记](https://www.feishu.cn/product/minutes)
- [讯飞听见](https://www.iflyrec.com)
- [通义听悟](https://tingwu.aliyun.com)
- [Microsoft Teams Intelligent Recap](https://www.microsoft.com/microsoft-teams/premium)
- [ElevenLabs](https://elevenlabs.io)
- [Azure Neural TTS](https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech)
- [火山引擎语音](https://www.volcengine.com/product/voice-tech)
- [剪映 AI 配音](https://www.capcut.cn)
- [网易见外](https://sight.youdao.com)
- [DeepL Voice](https://www.deepl.com/voice)
- [Rask.ai](https://www.rask.ai)
- [HeyGen](https://www.heygen.com)
- [鬼手剪辑 / 魔音工坊](https://www.moyin.com)
- [Replica Studios](https://replicastudios.com)
- [Captions App](https://www.captions.ai)
