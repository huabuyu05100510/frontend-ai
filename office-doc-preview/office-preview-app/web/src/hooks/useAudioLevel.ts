// useAudioLevel — 通过 getUserMedia + AudioContext 实时分析麦克风音量
// 模型：claude-sonnet-4-6
// 返回 [0..1] 的瞬时音量，用于驱动波形/脉冲可视化
//
// 对标：iOS Voice Memo 波形、Otter.ai 录音可视化
import { useCallback, useEffect, useRef, useState } from 'react'

export interface AudioLevelState {
  level: number      // 0..1 瞬时音量
  active: boolean    // 是否正在采集
  levels: number[]   // 滚动 32 帧历史（用于波形）
  error: string | null
  start: () => Promise<void>
  stop: () => void
}

export function useAudioLevel(): AudioLevelState {
  const [level, setLevel] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0))
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameCountRef = useRef(0)

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => {})
    }
    ctxRef.current = null
    setActive(false)
    setLevel(0)
    setLevels(Array(32).fill(0))
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前环境不支持麦克风采集')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctx()
      ctxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      setActive(true)

      const tick = () => {
        analyser.getByteTimeDomainData(data)
        // 计算 RMS
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        const v = Math.min(1, rms * 3)  // 放大可视化
        setLevel(v)
        // 每 3 帧更新一次波形历史（约 50ms）
        frameCountRef.current++
        if (frameCountRef.current % 3 === 0) {
          setLevels(prev => {
            const next = [...prev, v]
            if (next.length > 32) next.shift()
            return next
          })
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e: any) {
      setError(e?.message || '麦克风权限被拒绝')
      setActive(false)
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  return { level, levels, active, error, start, stop }
}
