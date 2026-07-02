// 音色预设常量 — 与 voice-portfolio voice_design.py 的 PRESETS 对齐
// 模型：claude-sonnet-4-6
// 移植自：voice-portfolio/vosk-realtime-asr/server/voice_design.py

export interface VoicePreset {
  id: string
  name: string
  desc: string
  voiceType: string       // 火山引擎 voice_type
  gender: 'male' | 'female'
  style: string
  speed: number
  pitch: number
  volume: number
  emoji: string
  gradient: string        // CSS linear-gradient 色
}

/** 内置 6 个预设：对标 voice-portfolio PRESETS */
export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'news-anchor',
    name: '新闻播报',
    desc: '沉稳磁性 · 字正腔圆',
    voiceType: 'BV001_streaming',
    gender: 'male',
    style: 'news',
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    emoji: '📺',
    gradient: 'linear-gradient(135deg, #667eea, #764ba2)',
  },
  {
    id: 'gentle-female',
    name: '温柔女声',
    desc: '亲切自然 · 适合对话',
    voiceType: 'BV002_streaming',
    gender: 'female',
    style: 'assistant',
    speed: 1.0,
    pitch: 1.05,
    volume: 1.0,
    emoji: '🌸',
    gradient: 'linear-gradient(135deg, #f093fb, #f5576c)',
  },
  {
    id: 'magnetic-male',
    name: '磁性男声',
    desc: '低沉富有感染力',
    voiceType: 'BV004_streaming',
    gender: 'male',
    style: 'narrator',
    speed: 0.95,
    pitch: 0.9,
    volume: 1.0,
    emoji: '🎙️',
    gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)',
  },
  {
    id: 'child',
    name: '活力童声',
    desc: '活泼可爱 · 适合故事',
    voiceType: 'BV003_streaming',
    gender: 'female',
    style: 'storyteller',
    speed: 1.1,
    pitch: 1.3,
    volume: 1.0,
    emoji: '🧸',
    gradient: 'linear-gradient(135deg, #ffd89b, #19547b)',
  },
  {
    id: 'youth',
    name: '活力青年',
    desc: '阳光明朗 · 适合广告',
    voiceType: 'BV002_streaming',
    gender: 'female',
    style: 'advertisement',
    speed: 1.1,
    pitch: 1.1,
    volume: 1.1,
    emoji: '⚡',
    gradient: 'linear-gradient(135deg, #fa709a, #fee140)',
  },
  {
    id: 'senior-news',
    name: '成熟男声新闻',
    desc: '权威感 · 适合正式场合',
    voiceType: 'BV001_streaming',
    gender: 'male',
    style: 'news',
    speed: 0.9,
    pitch: 0.85,
    volume: 1.0,
    emoji: '📰',
    gradient: 'linear-gradient(135deg, #30cfd0, #330867)',
  },
]

/** 翻译语言对（与后端 SUPPORTED_TRANSLATE_PAIRS 对齐） */
export const TRANSLATE_PAIRS: { source: string; target: string; label: string; flag: string }[] = [
  { source: 'zh', target: 'en', label: '中 → 英', flag: '🇨🇳→🇬🇧' },
  { source: 'en', target: 'zh', label: '英 → 中', flag: '🇬🇧→🇨🇳' },
  { source: 'zh', target: 'ja', label: '中 → 日', flag: '🇨🇳→🇯🇵' },
  { source: 'zh', target: 'ko', label: '中 → 韩', flag: '🇨🇳→🇰🇷' },
  { source: 'zh', target: 'ru', label: '中 → 俄', flag: '🇨🇳→🇷🇺' },
  { source: 'zh', target: 'fr', label: '中 → 法', flag: '🇨🇳→🇫🇷' },
]
