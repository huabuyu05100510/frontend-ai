import { useCallback, useRef, useState } from 'react'
import { BlobSource } from '../kernel/SourceHandle'
import type { SourceHandle } from '../kernel/SourceHandle'
import { uploadPdf, BASE_URL } from '../collab/convertClient'
import { PdfViewer } from './renderers/PdfViewer'

// ============================================================================
// PdfVerifyTab — PDF 验证 Tab（上传到服务端 → Range 请求加载）
//   拖入 PDF 文件 → POST /upload-pdf → 服务端保存 → 返回 URL → PdfViewer
//   用于验证服务端 Range 请求链路，无需 Office → PDF 转换。
// ============================================================================

type Phase = 'idle' | 'uploading' | 'ready' | 'error'

export function PdfVerifyTab() {
  const [source, setSource] = useState<SourceHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [info, setInfo] = useState('')
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
    setInfo(`正在上传到服务端… (${(file.size / 1024).toFixed(1)}KB)`)

    try {
      const buf = await file.arrayBuffer()
      const result = await uploadPdf(new Uint8Array(buf))
      if (!result.ok || !result.url) {
        setErr(result.reason ?? '上传失败')
        setPhase('error')
        return
      }
      downloadNameRef.current = file.name
      const url = BASE_URL + result.url
      setPdfUrl(url)
      setInfo(`上传完成 · 服务端 URL: ${result.url}`)
      setPhase('ready')
    } catch (e: any) {
      setErr(`上传失败：${String(e?.message || e)}`)
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
        <div style={{ marginBottom: 10 }}>拖入 PDF 文件，上传到服务端后通过 Range 请求加载验证</div>
        <button onClick={() => inputRef.current?.click()}>选择 PDF 文件</button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && open(e.target.files)}
        />
        <div className="kv" style={{ marginTop: 10 }}>
          链路：PDF 文件 → POST /upload-pdf → 服务端保存 → PDF URL → pdf.js Range 请求加载
        </div>
      </div>

      {source && (
        <div className="panel">
          <div className="kv">
            文件 <b>{source.name}</b> · 大小 <b>{(source.size / 1048576).toFixed(2)} MB</b>
          </div>
          <div className="kv" style={{ marginTop: 4 }}>
            链路：<b style={{ color: 'var(--accent)' }}>PDF 文件</b>
            {' → POST /upload-pdf → '}
            <b style={{ color: 'var(--green)' }}>服务端 URL</b>
            {' → pdf.js Range 请求加载'}
          </div>
          {info && <div className="kv" style={{ marginTop: 4, color: 'var(--green)' }}>{info}</div>}
        </div>
      )}

      {phase === 'uploading' && (
        <div className="panel" style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
          <div className="pdf-skeleton" style={{ width: '60%', height: 16, margin: '0 auto 16px' }} />
          <div className="pdf-skeleton" style={{ width: '80%', height: 12, margin: '0 auto 10px' }} />
          <div className="pdf-skeleton" style={{ width: '70%', height: 12, margin: '0 auto 10px' }} />
          <div className="kv" style={{ marginTop: 16 }}>上传中…</div>
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
          label={`服务端 Range 加载 · ${source?.name || ''}`}
          showLoadModeToggle
        />
      )}
    </div>
  )
}