// 颜色迁移至 semantic.ts (Phase 2.A)
// OCRPage — 讯飞 OCR 三模式（对标讯飞设计稿）
// 模型：claude-sonnet-4-6
// 布局：使用 xf-workspace（左侧子菜单 + 内容区），统一 QualityCheckPage 风格
// 还原对象:
//   - 讯飞设计稿/图片识别及标注.png  → 图片识别模式
//   - 讯飞设计稿/OCR训练模板编辑.png → 模板编辑模式
//   - 讯飞设计稿/OCR训练模板管理.png → 模板管理模式
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ImageRegionSvgOverlay } from '../components/ImageRegionSvgOverlay'
import { ScanIcon } from '../design/icons'
import { useStore } from '../store'
import type { Task } from '../types'

type OcrMode = 'recognize' | 'template-edit' | 'template-manage'

interface OCRRegion { text: string; x: number; y: number; width: number; height: number; confidence: number }
interface OCRResult { text: string; regions: OCRRegion[]; engine: string; ms: number; imageSize?: { width: number; height: number } }

interface TemplateItem {
  id: string
  name: string
  scenario: 'finance' | 'medical' | 'general' | 'id-card'
  sign?: string
  referenceFields?: any[]
  fields: any[]
  sampleImageUrl?: string
  createdAt: number
  updatedAt: number
}

const SUBMENU: { key: OcrMode; label: string }[] = [
  { key: 'recognize', label: '图片识别' },
  { key: 'template-edit', label: '模板编辑' },
  { key: 'template-manage', label: '模板管理' },
]

const SCENARIO_LABELS: Record<string, string> = {
  finance: '财务票据',
  medical: '医疗票据',
  general: '通用表单',
  'id-card': '证照识别',
}

const SAMPLE_IMAGES: Record<string, string> = {
  finance: '/api/sample/宁波市.png',
  medical: '/api/sample/宁波市.png',
  general: '/api/sample/宁波市.png',
  'id-card': '/api/sample/宁波市.png',
}

export function OCRPage() {
  const [mode, setMode] = useState<OcrMode>('recognize')
  const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
  const { tasks } = useStore()
  const imageTasks = tasks.filter(t => ['png', 'jpg', 'jpeg', 'bmp', 'webp'].includes(t.ext))

  const switchMode = useCallback((m: OcrMode, tpl?: TemplateItem | null) => {
    setEditingTemplate(tpl ?? null)
    setMode(m)
  }, [])

  return (
    <div className="xf-workspace">
      <div className="xf-submenu">
        {SUBMENU.map(s => (
          <button
            key={s.key}
            className={`xf-submenu-item${mode === s.key ? ' active' : ''}`}
            onClick={() => switchMode(s.key)}
          >{s.label}</button>
        ))}
      </div>

      <div className="xf-content">
        {mode === 'recognize' && <RecognizeMode imageTasks={imageTasks} />}
        {mode === 'template-edit' && <TemplateEditMode editingTemplate={editingTemplate} onSaved={() => switchMode('template-manage')} />}
        {mode === 'template-manage' && <TemplateManageMode onSwitchMode={switchMode} />}
      </div>
    </div>
  )
}

/* ============ 图片识别模式 ============ */
function RecognizeMode({ imageTasks }: { imageTasks: Task[] }) {
  const fetchTasks = useStore(s => s.fetchTasks)
  const [images, setImages] = useState<{ url: string; name: string; taskId?: string }[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportedName, setExportedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [zoom, setZoom] = useState(100)
  const [rotate, setRotate] = useState(0)
  const [showJson, setShowJson] = useState(true)
  const [showText, setShowText] = useState(true)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewImgRef = useRef<HTMLImageElement>(null)
  const [imgDisplayW, setImgDisplayW] = useState(0)

  // 加载已上传图片
  useEffect(() => {
    if (images.length === 0 && imageTasks.length > 0) {
      setImages(imageTasks.slice(0, 6).map(t => ({ url: t.originalUrl, name: t.name, taskId: t.id })))
    }
  }, [imageTasks])

  // 上传图片
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    const fd = new FormData()
    fd.append('file', f, f.name)
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!r.ok) throw new Error('upload failed')
      const data = await r.json()
      const task = data.task
      setImages(prev => [...prev, { url: task.originalUrl, name: task.name, taskId: task.id }])
      setActiveIdx(images.length)
    } catch (e: any) {
      setError(e.message)
    }
  }, [images.length])

  // URL 调用
  const handleUrlInvoke = useCallback(async () => {
    if (!urlInput.trim()) return
    setError('URL 调用需要先上传本地文件，请使用上传按钮')
  }, [urlInput])

  // OCR 识别当前图片
  const doOCR = useCallback(async () => {
    const img = images[activeIdx]
    if (!img) return
    if (!img.taskId) {
      setError('该图片尚未上传到服务器，请使用上传按钮')
      return
    }
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/ocr/recognize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ taskId: img.taskId }),
      })
      if (!r.ok) throw new Error(`OCR ${r.status}`)
      setOcrResult(await r.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [images, activeIdx])

  // OCR → 可搜索 PDF 新文件（POST /api/ocr/create-task）
  const handleExportPdf = useCallback(async () => {
    const img = images[activeIdx]
    if (!img?.taskId || exporting) return
    setExporting(true); setError(null)
    try {
      const r = await fetch('/api/ocr/create-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ taskId: img.taskId }),
      })
      if (!r.ok) throw new Error(`create-task ${r.status}`)
      const data = await r.json()
      setExportedName(data.name || (img.name.replace(/\.[^.]+$/, '') + '-searchable.pdf'))
      // 刷新全局任务列表，新 PDF 出现在 FilesPage / 任务列表
      await fetchTasks?.()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }, [images, activeIdx, exporting, fetchTasks])

  // 删除图片
  const removeImage = useCallback((idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
    setActiveIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev))
  }, [])

  // 跟踪图片显示尺寸
  useEffect(() => {
    const img = previewImgRef.current
    if (!img) return
    const h = () => setImgDisplayW(img.clientWidth)
    img.addEventListener('load', h)
    if (img.complete) h()
    return () => img.removeEventListener('load', h)
  }, [activeIdx])

  // 缩放比例
  const scale = (x: number) => imgDisplayW > 0 && ocrResult?.imageSize?.width
    ? x / ocrResult.imageSize.width * imgDisplayW * (zoom / 100)
    : x * (zoom / 100)

  // Phase C：refactored — 使用 ImageRegionSvgOverlay 组件 (testIdPrefix='ocr-region-')
  // 仍然保留 tooltip / hover 业务逻辑
  const scaledRegions = useMemo(() => {
    if (!ocrResult?.regions) return []
    return ocrResult.regions.map(r => ({
      text: r.text,
      confidence: r.confidence,
      x: scale(r.x),
      y: scale(r.y),
      width: scale(r.width),
      height: scale(r.height),
    }))
  }, [ocrResult?.regions, imgDisplayW, zoom])

  // 构造 JSON 结果
  const jsonResult = ocrResult ? JSON.stringify({
    engine: ocrResult.engine,
    ms: ocrResult.ms,
    text: ocrResult.text,
    regions: ocrResult.regions.length,
  }, null, 2) : '// 识别后查看 JSON 输出'

  return (
    <>
      {/* 工具按钮条 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'var(--xf-bg-subtle)',
      }}>
        <button
          className="xf-btn-solid"
          onClick={doOCR}
          disabled={!images[activeIdx]?.taskId || loading}
          style={{ minWidth: 100 }}
        >
          {loading ? <><span className="xf-loading" /> 识别中…</> : <><ScanIcon size={14} /> 开始识别</>}
        </button>
        {ocrResult && (
          <span style={{ fontSize: 13, color: 'var(--xf-text-secondary)' }}>
            识别完成 · {ocrResult.engine} · {ocrResult.ms}ms · {ocrResult.regions.length} 区域
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="xf-mini-btn"
          onClick={() => navigator.clipboard.writeText(ocrResult?.text || '')}
          disabled={!ocrResult?.text}
        >
          复制文本
        </button>
        <button
          data-testid="ocr-export-pdf"
          className="xf-mini-btn xf-mini-btn-primary"
          onClick={handleExportPdf}
          disabled={!ocrResult || exporting}
          title="把当前图片 + OCR 识别文字层打包为可搜索 PDF，并保存为新文件"
          style={{ background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }}
        >
          {exporting ? '导出中…' : '📄 导出可搜索 PDF'}
        </button>
      </div>

      {exportedName && (
        <div
          data-testid="ocr-export-toast"
          style={{
            padding: '8px 24px',
            background: 'var(--color-success-bg)',
            borderBottom: '1px solid var(--color-success-bg)',
            color: 'var(--green-7)',
            fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          ✅ 已生成可搜索 PDF：<strong>{exportedName}</strong>
          <span style={{ color: 'var(--xf-text-tertiary)' }}>· 已在文件列表出现</span>
          <button
            className="xf-mini-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => setExportedName(null)}
          >关闭</button>
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg)',
          borderBottom: '1px solid var(--xf-danger-border)',
          color: 'var(--xf-danger)', fontSize: 13,
        }}>
          请求失败：{error}
        </div>
      )}

      {/* 主体布局 */}
      <div className="xf-ocr-layout">
        {/* 左侧: 缩略图列 */}
        <div className="xf-ocr-thumbs">
          {images.length === 0 ? (
            <div className="xf-empty">
              <div className="xf-empty-icon">📷</div>
              <div className="xf-empty-title">暂无图片</div>
              <div className="xf-empty-desc">下方上传按钮</div>
            </div>
          ) : images.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <div
                className={`xf-ocr-thumb${i === activeIdx ? ' active' : ''}`}
                onClick={() => setActiveIdx(i)}
              >
                <img src={img.url} alt={img.name} />
              </div>
              <button
                onClick={e => { e.stopPropagation(); removeImage(i) }}
                style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: '#fff', border: '1px solid var(--xf-border)',
                  color: 'var(--xf-text-tertiary)', fontSize: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', padding: 0,
                  opacity: 0,
                  transition: 'opacity 0.18s',
                }}
                className="xf-thumb-remove"
              >×</button>
            </div>
          ))}
        </div>

        {/* 中间: 大图预览 + 工具 */}
        <div className="xf-ocr-preview">
          <div style={{
            transform: `scale(${zoom / 100}) rotate(${rotate}deg)`,
            transformOrigin: 'center',
            transition: 'transform 0.2s',
            position: 'relative',
          }}>
            {images[activeIdx] ? (
              <>
                <img
                  ref={previewImgRef}
                  src={images[activeIdx].url}
                  alt={images[activeIdx].name}
                  style={{ maxWidth: '70vw', maxHeight: '70vh', display: 'block' }}
                />
                {ocrResult?.regions && ocrResult.regions.length > 0 && ocrResult.imageSize && (
                  <div
                    data-testid="ocr-region-svg-wrap"
                    style={{
                      position: 'absolute', left: 0, top: 0,
                      width: '100%', height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    <ImageRegionSvgOverlay
                      regions={scaledRegions}
                      imageSize={{
                        width: imgDisplayW,
                        height: imgDisplayW / ocrResult.imageSize.width * ocrResult.imageSize.height,
                      }}
                      hoveredIdx={hoveredIdx}
                      selectedIdx={null}
                      onHover={(i) => {
                        setHoveredIdx(i)
                        if (i == null) { setTooltipPos(null); return }
                        const r = scaledRegions[i]
                        if (r) setTooltipPos({ x: r.x, y: r.y })
                      }}
                      onClick={() => { /* no-op (Phase 4+ 选中区域编辑) */ }}
                      scanLine={false}
                      testIdPrefix="ocr-region-"
                      svgTestId="ocr-region-svg"
                    />
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--xf-text-tertiary)', fontSize: 13 }}>
                上传图片开始识别
              </div>
            )}
          </div>

          {/* 浮动 Tooltip：hover 区域时显示文字 + 置信度 */}
          {hoveredIdx !== null && tooltipPos && ocrResult?.regions?.[hoveredIdx] && (
            <div
              data-testid="ocr-region-tooltip"
              style={{
                position: 'absolute',
                left: `${(tooltipPos.x / imgDisplayW) * 100}%`,
                top: `${(tooltipPos.y / (imgDisplayW / ocrResult.imageSize!.width * ocrResult.imageSize!.height)) * 100}%`,
                transform: 'translate(-50%, calc(-100% - 8px))',
                background: 'rgba(0,0,0,0.85)',
                color: '#fff',
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: 12,
                lineHeight: 1.5,
                pointerEvents: 'none',
                zIndex: 100,
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                maxWidth: 320,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                📍 区域 #{hoveredIdx + 1}
              </div>
              <div style={{ opacity: 0.9 }}>
                “{ocrResult.regions[hoveredIdx].text || '(空)'}”
              </div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2, display: 'flex', gap: 8 }}>
                <span>置信度 {((ocrResult.regions[hoveredIdx].confidence || 0) * 100).toFixed(0)}%</span>
                <span>x={ocrResult.regions[hoveredIdx].x | 0} y={ocrResult.regions[hoveredIdx].y | 0}</span>
              </div>
            </div>
          )}

          {/* 缩放工具栏 */}
          <div className="xf-ocr-preview-toolbar">
            <button title="放大" onClick={() => setZoom(z => Math.min(z + 25, 200))}>+</button>
            <button title="缩小" onClick={() => setZoom(z => Math.max(z - 25, 25))}>−</button>
            <button title="1:1" onClick={() => setZoom(100)}>1:1</button>
            <button title="旋转 90°" onClick={() => setRotate(r => (r + 90) % 360)}>↻90</button>
            <button title="旋转 -90°" onClick={() => setRotate(r => (r + 270) % 360)}>↺90</button>
          </div>
        </div>

        {/* 右侧: 结果面板 */}
        <div className="xf-ocr-result-panel">
          <div className={`xf-result-section${showJson ? '' : ' collapsed'}`}>
            <div className="xf-result-section-header" onClick={() => setShowJson(!showJson)}>
              <span className="xf-result-section-title">JSON结果</span>
              <span className="xf-result-section-toggle">▼</span>
            </div>
            <div className="xf-result-section-body">
              <div className="xf-result-json">{jsonResult}</div>
            </div>
          </div>

          <div className={`xf-result-section${showText ? '' : ' collapsed'}`}>
            <div className="xf-result-section-header" onClick={() => setShowText(!showText)}>
              <span className="xf-result-section-title">识别结果</span>
              <span className="xf-result-section-toggle">▼</span>
            </div>
            <div className="xf-result-section-body">
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <span className="xf-loading" /> 识别中…
                </div>
              ) : ocrResult ? (
                <>
                  <div style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: 'var(--xf-text)' }}>
                    {ocrResult.text || '(无文字)'}
                  </div>
                  {ocrResult.regions && ocrResult.regions.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--xf-border-light)', paddingTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', marginBottom: 8 }}>
                        结构化字段 ({ocrResult.regions.length})
                      </div>
                      <div className="xf-result-fields">
                        {ocrResult.regions.slice(0, 12).map((reg, i) => {
                          const c = reg.confidence || 0.9
                          const confColor = c >= 0.8 ? 'var(--color-success)' : c >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)'
                          const isHovered = hoveredIdx === i
                          return (
                            <div
                              key={i}
                              data-testid={`ocr-region-card-${i}`}
                              onMouseEnter={() => setHoveredIdx(i)}
                              onMouseLeave={() => setHoveredIdx(null)}
                              style={{
                                background: isHovered ? 'var(--color-primary-bg)' : undefined,
                                borderColor: isHovered ? 'var(--color-primary)' : undefined,
                                cursor: 'pointer', transition: 'all 120ms',
                              }}
                            >
                              <div className="xf-result-field-name">
                                区域 {String(i + 1).padStart(2, '0')}
                                <span style={{
                                  marginLeft: 6, fontSize: 10, color: confColor,
                                  fontFamily: 'monospace',
                                }}>{(c * 100).toFixed(0)}%</span>
                              </div>
                              <div className="xf-result-field-value">
                                {reg.text.slice(0, 40)}{reg.text.length > 40 ? '…' : ''}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="xf-empty" style={{ padding: 24 }}>暂无识别结果</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部: 上传 */}
      <div className="xf-ocr-footer">
        <div className="xf-ocr-quota">
          今日可用：<strong>{Math.max(0, 100 - images.length)}</strong>次
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/bmp"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <button className="xf-btn-upload" onClick={() => fileInputRef.current?.click()}>
          上传本地文件
        </button>
        <span style={{ color: 'var(--xf-text-tertiary)', fontSize: 13 }}>或</span>
        <input
          className="xf-input-url"
          placeholder="输入在线文件URL，回车/Enter发起调用"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUrlInvoke()}
        />
        <div className="xf-formats">
          支持 jpg, png, bmp, pdf, tiff, 单帧gif等格式 · 文件大小不超过 10M
        </div>
      </div>
    </>
  )
}

/* ============ 模板编辑模式（2 步可视化框选 + 后端持久化） ============ */
interface EditField {
  id: number
  name: string
  type: 'string' | 'number' | 'date' | 'text'
  x: number
  y: number
  w: number
  h: number
}

interface EditReferenceField {
  id: number
  name: string        // 显示名（仅前端）
  text: string        // 实际文字（OCR 模糊匹配用）
  x: number
  y: number
  w: number
  h: number
}

type EditStep = 'refs' | 'fields'

function TemplateEditMode({ editingTemplate, onSaved }: { editingTemplate?: TemplateItem | null; onSaved?: () => void }) {
  const [scenario, setScenario] = useState<'finance' | 'medical' | 'general' | 'id-card'>(editingTemplate?.scenario || 'finance')
  const [tplName, setTplName] = useState(editingTemplate?.name || '')
  const [sign, setSign] = useState(editingTemplate?.sign || '')
  const [step, setStep] = useState<EditStep>('refs')
  const [referenceFields, setReferenceFields] = useState<EditReferenceField[]>(
    editingTemplate?.referenceFields?.map((r: any) => ({
      id: Date.now() + Math.random(),
      name: r.name, text: r.text,
      x: r.x, y: r.y, w: r.w, h: r.h,
    })) || []
  )
  const [fields, setFields] = useState<EditField[]>(
    editingTemplate?.fields?.map((f: any) => ({
      id: Date.now() + Math.random(),
      name: f.name, type: f.type || 'string',
      x: f.x, y: f.y, w: f.w, h: f.h,
    })) || []
  )
  const [activeField, setActiveField] = useState<number | null>(null)
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 })
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number }>({ w: 800, h: 600 })

  // 跟踪图片显示尺寸
  useEffect(() => {
    const img = imageRef.current
    if (!img) return
    const onLoad = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      setDisplaySize({ w: img.clientWidth, h: img.clientHeight })
    }
    img.addEventListener('load', onLoad)
    if (img.complete) onLoad()
    return () => img.removeEventListener('load', onLoad)
  }, [])

  const removeField = (id: number) => {
    setFields(prev => prev.filter(f => f.id !== id))
    if (activeField === id) setActiveField(null)
  }

  const removeReferenceField = (id: number) => {
    setReferenceFields(prev => prev.filter(f => f.id !== id))
  }

  // 鼠标拖拽：在画布内创建新字段框（按当前步骤区分参照字段/识别字段）
  const onMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrawing({ startX: x, startY: y, curX: x, curY: y })
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setDrawing({ ...drawing, curX: e.clientX - rect.left, curY: e.clientY - rect.top })
  }
  const onMouseUp = () => {
    if (!drawing) return
    const x = Math.min(drawing.startX, drawing.curX)
    const y = Math.min(drawing.startY, drawing.curY)
    const w = Math.abs(drawing.curX - drawing.startX)
    const h = Math.abs(drawing.curY - drawing.startY)
    setDrawing(null)
    if (w < 8 || h < 8) return  // 太小忽略
    // 转换到原图坐标系
    const scaleX = naturalSize.w / displaySize.w
    const scaleY = naturalSize.h / displaySize.h
    const ix = Math.round(x * scaleX), iy = Math.round(y * scaleY)
    const iw = Math.round(w * scaleX), ih = Math.round(h * scaleY)
    if (step === 'refs') {
      const refCount = referenceFields.length
      const newRef: EditReferenceField = {
        id: Date.now() + Math.random(),
        name: `锚点${refCount + 1}`,
        text: '',
        x: ix, y: iy, w: iw, h: ih,
      }
      setReferenceFields(prev => [...prev, newRef])
    } else {
      const newField: EditField = {
        id: Date.now() + Math.random(),
        name: `字段${fields.length + 1}`,
        type: 'string',
        x: ix, y: iy, w: iw, h: ih,
      }
      setFields(prev => [...prev, newField])
      setActiveField(newField.id)
    }
  }

  const updateField = (id: number, patch: Partial<EditField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  const updateReferenceField = (id: number, patch: Partial<EditReferenceField>) => {
    setReferenceFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
  }

  // 保存到后端
  const save = useCallback(async () => {
    if (!tplName.trim()) { setSavedMsg('模板名称必填'); return }
    if (fields.length === 0) { setSavedMsg('至少需要 1 个识别字段'); return }
    for (const r of referenceFields) {
      if (!r.text.trim()) { setSavedMsg(`参照字段"${r.name}"缺实际文字`); return }
    }
    setSaving(true); setSavedMsg(null)
    try {
      const r = await fetch('/api/ocr/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tplName.trim(),
          scenario,
          sign: sign.trim() || undefined,
          referenceFields: referenceFields.map(f => ({ name: f.name, text: f.text, x: f.x, y: f.y, w: f.w, h: f.h })),
          fields: fields.map(f => ({ name: f.name, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h })),
          sampleImageUrl: SAMPLE_IMAGES[scenario],
        }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const d = await r.json()
      setSavedMsg(`✓ 已保存（id: ${d.id}，锚点 ${d.template.referenceFields?.length || 0}，字段 ${d.template.fields.length}）`)
      onSaved?.()
    } catch (e: any) {
      setSavedMsg('保存失败：' + e.message)
    } finally {
      setSaving(false)
    }
  }, [tplName, scenario, sign, referenceFields, fields])

  // 框选区在显示坐标系
  const displayFields = fields.map(f => ({
    ...f,
    dx: f.x * (displaySize.w / naturalSize.w),
    dy: f.y * (displaySize.h / naturalSize.h),
    dw: f.w * (displaySize.w / naturalSize.w),
    dh: f.h * (displaySize.h / naturalSize.h),
  }))
  const displayRefs = referenceFields.map(f => ({
    ...f,
    dx: f.x * (displaySize.w / naturalSize.w),
    dy: f.y * (displaySize.h / naturalSize.h),
    dw: f.w * (displaySize.w / naturalSize.w),
    dh: f.h * (displaySize.h / naturalSize.h),
  }))
  const drawBox = drawing ? {
    left: Math.min(drawing.startX, drawing.curX),
    top: Math.min(drawing.startY, drawing.curY),
    width: Math.abs(drawing.curX - drawing.startX),
    height: Math.abs(drawing.curY - drawing.startY),
  } : null

  // 当前步骤对应的描边色 + label
  const drawColor = step === 'refs' ? 'var(--orange-6)' : 'var(--color-primary)'  // refs 橙色，fields 蓝色

  return (
    <>
      <div className="xf-template-bar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            data-testid="ocr-scenario-select"
            className="xf-select"
            value={scenario}
            onChange={e => setScenario(e.target.value as any)}
            style={{ minWidth: 130 }}
          >
            <option value="finance">财务票据</option>
            <option value="medical">医疗票据</option>
            <option value="general">通用表单</option>
            <option value="id-card">证照识别</option>
          </select>
          <input
            placeholder="模板名称（如：增值税专用发票）"
            value={tplName}
            onChange={e => setTplName(e.target.value)}
            style={{ minWidth: 200, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}
          />
          <input
            placeholder="百度 templateSign（可选，留空=本地坐标模板）"
            value={sign}
            onChange={e => setSign(e.target.value)}
            style={{ minWidth: 280, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>
        <div className="xf-template-actions">
          <button className="xf-btn-solid" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保 存'}
          </button>
          {savedMsg && <span style={{ fontSize: 12, color: savedMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)' }}>{savedMsg}</span>}
        </div>
      </div>

      <div className="xf-template-layout">
        {/* 左侧: 垂直工具栏 */}
        <div className="xf-vtoolbar">
          <button className="xf-vtool active" title="框选模式（在图片上拖拽创建字段）">▭</button>
        </div>

        {/* 中部: 模板预览（鼠标拖拽画框） */}
        <div className="xf-template-canvas">
          <div
            ref={canvasRef}
            data-testid="ocr-template-canvas"
            className="xf-template-img-wrap"
            style={{ cursor: 'crosshair', position: 'relative', userSelect: 'none' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <img
              ref={imageRef}
              src={SAMPLE_IMAGES[scenario]}
              alt="模板样例"
              style={{ display: 'block', maxWidth: '100%', userSelect: 'none', pointerEvents: 'none' }}
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.2' }}
            />
            {displayFields.map(f => (
              <div
                key={f.id}
                className={`xf-template-overlay${activeField === f.id ? ' selected' : ''}`}
                style={{
                  position: 'absolute', left: f.dx, top: f.dy, width: f.dw, height: f.dh,
                  cursor: 'pointer', border: '2px solid var(--color-primary)',
                }}
                onClick={(e) => { e.stopPropagation(); setActiveField(f.id) }}
              >
                <span style={{
                  position: 'absolute', top: -16, left: 0,
                  fontSize: 10, color: activeField === f.id ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                  background: '#fff', padding: '0 4px', borderRadius: 2, whiteSpace: 'nowrap',
                }}>{f.name}</span>
              </div>
            ))}
            {displayRefs.map(f => (
              <div
                key={`r-${f.id}`}
                data-testid={`ocr-ref-box-${f.id}`}
                style={{
                  position: 'absolute', left: f.dx, top: f.dy, width: f.dw, height: f.dh,
                  pointerEvents: 'none',
                  border: '2px dashed var(--orange-6)',
                  background: 'rgba(250,140,22,0.06)',
                }}
              >
                <span style={{
                  position: 'absolute', top: -16, left: 0,
                  fontSize: 10, color: 'var(--orange-6)',
                  background: '#fff', padding: '0 4px', borderRadius: 2, whiteSpace: 'nowrap',
                }}>⚓ {f.name}</span>
              </div>
            ))}
            {drawBox && (
              <div style={{
                position: 'absolute',
                left: drawBox.left, top: drawBox.top,
                width: drawBox.width, height: drawBox.height,
                border: `2px dashed ${drawColor}`,
                background: step === 'refs' ? 'rgba(250,140,22,0.10)' : 'rgba(22,119,255,0.10)',
                pointerEvents: 'none',
              }} />
            )}
          </div>
        </div>

        {/* 右侧: 字段/参照字段编辑面板（按当前步骤切换） */}
        <div className="xf-template-side">
          {/* 步骤指示器 */}
          <div data-testid="ocr-step-indicator" style={{ display: 'flex', borderBottom: '2px solid var(--xf-border-light)' }}>
            {(['refs', 'fields'] as EditStep[]).map((s, i) => {
              const active = step === s
              const completed = (s === 'refs' && step === 'fields') || (s === 'fields' && false)
              const count = s === 'refs' ? referenceFields.length : fields.length
              return (
                <div
                  key={s}
                  data-testid={`ocr-step-${s}`}
                  onClick={() => setStep(s)}
                  style={{
                    flex: 1, padding: '12px 8px', textAlign: 'center', cursor: 'pointer',
                    borderBottom: active ? `3px solid ${s === 'refs' ? 'var(--orange-6)' : 'var(--color-primary)'}` : '3px solid transparent',
                    marginBottom: -2,
                    background: active ? '#fff' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 11, color: active ? (s === 'refs' ? 'var(--orange-6)' : 'var(--color-primary)') : 'var(--xf-text-tertiary)' }}>
                    步骤 {i + 1} {completed && '✓'}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, marginTop: 2 }}>
                    {s === 'refs' ? '⚓ 参照字段' : '🎯 识别字段'} ({count})
                  </div>
                </div>
              )
            })}
          </div>

          {step === 'refs' && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--xf-text-tertiary)', borderBottom: '1px solid var(--xf-border-light)' }}>
              在样例图上<b style={{ color: 'var(--orange-6)' }}>拖拽画框</b>创建参照字段，填写"实际文字"作为 OCR 模糊匹配锚点。
              <br />识别时会自动根据这些锚点计算新图偏移/缩放。
            </div>
          )}
          {step === 'fields' && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--xf-text-tertiary)', borderBottom: '1px solid var(--xf-border-light)' }}>
              在样例图上<b style={{ color: 'var(--color-primary)' }}>拖拽画框</b>创建识别字段（即要提取的数据区域）。坐标变换后落在此框内的文字就是字段值。
            </div>
          )}

          {step === 'refs' && (
            <div data-testid="ocr-ref-list" className="xf-field-list" style={{ flex: 1, overflow: 'auto' }}>
              {referenceFields.length === 0 ? (
                <div className="xf-empty" style={{ padding: 24 }}>
                  <div className="xf-empty-icon" style={{ color: 'var(--orange-6)' }}>⚓</div>
                  <div className="xf-empty-title">暂无参照字段</div>
                  <div className="xf-empty-desc">在样例图上拖拽画框</div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--xf-text-tertiary)' }}>
                    推荐锚点：标签性文字（如"发票号码"、"开票日期"），OCR 识别率高
                  </div>
                </div>
              ) : referenceFields.map(f => (
                <div key={f.id} className={`xf-field-row${activeField === f.id ? ' active' : ''}`}>
                  <div className="xf-field-label">
                    <span style={{ color: 'var(--orange-6)', marginRight: 4 }}>⚓</span>
                    <input
                      data-testid={`ocr-ref-name-${f.id}`}
                      value={f.name}
                      onChange={e => updateReferenceField(f.id, { name: e.target.value })}
                      onFocus={() => setActiveField(f.id)}
                      placeholder="名称"
                      style={{ border: 'none', outline: 'none', fontWeight: 600, fontSize: 13, width: 80, background: 'transparent' }}
                    />
                    <input
                      data-testid={`ocr-ref-text-${f.id}`}
                      value={f.text}
                      onChange={e => updateReferenceField(f.id, { text: e.target.value })}
                      placeholder="实际文字 (OCR 匹配)"
                      style={{
                        flex: 1, border: '1px solid var(--orange-6)', borderRadius: 3, padding: '2px 6px',
                        fontSize: 12, marginRight: 4, background: 'var(--color-warning-bg)',
                      }}
                    />
                    <button className="xf-field-close" onClick={() => removeReferenceField(f.id)}>×</button>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', fontFamily: 'monospace' }}>
                    ({f.x}, {f.y}) · {f.w}×{f.h}px
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 'fields' && (
            <div data-testid="ocr-field-list" className="xf-field-list" style={{ flex: 1, overflow: 'auto' }}>
              {fields.length === 0 ? (
                <div className="xf-empty" style={{ padding: 24 }}>
                  <div className="xf-empty-icon" style={{ color: 'var(--color-primary)' }}>▭</div>
                  <div className="xf-empty-title">暂无识别字段</div>
                  <div className="xf-empty-desc">在样例图上拖拽创建</div>
                </div>
              ) : fields.map(f => (
                <div key={f.id} className={`xf-field-row${activeField === f.id ? ' active' : ''}`}>
                  <div className="xf-field-label">
                    <input
                      value={f.name}
                      onChange={e => updateField(f.id, { name: e.target.value })}
                      onFocus={() => setActiveField(f.id)}
                      style={{ border: 'none', outline: 'none', fontWeight: 600, fontSize: 13, flex: 1, background: 'transparent' }}
                    />
                    <select
                      value={f.type}
                      onChange={e => updateField(f.id, { type: e.target.value as any })}
                      style={{ fontSize: 10, border: '1px solid var(--color-border)', borderRadius: 3, padding: '0 2px' }}
                    >
                      <option value="string">文本</option>
                      <option value="number">数字</option>
                      <option value="date">日期</option>
                      <option value="text">长文本</option>
                    </select>
                    <button className="xf-field-close" onClick={() => removeField(f.id)}>×</button>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', fontFamily: 'monospace' }}>
                    ({f.x}, {f.y}) · {f.w}×{f.h}px
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部导航：上一步 / 下一步 / 保存 */}
      <div data-testid="ocr-edit-nav" style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
        borderTop: '1px solid var(--xf-border-light)', background: 'var(--color-bg)',
      }}>
        <button
          data-testid="ocr-step-back"
          className="xf-btn-outline"
          disabled={step === 'refs'}
          onClick={() => setStep('refs')}
        >‹ 上一步</button>
        <button
          data-testid="ocr-step-next"
          className="xf-btn-outline"
          disabled={step === 'fields'}
          onClick={() => setStep('fields')}
        >下一步:识别字段 ›</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--xf-text-tertiary)' }}>
          锚点 {referenceFields.length} · 字段 {fields.length}
          {referenceFields.length > 0 && referenceFields.some(r => !r.text.trim()) && (
            <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>⚠ 部分锚点缺文字</span>
          )}
        </span>
        <button className="xf-btn-solid" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保 存'}
        </button>
        {savedMsg && <span style={{ fontSize: 12, color: savedMsg.startsWith('✓') ? 'var(--color-success)' : 'var(--color-danger)' }}>{savedMsg}</span>}
      </div>
    </>
  )
}

/* ============ 模板管理模式（对接后端 + 试一试识别） ============ */
function TemplateManageMode({ onSwitchMode }: { onSwitchMode: (m: OcrMode, tpl?: TemplateItem | null) => void }) {
  const [tab, setTab] = useState<'preset' | 'custom'>('custom')
  const [search, setSearch] = useState('')
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState<string | null>(null)
  const [recognizeResult, setRecognizeResult] = useState<{
    templateId: string
    fields: any[]
    anchors?: any[]
    alignmentScore?: number
    transform?: { offsetX: number; offsetY: number; scaleX: number; scaleY: number }
    regionsTotal?: number
    engine: string
    ms: number
    isMock: boolean
    warnings?: string[]
  } | null>(null)
  const [taskFilter, setTaskFilter] = useState<string>('')

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/ocr/templates')
      if (!r.ok) throw new Error(`API ${r.status}`)
      const d = await r.json()
      setTemplates(d.items || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const filtered = templates.filter(t =>
    !search || t.name.includes(search) || (t.sign || '').includes(search)
  )

  const copySign = (sign: string) => navigator.clipboard.writeText(sign)

  // 试一试：调识别端点
  const tryRecognize = useCallback(async (tpl: TemplateItem) => {
    setRecognizing(tpl.id)
    setError(null)
    setRecognizeResult(null)
    try {
      // 选第一个上传的图片 task
      const tr = await fetch('/api/tasks')
      const td = await tr.json()
      const img = (td.tasks || td.items || []).find((t: any) => ['png', 'jpg', 'jpeg', 'bmp', 'webp'].includes(t.ext))
      if (!img) {
        setError('需要先上传一张图片（在「文档预览」或「上传中心」）才能试识别')
        return
      }
      const r = await fetch('/api/ocr/recognize-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: img.id, templateId: tpl.id }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const d = await r.json()
      setRecognizeResult({ templateId: tpl.id, ...d })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRecognizing(null)
    }
  }, [])

  // 删除
  const del = useCallback(async (tpl: TemplateItem) => {
    if (!confirm(`删除模板「${tpl.name}」？`)) return
    try {
      await fetch(`/api/ocr/template/${tpl.id}`, { method: 'DELETE' })
      refresh()
    } catch {}
  }, [refresh])

  return (
    <>
      <div className="xf-tpl-tabs">
        <button className={`xf-tpl-tab${tab === 'preset' ? ' active' : ''}`} onClick={() => setTab('preset')}>
          预置模板<span className="xf-tpl-tab-help">?</span>
        </button>
        <button className={`xf-tpl-tab${tab === 'custom' ? ' active' : ''}`} onClick={() => setTab('custom')}>
          自定义模板
        </button>
      </div>

      <div className="xf-tpl-toolbar">
        <button className="xf-btn-outline">模板迁移 ▾</button>
        <button
          className="xf-btn-solid"
          style={{ minWidth: 120 }}
          onClick={() => onSwitchMode('template-edit', null)}
        >+ 创建模板</button>
        <input
          className="xf-tpl-search"
          placeholder="搜索名称 / templateSign"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div style={{ padding: '8px 24px', background: 'var(--color-danger-bg)', borderBottom: '1px solid var(--red-3)', color: 'var(--red-6)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="xf-tpl-table" style={{ maxHeight: '50vh', overflow: 'auto' }}>
        <div className="xf-tpl-row header">
          <div>模板名称</div>
          <div>场景</div>
          <div>templateSign</div>
          <div>字段</div>
          <div>修改时间</div>
          <div>操作</div>
        </div>
        {loading ? (
          <div className="xf-empty"><span className="xf-loading" /> 加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="xf-empty">暂无模板，点击右上角创建</div>
        ) : filtered.map(t => (
          <div key={t.id} className="xf-tpl-row">
            <div className="xf-tpl-name">{t.name}</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ padding: '2px 6px', borderRadius: 8, background: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                {SCENARIO_LABELS[t.scenario] || t.scenario}
              </span>
            </div>
            <div className="xf-tpl-id">
              {t.sign ? (
                <>
                  <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.sign.slice(0, 24)}…</code>
                  <span className="xf-tpl-id-copy" onClick={() => copySign(t.sign!)}>⧉</span>
                </>
              ) : (
                <span style={{ color: 'var(--xf-text-tertiary)', fontSize: 11 }}>本地坐标模板</span>
              )}
            </div>
            <div style={{ fontSize: 12 }}>{t.fields?.length || 0} 个</div>
            <div style={{ color: 'var(--xf-text-secondary)', fontSize: 12 }}>
              {new Date(t.updatedAt).toLocaleString('zh-CN')}
            </div>
            <div className="xf-tpl-actions">
              <a className="try" onClick={() => tryRecognize(t)}>
                {recognizing === t.id ? '识别中…' : '试一试'}
              </a>
              <a className="edit" onClick={() => onSwitchMode('template-edit', t)}>编辑</a>
              <a className="delete" onClick={() => del(t)}>删除</a>
            </div>
          </div>
        ))}
      </div>

      {/* 识别结果展示 */}
      {recognizeResult && (
        <div style={{ margin: 16, padding: 16, border: '1px solid var(--color-border-light)', borderRadius: 8, background: 'var(--color-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>🔍 识别结果</span>
            <span data-testid="ocr-result-engine" style={{ fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
              {recognizeResult.engine} · {recognizeResult.ms}ms
              {recognizeResult.isMock && <span style={{ marginLeft: 6, color: 'var(--color-warning)' }}>（mock 模式，配置 BAIDU_OCR_API_KEY 后启用真实识别）</span>}
            </span>
            {recognizeResult.alignmentScore !== undefined && (
              <span data-testid="ocr-result-alignment" style={{
                fontSize: 12, padding: '2px 8px', borderRadius: 10,
                background: recognizeResult.alignmentScore > 0.7 ? 'var(--color-success-bg)' : recognizeResult.alignmentScore > 0.3 ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)',
                color: recognizeResult.alignmentScore > 0.7 ? 'var(--color-success)' : recognizeResult.alignmentScore > 0.3 ? 'var(--color-warning)' : 'var(--color-danger)',
                border: '1px solid currentColor',
              }}>
                对齐质量 {(recognizeResult.alignmentScore * 100).toFixed(0)}%
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button className="xf-mini-btn" onClick={() => setRecognizeResult(null)}>关闭</button>
          </div>

          {/* 对齐诊断 */}
          {recognizeResult.anchors && recognizeResult.anchors.length > 0 && (
            <details style={{ marginBottom: 12, fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--xf-text-secondary)', userSelect: 'none' }}>
                🔧 对齐诊断（{recognizeResult.anchors.filter((a: any) => a.matched).length}/{recognizeResult.anchors.length} 锚点匹配）
              </summary>
              <div style={{ marginTop: 8, padding: 8, background: 'var(--color-bg-subtle)', borderRadius: 4 }}>
                {recognizeResult.transform && (
                  <div style={{ marginBottom: 6, color: 'var(--xf-text-tertiary)', fontFamily: 'monospace' }}>
                    偏移 ({recognizeResult.transform.offsetX.toFixed(0)}, {recognizeResult.transform.offsetY.toFixed(0)}) 缩放 ({recognizeResult.transform.scaleX.toFixed(2)}, {recognizeResult.transform.scaleY.toFixed(2)})
                    {recognizeResult.regionsTotal !== undefined && <span style={{ marginLeft: 8 }}>· {recognizeResult.regionsTotal} OCR regions</span>}
                  </div>
                )}
                {recognizeResult.anchors.map((a: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{
                      color: a.matched ? 'var(--color-success)' : 'var(--color-danger)', fontFamily: 'monospace', width: 12,
                    }}>
                      {a.matched ? '✓' : '✗'}
                    </span>
                    <span style={{ minWidth: 100, color: 'var(--xf-text-tertiary)' }}>{a.text || a.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: a.matched ? 'var(--color-primary)' : '#999' }}>
                      {a.matched ? `命中: ${a.region?.text || '?'}` : `未命中 (最佳=${(a.score * 100).toFixed(0)}%)`}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {recognizeResult.warnings && recognizeResult.warnings.length > 0 && (
            <div style={{ marginBottom: 12, padding: 8, background: 'var(--color-warning-bg)', border: '1px solid var(--amber-2)', borderRadius: 4, fontSize: 12, color: 'var(--color-warning)' }}>
              {recognizeResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {recognizeResult.fields.map((f, i) => (
              <div key={i} data-testid={`ocr-result-field-${f.name}`} style={{ padding: 8, background: '#fff', borderRadius: 6, border: '1px solid var(--color-border-light)' }}>
                <div style={{ fontSize: 11, color: 'var(--xf-text-tertiary)' }}>{f.name}</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, wordBreak: 'break-all' }}>{f.value || '(空)'}</div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--xf-text-tertiary)', marginTop: 4 }}>
                  {f.confidence !== undefined && (
                    <span style={{ color: f.confidence > 0.8 ? 'var(--color-success)' : f.confidence > 0.3 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                      置信度 {(f.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {f.hitCount !== undefined && (
                    <span>命中 {f.hitCount} 段</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
