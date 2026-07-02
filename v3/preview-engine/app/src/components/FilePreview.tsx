import { useCallback, useEffect, useRef, useState } from 'react'
import { BlobSource } from '../kernel/SourceHandle'
import type { SourceHandle } from '../kernel/SourceHandle'
import { probeFile } from '../kernel/probeFile'
import { route } from '../kernel/CapabilityRouter'
import type { ProbeResult, RouteDecision, DeviceProfile } from '../kernel/types'
import { ImageView } from './renderers/ImageView'
import { MediaView } from './renderers/MediaView'
import { TextView } from './renderers/TextView'
import { PdfEditor } from './renderers/PdfEditor'
import { OfficeView } from './renderers/OfficeView'
import { LegacyOfficeView } from './renderers/LegacyOfficeView'
import { cacheFile, listCachedFiles, clearCache } from '../cache/fileCache'

const OOXML = new Set(['docx', 'xlsx', 'pptx'])
const LEGACY_OFFICE = new Set(['doc', 'xls', 'ppt'])

const AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'amr', 'wma', 's48', 'pcm', 'flac', 'ogg'])
const TEXT_LIKE = new Set(['txt', 'json', 'html', 'md', 'svg', 'csv', 'log', 'xml', 'yaml', 'yml', 'js', 'ts'])

function device(): DeviceProfile {
  const v = document.createElement('video')
  const a = document.createElement('audio')
  return {
    tier: 'high',
    wasmEnabled: true,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    canPlayType: (mime) => {
      const el = mime.startsWith('audio') ? a : v
      return !!el.canPlayType(mime)
    },
  }
}

interface Item {
  id: string
  source: SourceHandle
  probe: ProbeResult
  decision: RouteDecision
  firstVisibleMs: number
}

function renderBody(item: Item) {
  const { probe: p, source } = item
  if (p.category === 'raster') return <ImageView source={source} />
  if (p.category === 'media') {
    return <MediaView source={source} kind={AUDIO.has(p.realType) ? 'audio' : 'video'} />
  }
  if (p.realType === 'pdf') return <PdfEditor source={source} />
  if (OOXML.has(p.realType)) return <OfficeView source={source} realType={p.realType} />
  if (TEXT_LIKE.has(p.realType) || p.realType === 'txt' || p.realType === 'srt') return <TextView source={source} />
  // 老二进制 Office（doc/xls/ppt，CFB）：调用本地服务端 /convert（LibreOffice 或内置 BIFF）
  if (LEGACY_OFFICE.has(p.realType)) return <LegacyOfficeView source={source} realType={p.realType} />
  // 其他未内置解析器的格式：诚实降级
  return (
    <div className="panel">
      <div className="kv" style={{ fontSize: 14, marginBottom: 8 }}>
        该格式渲染器为可插拔的<strong>集成层</strong>，当前版本未内置该格式的解析器。
      </div>
      <div className="kv">
        探测结论：真实类型 <b>{p.realType}</b> · 类别 <b>{p.category}</b> · 路由{' '}
        <span className={`badge ${item.decision.path}`}>{item.decision.path.toUpperCase()}</span>
      </div>
    </div>
  )
}

export function FilePreview() {
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState(0)
  const [drag, setDrag] = useState(false)
  const [cachedCount, setCachedCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // mount 时从 IndexedDB 恢复之前缓存的文件
  useEffect(() => {
    listCachedFiles().then(async (cached) => {
      if (cached.length === 0) return
      setCachedCount(cached.length)
      const dev = device()
      const restored: Item[] = []
      for (const cf of cached) {
        const file = new File([cf.blob], cf.name, { lastModified: cf.lastModified })
        const t0 = performance.now()
        const source = new BlobSource(file)
        const probe = await probeFile(source)
        const decision = route(probe, dev)
        restored.push({
          id: `${cf.name}-${cf.size}-cached-${cf.id}`,
          source,
          probe,
          decision,
          firstVisibleMs: Math.round(performance.now() - t0),
        })
      }
      if (restored.length > 0) {
        setItems(restored)
        setActive(0)
      }
    }).catch(() => {
      // IndexedDB 不可用（隐私模式等）时静默忽略
    })
  }, [])

  const ingest = useCallback(async (files: FileList | File[]) => {
    const dev = device()
    const next: Item[] = []
    for (const f of Array.from(files)) {
      const t0 = performance.now()
      const source = new BlobSource(f)
      const probe = await probeFile(source)
      const decision = route(probe, dev)
      next.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, source, probe, decision, firstVisibleMs: Math.round(performance.now() - t0) })
      // 异步持久化到 IndexedDB（不阻塞 UI）
      cacheFile(f).then(() => {
        setCachedCount((n) => n + 1)
      }).catch(() => {/* 存储失败静默忽略 */})
    }
    setItems((prev) => {
      const merged = [...prev, ...next]
      setActive(prev.length) // 跳到首个新文件
      return merged
    })
  }, [])

  // 仅 dev 自查：?devsample=sample.docx 自动从 /devsamples 拉取并渲染（便于截图核对版面）
  useEffect(() => {
    const name = new URLSearchParams(location.search).get('devsample')
    if (!name) return
    fetch(`/devsamples/${name}`)
      .then((r) => r.blob())
      .then((blob) => ingest([new File([blob], name)]))
      .catch(() => {})
  }, [ingest])

  const handleClearCache = async () => {
    await clearCache()
    setCachedCount(0)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files.length) ingest(e.dataTransfer.files)
  }

  const cur = items[active]

  return (
    <div>
      {cachedCount > 0 && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', marginBottom: 4 }}>
          <span className="kv" style={{ flex: 1 }}>
            已缓存 <b>{cachedCount}</b> 个文件（IndexedDB · 刷新后自动恢复）
          </span>
          <button onClick={handleClearCache} style={{ fontSize: 12, padding: '2px 8px' }}>清除缓存</button>
        </div>
      )}
      <div
        className="panel"
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={{ borderStyle: 'dashed', borderColor: drag ? 'var(--accent)' : 'var(--border)', textAlign: 'center', padding: 24 }}
      >
        <div style={{ marginBottom: 10 }}>把「下载」目录里的文件拖到这里，或</div>
        <button onClick={() => inputRef.current?.click()}>选择文件</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && ingest(e.target.files)}
        />
        <div className="kv" style={{ marginTop: 10 }}>
          支持真实渲染：图片 · 音频+波形 · 视频 · 文本 · PDF(可批注/协同) · Office(docx/xlsx/pptx 结构化+翻译对比)
        </div>
      </div>

      {items.length > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          {items.map((it, i) => (
            <span key={it.id} className="chip" onClick={() => setActive(i)} style={{ borderColor: i === active ? 'var(--accent)' : undefined }}>
              {it.source.name.length > 24 ? it.source.name.slice(0, 22) + '…' : it.source.name}
            </span>
          ))}
        </div>
      )}

      {cur && (
        <>
          <div className="panel">
            <div style={{ fontSize: 15, marginBottom: 6 }}>{cur.source.name}</div>
            <div className="kv">
              大小 <b>{(cur.source.size / 1048576).toFixed(2)} MB</b> · 真实类型 <b>{cur.probe.realType}</b> · 类别{' '}
              <b>{cur.probe.category}</b> · 可信{' '}
              <b style={{ color: cur.probe.trusted ? 'var(--green)' : 'var(--red)' }}>{String(cur.probe.trusted)}</b>
            </div>
            <div className="kv">
              渲染路径 <span className={`badge ${cur.decision.path}`}>{cur.decision.path.toUpperCase()}</span> —{' '}
              {cur.decision.reason} · 探测+路由耗时 <b>{cur.firstVisibleMs}ms</b>
            </div>
            {cur.probe.category === 'unknown' && (
              <div className="kv" style={{ color: 'var(--red)' }}>⚠ 伪造类型已拦截（魔数 ≠ 扩展名）</div>
            )}
          </div>
          {renderBody(cur)}
        </>
      )}
    </div>
  )
}
