// useSpeechSynthesis — 浏览器原生 SpeechSynthesis (TTS) + 服务端 /api/speech/tts 回退
// 模型：claude-sonnet-4-6
//
// 双模式：
//   - 'browser' — 零延迟、离线、零成本（默认）；音色质量与系统相关
//   - 'server'  — 调用 /api/speech/tts（火山引擎 SeedTTS），返回 mp3 二进制 → <audio> 播放
//                  适合高质量场景（音色要求、跨设备一致）
//
// 对标：iOS 朗读、Edge Read Aloud、Google Translate 朗读
import { useCallback, useEffect, useRef, useState } from 'react'

export interface SpeakOpts {
  lang?: string
  rate?: number    // 0.5-2.0
  pitch?: number   // 0-2
  volume?: number  // 0-1
  voice?: string   // 浏览器模式：voiceURI；服务端模式：voice_type
  mode?: 'browser' | 'server'
}

export interface SpeechSynthState {
  supported: boolean
  speaking: boolean
  voices: SpeechSynthesisVoice[]
  speak: (text: string, opts?: SpeakOpts) => Promise<void>
  cancel: () => void
}

const LANG_PREFIX: Record<string, string> = {
  'zh-CN': 'zh', 'en': 'en', 'ja': 'ja', 'ko': 'ko', 'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru',
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string, voiceURI?: string) {
  if (voiceURI) {
    const exact = voices.find(v => v.voiceURI === voiceURI)
    if (exact) return exact
  }
  const prefix = LANG_PREFIX[lang] || lang.split('-')[0]
  // 精确匹配 → 前缀匹配 → 默认
  return voices.find(v => v.lang === lang)
    || voices.find(v => v.lang.startsWith(prefix))
    || voices.find(v => v.default)
    || voices[0]
}

export function useSpeechSynthesis(): SpeechSynthState {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [speaking, setSpeaking] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!supported) return
    const load = () => {
      const v = window.speechSynthesis.getVoices()
      if (v.length) setVoices(v)
    }
    load()
    window.speechSynthesis.onvoiceschanged = load
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [supported])

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setSpeaking(false)
  }, [supported])

  const speak = useCallback(async (text: string, opts: SpeakOpts = {}) => {
    if (!text.trim()) return
    cancel()
    const mode = opts.mode || 'browser'
    const lang = opts.lang || 'zh-CN'

    if (mode === 'server') {
      // 调用后端 /api/speech/tts → 拿到 mp3 blob → <audio> 播放
      setSpeaking(true)
      try {
        const r = await fetch('/api/speech/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: opts.voice,
            speed: opts.rate ?? 1.0,
            pitch: opts.pitch ?? 1.0,
            volume: opts.volume ?? 1.0,
            lang,
            format: 'mp3',
          }),
        })
        if (!r.ok) throw new Error(`TTS ${r.status}`)
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.crossOrigin = 'anonymous'
        audioRef.current = audio
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => { resolve(); setSpeaking(false); URL.revokeObjectURL(url) }
          audio.onerror = () => { reject(new Error('audio play failed')); setSpeaking(false); URL.revokeObjectURL(url) }
          audio.play().catch(reject)
        })
      } catch (e) {
        console.warn('[tts/server] failed, fallback to browser:', (e as Error).message)
        setSpeaking(false)
        // 失败回退到浏览器原生
        return speak(text, { ...opts, mode: 'browser' })
      }
      return
    }

    if (!supported) {
      console.warn('[tts/browser] not supported')
      return
    }

    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = lang
    utter.rate = opts.rate ?? 1.0
    utter.pitch = opts.pitch ?? 1.0
    utter.volume = opts.volume ?? 1.0
    const voice = pickVoice(voices, lang, opts.voice)
    if (voice) utter.voice = voice
    utter.onstart = () => setSpeaking(true)
    utter.onend = () => setSpeaking(false)
    utter.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utter)
  }, [supported, voices, cancel])

  return { supported, speaking, voices, speak, cancel }
}
