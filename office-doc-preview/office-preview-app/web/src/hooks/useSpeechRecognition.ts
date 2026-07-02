// useSpeechRecognition — 浏览器原生 Web Speech API 包装
// 模型：claude-sonnet-4-6
// 实时麦克风识别 → 返回最终/中间文本。无浏览器支持时降级到 mock。
//
// 对标：Google Translate Voice Mode、讯飞听见、Otter.ai 实时字幕
import { useCallback, useEffect, useRef, useState } from 'react'

// 浏览器前缀兼容（webkit）
type SR = typeof window extends { SpeechRecognition: infer T } ? T : any
const Ctor: any = (typeof window !== 'undefined')
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null

export interface SpeechRecognitionState {
  supported: boolean
  listening: boolean
  /** 中间结果（实时变化） */
  interim: string
  /** 已 finalize 的累积文本 */
  final: string
  /** 最近一次 finalize 的句子（便于实时翻译） */
  lastFinal: string
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
}

export function useSpeechRecognition(lang = 'zh-CN', continuous = true): SpeechRecognitionState {
  const [supported] = useState<boolean>(!!Ctor)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [final, setFinal] = useState('')
  const [lastFinal, setLastFinal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<any>(null)
  const finalRef = useRef('') // 防止事件回调间 stale

  const stop = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.stop() } catch { /* ignore */ }
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    setError(null)
    if (!Ctor) {
      setError('当前浏览器不支持语音识别（推荐 Chrome/Edge）')
      return
    }
    if (recRef.current) {
      try { recRef.current.abort() } catch { /* ignore */ }
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = continuous
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setListening(true)
      setInterim('')
    }
    rec.onerror = (e: any) => {
      const msg = e?.error || 'unknown'
      // no-speech / aborted 是正常中断，不算错误
      if (msg !== 'no-speech' && msg !== 'aborted') {
        setError(msg)
      }
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
      // 连续模式自动重启（处理浏览器静默断开）
      if (continuous && recRef.current === rec && !error) {
        try { rec.start() } catch { /* ignore */ }
      }
    }
    rec.onresult = (e: any) => {
      let interimText = ''
      let finalChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const txt = r[0]?.transcript || ''
        if (r.isFinal) finalChunk += txt
        else interimText += txt
      }
      if (finalChunk) {
        finalRef.current = (finalRef.current + ' ' + finalChunk).trim()
        setFinal(finalRef.current)
        setLastFinal(finalChunk.trim())
      }
      setInterim(interimText)
    }

    recRef.current = rec
    try {
      rec.start()
    } catch (e: any) {
      setError(e?.message || '启动失败')
    }
  }, [lang, continuous, error])

  const reset = useCallback(() => {
    finalRef.current = ''
    setFinal('')
    setInterim('')
    setLastFinal('')
    setError(null)
  }, [])

  useEffect(() => () => {
    if (recRef.current) {
      try { recRef.current.abort() } catch { /* ignore */ }
      recRef.current = null
    }
  }, [])

  return { supported, listening, interim, final, lastFinal, error, start, stop, reset }
}
