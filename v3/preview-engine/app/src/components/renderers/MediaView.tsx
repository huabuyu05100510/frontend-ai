import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import type { Peak } from '../../renderers/media/waveform'

const WAVEFORM_MAX_BYTES = 60 * 1024 * 1024 // 超大音频跳过波形（避免 decodeAudioData 爆内存）

export function MediaView({ source, kind }: { source: SourceHandle; kind: 'audio' | 'video' }) {
  const url = useMemo(() => URL.createObjectURL(source.blob()), [source])
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  if (kind === 'video') {
    return (
      <div>
        <div className="kv">原生 &lt;video&gt; 播放 · {(source.size / 1048576).toFixed(1)} MB</div>
        <video src={url} controls style={{ width: '100%', maxHeight: 540, background: '#000', borderRadius: 8 }} />
      </div>
    )
  }
  return <AudioView source={source} url={url} />
}

function AudioView({ source, url }: { source: SourceHandle; url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('解码波形中…')

  useEffect(() => {
    let disposed = false
    // Worker 实例在 effect 内创建，确保每次 source 变化时重新创建并在 cleanup 时终止
    const worker = new Worker(
      new URL('../../renderers/media/waveform.worker.ts', import.meta.url),
      { type: 'module' },
    )

    ;(async () => {
      if (source.size > WAVEFORM_MAX_BYTES) {
        setStatus(`文件 ${(source.size / 1048576).toFixed(0)}MB 过大，跳过波形`)
        worker.terminate()
        return
      }
      try {
        const buf = await source.blob().arrayBuffer()
        const AC: typeof AudioContext = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
        const ctx = new AC()
        const audio = await ctx.decodeAudioData(buf)
        ctx.close()
        if (disposed) return

        const canvas = canvasRef.current!
        const W = canvas.clientWidth || 800
        const H = 120

        // 将降采样计算发给 Worker，主线程只做绘制
        worker.onmessage = (e: MessageEvent<Peak[]>) => {
          if (disposed) return
          const peaks = e.data
          const dpr = Math.min(window.devicePixelRatio || 1, 2)
          canvas.width = W * dpr
          canvas.height = H * dpr
          const g = canvas.getContext('2d')!
          g.setTransform(dpr, 0, 0, dpr, 0, 0)
          g.clearRect(0, 0, W, H)
          g.fillStyle = '#2f81f7'
          const mid = H / 2
          for (let x = 0; x < peaks.length; x++) {
            const [min, max] = peaks[x]
            const y1 = mid - max * mid
            const y2 = mid - min * mid
            g.fillRect(x, y1, 1, Math.max(1, y2 - y1))
          }
          setStatus(`真实波形 · ${audio.duration.toFixed(1)}s · ${audio.sampleRate}Hz · ${audio.numberOfChannels}ch`)
        }
        worker.onerror = () => setStatus('波形 Worker 错误')
        // 将 Float32Array 的副本（而非 transfer）发给 Worker，保留原始数据
        worker.postMessage({ samples: audio.getChannelData(0).slice(), buckets: W })
      } catch (e) {
        setStatus('波形解码失败（编码不支持）：' + String(e))
        worker.terminate()
      }
    })()

    return () => {
      disposed = true
      worker.terminate()
    }
  }, [source])

  return (
    <div>
      <div className="kv">{status}</div>
      <canvas ref={canvasRef} style={{ width: '100%', height: 120, background: '#0b0e13', borderRadius: 8, display: 'block' }} />
      <audio src={url} controls style={{ width: '100%', marginTop: 12 }} />
    </div>
  )
}
