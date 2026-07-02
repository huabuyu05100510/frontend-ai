import { useEffect, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { PdfViewer } from './PdfViewer'

// ============================================================================
// PdfVerifyView — 独立 PDF 验证入口（与 Office → PDF 转换逻辑完全解耦）
//   拖入 PDF 文件 → 创建 blob URL → PdfViewer 渲染
//   用于验证 pdf.js 渲染效果，无需 Office 转换服务。
// ============================================================================

type Phase = 'idle' | 'loading' | 'ready' | 'error'

export function PdfVerifyView({ source }: { source: SourceHandle }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let off = false
    setPhase('loading')
    setErr(null)

    try {
      const blob = source.blob()
      if (off) return
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      setPdfUrl(url)
      setPhase('ready')
    } catch (e: any) {
      if (off) return
      setErr(`无法读取 PDF 文件：${String(e?.message || e)}`)
      setPhase('error')
    }

    return () => {
      off = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [source])

  if (phase === 'loading') {
    return (
      <div>
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="kv">PDF 加载中…</span>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 32px', color: 'var(--muted)' }}>
          <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
          <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '70%', height: 12, margin: '0 auto 10px' }} />
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return <div className="panel" style={{ color: 'var(--red)' }}>{err}</div>
  }

  if (phase === 'ready' && pdfUrl) {
    return (
      <PdfViewer
        pdfUrl={pdfUrl}
        downloadName={source.name}
        label={`PDF 验证 · ${source.name}`}
        showLoadModeToggle
      />
    )
  }

  return null
}