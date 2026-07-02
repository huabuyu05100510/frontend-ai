import { useCallback, useRef, useState } from 'react'
import { BlobSource } from '../kernel/SourceHandle'
import type { SourceHandle } from '../kernel/SourceHandle'
import { convertToPdf, BASE_URL } from '../collab/convertClient'
import { PdfViewer } from './renderers/PdfViewer'

// ============================================================================
// ServerConvertVerify — 服务端转换链路验证
//   Office 文件 → POST /convert-pdf → 服务端 LibreOffice 转 PDF
//   → 返回 PDF URL → pdf.js 从服务端 Range 加载
// ============================================================================

type Phase = 'idle' | 'uploading' | 'converting' | 'ready' | 'error'

export function ServerConvertVerify() {
  const [source, setSource] = useState<SourceHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [info, setInfo] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const downloadNameRef = useRef('')

  const open = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0]
    if (!file) return
    const src = new BlobSource(file)
    setSource(src)
    setPdfUrl(null)
    setErr(null)
    setPhase('uploading')
    setInfo(`文件: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`)

    const t0 = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 200)

    try {
      const buf = await file.arrayBuffer()
      setPhase('converting')
      setInfo(`正在发送到服务端转换…`)
      const result = await convertToPdf(new Uint8Array(buf), file.name.split('.').pop() || 'docx')
      clearInterval(timer)
      if (!result.ok || !result.url) {
        setErr(result.reason ?? '转换失败')
        setPhase('error')
        return
      }
      downloadNameRef.current = file.name.replace(/\.[^.]+$/, '') + '.pdf'
      const url = BASE_URL + result.url
      setPdfUrl(url)
      setInfo(`转换完成 · ${Math.round((Date.now() - t0) / 1000)}s · URL: ${result.url}`)
      setPhase('ready')
    } catch (e: any) {
      clearInterval(timer)
      setErr(`请求失败：${String(e?.message || e)}`)
      setPhase('error')
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files.length) open(e.dataTransfer.files)
  }

  return (
    <div>
      <div
        className="panel"
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={{ borderStyle: 'dashed', borderColor: drag ? 'var(--accent)' : 'var(--border)', textAlign: 'center', padding: 24 }}
      >
        <div style={{ marginBottom: 10 }}>拖入 Office 文件，验证服务端转换 → PDF URL → Range 加载链路</div>
        <button onClick={() => inputRef.current?.click()}>选择 Office 文件</button>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.xlsx,.pptx,.doc,.xls,.ppt"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && open(e.target.files)}
        />
        <div className="kv" style={{ marginTop: 10 }}>
          支持 docx / xlsx / pptx / doc / xls / ppt · 需要服务端 LibreOffice
        </div>
      </div>

      {source && (
        <div className="panel">
          <div className="kv">
            文件 <b>{source.name}</b> · 大小 <b>{(source.size / 1024).toFixed(1)}KB</b>
          </div>
          <div className="kv" style={{ marginTop: 4 }}>
            链路：<b style={{ color: 'var(--accent)' }}>Office 文件</b>
            {' → POST /convert-pdf → '}
            <b style={{ color: 'var(--yellow)' }}>LibreOffice 转换</b>
            {' → '}
            <b style={{ color: 'var(--green)' }}>PDF URL</b>
            {' → pdf.js Range 加载'}
          </div>
          {info && <div className="kv" style={{ marginTop: 4, color: 'var(--green)' }}>{info}</div>}
          {elapsed > 0 && phase === 'converting' && (
            <div className="kv" style={{ marginTop: 4 }}>转换中… {elapsed}s</div>
          )}
        </div>
      )}

      {phase === 'error' && err && (
        <div className="panel" style={{ color: 'var(--red)' }}>
          <div>{err}</div>
          <div className="kv" style={{ marginTop: 6 }}>
            启动服务：<code>cd preview-engine/server &amp;&amp; PORT=8787 node server.mjs</code>
          </div>
        </div>
      )}

      {phase === 'ready' && pdfUrl && (
        <PdfViewer
          pdfUrl={pdfUrl}
          downloadName={downloadNameRef.current}
          label={`服务端转换 · ${source?.name || ''}`}
          showLoadModeToggle
        />
      )}
    </div>
  )
}