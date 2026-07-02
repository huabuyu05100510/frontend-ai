import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { fitScale, clampScale } from '../../renderers/image/fit'
import { layoutOcrBoxes, ocrText, type OcrWord } from '../../renderers/ocr/layout'
import { recognizeImage } from '../../renderers/ocr/tesseract'
import { mockTranslate } from '../../translation/translate'

type OcrState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: number }
  | { phase: 'done'; words: OcrWord[] }
  | { phase: 'error'; message: string }

// 真实图片渲染：createImageBitmap 解码 → Canvas 绘制 + 滚轮缩放 + OCR 文本层
export function ImageView({ source }: { source: SourceHandle }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const [scale, setScale] = useState(1)
  const [nat, setNat] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [ocr, setOcr] = useState<OcrState>({ phase: 'idle' })
  const [showTrans, setShowTrans] = useState(false)

  useEffect(() => {
    let disposed = false
    setOcr({ phase: 'idle' })
    setShowTrans(false)
    ;(async () => {
      try {
        const bmp = await createImageBitmap(source.blob())
        if (disposed) {
          bmp.close()
          return
        }
        bitmapRef.current = bmp
        setNat({ w: bmp.width, h: bmp.height })
        const vp = wrapRef.current!.getBoundingClientRect()
        const s = fitScale({ width: bmp.width, height: bmp.height }, { width: vp.width - 24, height: 520 })
        setScale(s)
        setInfo(`${bmp.width}×${bmp.height}px`)
      } catch (e) {
        setErr('图片解码失败：' + String(e))
      }
    })()
    return () => {
      disposed = true
      bitmapRef.current?.close()
      bitmapRef.current = null
    }
  }, [source])

  useEffect(() => {
    const bmp = bitmapRef.current
    const canvas = canvasRef.current
    if (!bmp || !canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = bmp.width * scale
    const h = bmp.height * scale
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
  }, [scale, info])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => clampScale(s * (e.deltaY < 0 ? 1.1 : 0.9), 0.05, 8))
  }

  const runOcr = async () => {
    setOcr({ phase: 'running', progress: 0 })
    try {
      const words = await recognizeImage(source.blob(), 'chi_sim+eng', (p) => setOcr({ phase: 'running', progress: p }))
      setOcr({ phase: 'done', words })
    } catch (e) {
      setOcr({ phase: 'error', message: String((e as Error)?.message || e) })
    }
  }

  const words = ocr.phase === 'done' ? ocr.words : []
  const boxes = useMemo(
    () => layoutOcrBoxes(words, nat, { w: nat.w * scale, h: nat.h * scale }),
    [words, nat, scale],
  )

  const copyAll = () => {
    const text = showTrans ? words.map((w) => mockTranslate(w.text)).join(' ') : ocrText(words)
    navigator.clipboard?.writeText(text)
  }

  if (err) return <div className="panel" style={{ color: 'var(--red)' }}>{err}</div>
  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="kv">{info} · 缩放 <b>{Math.round(scale * 100)}%</b>（滚轮缩放）</span>
        <span style={{ marginLeft: 'auto' }} />
        {ocr.phase === 'idle' && <button onClick={runOcr}>识别文字 (OCR)</button>}
        {ocr.phase === 'running' && <span className="kv">识别中… {Math.round(ocr.progress * 100)}%</span>}
        {ocr.phase === 'error' && (
          <span className="kv" style={{ color: 'var(--red)' }}>OCR 失败：{ocr.message}（需联网加载引擎）</span>
        )}
        {ocr.phase === 'done' && (
          <>
            <span className="kv">已识别 {words.length} 词</span>
            <button onClick={() => setShowTrans((v) => !v)} style={{ borderColor: showTrans ? 'var(--accent)' : undefined }}>
              {showTrans ? '显示原文' : '显示译文'}
            </button>
            <button onClick={copyAll}>复制全部</button>
          </>
        )}
      </div>
      <div
        ref={wrapRef}
        onWheel={onWheel}
        style={{ height: 540, overflow: 'auto', background: '#0b0e13', borderRadius: 8, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 12 }}
      >
        <div style={{ position: 'relative', width: nat.w * scale, height: nat.h * scale }}>
          <canvas ref={canvasRef} style={{ borderRadius: 4, display: 'block' }} />
          {boxes.map((b, i) => {
            const text = showTrans ? mockTranslate(b.text) : b.text
            return (
              <div
                key={i}
                title={text}
                style={{
                  position: 'absolute',
                  left: b.left,
                  top: b.top,
                  width: b.width,
                  height: b.height,
                  fontSize: Math.max(8, b.height * 0.8),
                  lineHeight: `${b.height}px`,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  cursor: 'text',
                  color: showTrans ? '#111' : 'transparent',
                  background: showTrans ? 'rgba(255,255,255,0.9)' : 'transparent',
                  borderRadius: 2,
                }}
              >
                {text}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
