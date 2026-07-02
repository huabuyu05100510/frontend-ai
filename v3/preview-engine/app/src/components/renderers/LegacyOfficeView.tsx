import { useEffect, useMemo, useState } from 'react'
import type { SourceHandle } from '../../kernel/SourceHandle'
import { BlobSource } from '../../kernel/SourceHandle'
import { convertLegacy, base64ToBytes, type ConvertResult } from '../../collab/convertClient'
import type { SheetModel } from '../../ooxml/xlsx'
import { extractSheetUnits, translateAll } from '../../translation/translate'
import { OfficeView, SheetBody, type Mode } from './OfficeView'
import { OfficePdfView } from './OfficePdfView'

// 旧版二进制 doc/xls/ppt → 调用本地服务端 /convert → 复用结构化预览
export function LegacyOfficeView({ source, realType }: { source: SourceHandle; realType: string }) {
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hifi, setHifi] = useState(true)

  useEffect(() => {
    let off = false
    setResult(null)
    setErr(null)
    source
      .blob()
      .arrayBuffer()
      .then((buf) => convertLegacy(new Uint8Array(buf), realType))
      .then((r) => !off && setResult(r))
      .catch((e) => !off && setErr(`无法连接本地转换服务（:8787）：${String(e?.message || e)}`))
    return () => {
      off = true
    }
  }, [source, realType])

  if (hifi) return <OfficePdfView source={source} realType={realType} />

  if (err) {
    return (
      <div className="panel" style={{ color: 'var(--red)' }}>
        <div style={{ marginBottom: 6 }}>{err}</div>
        <div className="kv" style={{ marginBottom: 8 }}>
          启动：<code>cd v3/preview-engine/server &amp;&amp; PORT=8787 node server.mjs</code>
        </div>
        <button onClick={() => setHifi(true)} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          切换高保真 PDF 预览
        </button>
      </div>
    )
  }
  if (!result) return <div className="panel">服务端转换中（.{realType} → 结构化）…</div>

  if (!result.ok) {
    return (
      <div className="panel">
        <div className="kv" style={{ fontSize: 14, marginBottom: 8 }}>{result.reason}</div>
        {result.install && (
          <div className="kv">
            安装高保真转换器：<code>{result.install}</code>，安装后 doc/xls/ppt 均可结构化预览与翻译对比。
          </div>
        )}
      </div>
    )
  }

  // 高保真路径：服务端 LibreOffice 转出的 OOXML 字节 → 复用 OfficeView
  if (result.format === 'ooxml' && result.base64 && result.realType) {
    const bytes = base64ToBytes(result.base64)
    const converted = new BlobSource(new Blob([bytes as BlobPart]), source.name)
    return (
      <div>
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
          <span className="kv" style={{ flex: 1 }}>
            已由<strong> LibreOffice </strong>转换为 {result.realType.toUpperCase()}（服务端）
          </span>
          <button
            onClick={() => setHifi(true)}
            style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
            title="LibreOffice 100% 高保真 PDF 渲染"
          >
            高保真 PDF 预览
          </button>
        </div>
        <OfficeView source={converted} realType={result.realType} />
      </div>
    )
  }

  // 内置 BIFF 回退：直接拿到 sheet model
  if (result.format === 'model' && result.kind === 'sheet' && result.model) {
    return <SheetModelPreview model={result.model} via={result.via} />
  }

  return <div className="panel">未知的转换结果。</div>
}

function SheetModelPreview({ model: m, via }: { model: ConvertResult['model'] & object; via?: string }) {
  const [mode, setMode] = useState<Mode>('source')
  const sheet: SheetModel = useMemo(() => {
    const cells = new Map<string, { r: number; c: number; text: string }>()
    for (const c of m!.cells) cells.set(`${c.r},${c.c}`, c)
    return { name: m!.name, rows: m!.rows, cols: m!.cols, cells }
  }, [m])
  const trans = useMemo(() => translateAll(extractSheetUnits(sheet)), [sheet])

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="kv">视图</span>
        {(['source', 'both', 'target'] as Mode[]).map((md) => (
          <button
            key={md}
            onClick={() => setMode(md)}
            style={{ borderColor: mode === md ? 'var(--accent)' : 'var(--border)', color: mode === md ? 'var(--accent)' : undefined }}
          >
            {md === 'source' ? '原文' : md === 'target' ? '译文' : '双栏对比'}
          </button>
        ))}
        <span className="kv" style={{ marginLeft: 'auto' }}>
          .xls 内置 BIFF 解析（{via}）· 无需 LibreOffice
        </span>
      </div>
      <SheetBody sheet={sheet} trans={trans} mode={mode} />
    </div>
  )
}
