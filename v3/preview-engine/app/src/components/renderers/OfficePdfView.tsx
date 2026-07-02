import { useEffect, useRef, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { convertToPdf, BASE_URL } from '../../collab/convertClient'
import { PdfViewer } from './PdfViewer'

// ============================================================================
// OfficePdfView — Office 文档高保真预览
//   流程：原始字节 → POST /convert-pdf（LibreOffice）→ PDF URL → PdfViewer
// ============================================================================

type Phase = 'idle' | 'converting' | 'rendering' | 'ready' | 'error'

export function OfficePdfView({ source, realType, onBack }: { source: SourceHandle; realType: string; onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<{ reason: string; install?: string } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const downloadNameRef = useRef('')

  useEffect(() => {
    let off = false
    setPhase('converting')
    setErr(null)
    setPdfUrl(null)

    const t0 = Date.now()
    const timer = setInterval(() => { if (!off) setElapsed(Math.round((Date.now() - t0) / 1000)) }, 1000)

    source.blob().arrayBuffer().then(async (buf) => {
      if (off) return
      const result = await convertToPdf(new Uint8Array(buf), realType)
      if (off) return
      clearInterval(timer)
      if (!result.ok || !result.url) {
        setErr({ reason: result.reason ?? '转换失败', install: result.install })
        setPhase('error')
        return
      }
      downloadNameRef.current = source.name.replace(/\.[^.]+$/, '') + '.pdf'
      if (off) return
      setPdfUrl(BASE_URL + result.url)
      setPhase('ready')
    }).catch((e) => {
      if (off) return
      clearInterval(timer)
      setErr({ reason: `无法连接本地转换服务（:8787）：${String(e?.message || e)}` })
      setPhase('error')
    })

    return () => {
      off = true
      clearInterval(timer)
    }
  }, [source, realType])

  if (phase === 'converting') {
    return (
      <div>
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onBack && <button onClick={onBack} style={{ borderColor: 'var(--border)' }}>← 返回翻译模式</button>}
          <span className="kv">LibreOffice PDF 转换中…{elapsed > 0 ? ` ${elapsed}s` : ''}</span>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 32px', color: 'var(--muted)' }}>
          <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
          <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '70%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '50%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '75%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '40%', height: 12, margin: '0 auto 0' }} />
          <div className="kv" style={{ marginTop: 20 }}>
            正在将 .{realType} 转为 PDF（LibreOffice 渲染），通常需要 3-8 秒
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'error' && err) {
    return (
      <div>
        <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onBack && <button onClick={onBack} style={{ borderColor: 'var(--border)' }}>← 返回翻译模式</button>}
        </div>
        <div className="panel" style={{ color: 'var(--red)' }}>
          <div style={{ marginBottom: 6 }}>{err.reason}</div>
          {err.install && (
            <div className="kv">
              安装高保真转换器：<code>{err.install}</code>，安装后重试即可。
            </div>
          )}
          <div className="kv" style={{ marginTop: 6 }}>
            启动服务：<code>cd preview-engine/server &amp;&amp; PORT=8787 node server.mjs</code>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'ready' && pdfUrl) {
    return (
      <PdfViewer
        pdfUrl={pdfUrl}
        downloadName={downloadNameRef.current}
        onBack={onBack}
        label={`100% 高保真 · LibreOffice 渲染`}
        showLoadModeToggle
      />
    )
  }

  return null
}