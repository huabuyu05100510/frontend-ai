# voice-portfolio 语音能力集成

> 模型：claude-sonnet-4-6

## 背景
- 用户要求"添加语音方面的能力集成上去"，并明确"包含 ./voice-portfolio 项目下的所有能力"、"对标顶级设计"
- voice-portfolio (Python/Flask) 提供 10+ 火山引擎语音 AI 代理（TTS/ASR/翻译/Realtime/声音复刻/音色设计/播客）
- 已调研产出 `voice-portfolio/vosk-realtime-asr/server/*.py` 移植路线（见调研报告）

## 集成范围（已落地）
按"先实现页面"指令，先打通最小后端 mock 链路 + 顶级前端 UI。

### 后端
| 文件 | 说明 |
|------|------|
| `server/src/speech.mjs` | 统一语音模块（移植自 `tts.py`/`translation.py`/`file_asr.py` 协议层） |
| `server/src/router.mjs` | 新增 5 个端点 + `/api/health/all` 增补 speech 字段 |
| `server/test/speech.test.mjs` | 12 tests 覆盖端点契约（全过） |

**端点**
- `POST /api/speech/tts` — 文本→音频（mp3/wav binary）；响应头 `X-TTS-Engine/Ms/Voice/Format`
- `POST /api/speech/asr` — 音频 taskId→文字；响应头 `X-ASR-Engine/Ms`
- `POST /api/voice/translate` — 单次翻译（带 LRU 缓存 256 条）；响应头 `X-VoiceTranslate-Engine/Cached/Ms`
- `GET /api/voice/voices` — 音色列表（凭证缺失降级 FALLBACK_VOICES）
- `GET /api/health/speech` — 健康检查

**火山引擎协议保留要点**
- 鉴权 `Authorization: Bearer; {token}`（分号+空格，与 OpenAI `Bearer ` 不同）
- 单次 TTS 硬限 1024 字节（已校验）
- LRU 缓存键 `sha1(text)` 防重复翻译
- SUPPORTED_TRANSLATE_PAIRS 白名单（31 对，zh↔en/ja/ko/ru/fr/de/es/id/vi/ms/th/ar + en↔ja/ko/fr/de/es/ru）
- 凭证缺失自动降级 mock 模式（生成最小有效 WAV 静音帧、占位文字），保证 UI 流程可演示

### 前端（对标 Google Translate Voice / Otter.ai / iOS Voice Memo）
| 文件 | 说明 |
|------|------|
| `web/src/pages/VoicePage.tsx` | 主语音中心（xf-workspace 布局，5 子模式） |
| `web/src/hooks/useSpeechRecognition.ts` | Web Speech API 麦克风实时识别 |
| `web/src/hooks/useSpeechSynthesis.ts` | 双模式 TTS（浏览器原生 + 服务端回退） |
| `web/src/hooks/useAudioLevel.ts` | AudioContext RMS 实时音量分析 |
| `web/src/voice/WaveformBars.tsx` | 波形条可视化 |
| `web/src/voice/MicPulse.tsx` | 中央麦克风脉冲按钮（双层 ring 动画） |
| `web/src/voice/BilingualCaption.tsx` | 双语字幕卡片 |
| `web/src/voice/voicePresets.ts` | 6 个音色预设 + 6 个翻译语言对 |
| `web/src/design/icons.tsx` | 新增 MicIcon/MicOffIcon/VolumeIcon/AudioWaveIcon/RadioIcon/WandVoiceIcon |
| `web/src/components/SideMenu.tsx` | 新增"语音中心"菜单项（AI 标记） |
| `web/src/App.tsx` | 接入 VoicePage（全宽模式） |

**5 个子模式**
1. **实时语音翻译** — 麦克风→SpeechRecognition→翻译API→双语字幕流；脉冲动画+实时音量+滚动字幕；每 800ms 节流流式翻译中间结果
2. **文本朗读** — 调音台（语速/音调/音量滑块）+ 6 个音色预设卡片 + 浏览器/服务端双引擎切换 + 波形可视化
3. **音频翻译** — 选音频 task → ASR → 翻译（双栏结果）
4. **视频翻译** — 同上，过滤视频扩展名
5. **声音复刻** — 三步向导占位（待 VOLC_VOICE_CLONE_API_KEY）

## 测试
- 后端 `npx vitest run`：**312 pass / 21 files**（含新增 12 speech tests）
- 前端 `npx vitest run`：**203 pass / 19 files**
- `npx tsc --noEmit`：通过

## 设计决策
- **零依赖浏览器原生 ASR/TTS 优先**：保证 UI 流程在任何环境可演示，无网络/凭证要求
- **服务端协议层移植**：保留火山引擎 Bearer; 鉴权、1024 字节硬限、LRU 缓存、白名单等生产细节
- **mock 模式降级**：凭证缺失时生成最小有效 WAV 静音帧，UI 完整可演示
- **顶级交互细节**：
  - 中央麦克风：双层 ring 动画 + 实时音量缩放
  - 波形：32 帧 RMS 历史，中心条更亮 + 阴影
  - 字幕：渐入动画 + 翻译中紫色斜体 + 每条带朗读按钮
  - 调音台：滑块 + 数值实时显示

## 待办（下一阶段）
- [ ] 完整移植 `file_asr.py` 的 submit + 轮询（当前 ASR 真实链路抛 501）
- [ ] 移植 `volcengine_engine.py` 二进制帧编解码 + WSS（实时流式 ASR）
- [ ] 接入 `realtime_voice.py` 端到端对话（OpenAI Realtime API 兼容）
- [ ] 接入 `voice_cloning.py` 声音复刻（VOLC_VOICE_CLONE_API_KEY）
- [ ] 移植 `rate_limiter.py` TokenBucket（per-key 限流）
- [ ] 移植 `text_buffer.py` smart_append（ASR 累积去重）
- [ ] 搬 `jaeger/docker-compose.yml` 升级可观测到 OTel
