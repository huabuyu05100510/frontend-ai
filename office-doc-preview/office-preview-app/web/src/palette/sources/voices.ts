// 模型：claude-sonnet-4-6
// Voices source — palette items for voice sub-actions (TTS preset, ASR upload hint)

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerPaletteItems, paletteRegistry, type PaletteItem } from '../registry'
import { ROUTES } from '../../routes'

interface VoiceItem {
  id: string
  title: string
  subtitle: string
  action: () => void
  keywords: string[]
}

function buildVoices(navigate: (path: string) => void): VoiceItem[] {
  return [
    {
      id: 'voice-open-center',
      title: '打开语音中心',
      subtitle: 'TTS / ASR / 文件翻译',
      action: () => navigate(ROUTES.voice),
      keywords: ['voice', 'speech', '语音', 'tts', 'asr'],
    },
    {
      id: 'voice-tts-default',
      title: '朗读当前文本',
      subtitle: '使用默认音色合成当前选中文本',
      action: () => {
        const text = typeof window !== 'undefined' ? (window.getSelection?.()?.toString() || '') : ''
        if (!text) {
          console.info('[palette:voices] no selection; navigate to voice center instead')
          navigate(ROUTES.voice)
          return
        }
        // 触发自定义事件让 VoicePage 监听并合成
        const ts = new Date().toISOString()
        console.info(`[palette:voices ${ts}] request TTS for ${text.length} chars`)
        window.dispatchEvent(new CustomEvent('palette:tts-request', { detail: { text } }))
        navigate(ROUTES.voice)
      },
      keywords: ['tts', 'speak', '朗读', '朗读', 'speech'],
    },
    {
      id: 'voice-upload-hint',
      title: '上传音频文件',
      subtitle: '跳到上传中心后再选音频',
      action: () => {
        const ts = new Date().toISOString()
        console.info(`[palette:voices ${ts}] navigate to upload for audio`)
        navigate(ROUTES.upload)
      },
      keywords: ['upload', 'audio', '上传', '音频'],
    },
    {
      id: 'voice-translate-file',
      title: '音频文件翻译',
      subtitle: 'ASR → 翻译 → TTS',
      action: () => {
        const ts = new Date().toISOString()
        console.info(`[palette:voices ${ts}] navigate to voice for file translate`)
        navigate(ROUTES.voice)
      },
      keywords: ['translate', 'audio', '翻译', '音频', 'asr', 'tts'],
    },
  ]
}

/** Imperative registration */
export function registerVoicesItems(navigate: (path: string) => void): PaletteItem[] {
  const items: PaletteItem[] = buildVoices(navigate).map(v => ({
    id: v.id,
    title: v.title,
    subtitle: v.subtitle,
    group: '语音',
    keywords: v.keywords,
    action: v.action,
  }))
  registerPaletteItems(items)
  return items
}

/** Hook variant */
export function useRegisterVoicesItems(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const items = registerVoicesItems(navigate)
    return () => {
      for (const item of items) paletteRegistry.unregister(item.id)
    }
  }, [navigate])
}