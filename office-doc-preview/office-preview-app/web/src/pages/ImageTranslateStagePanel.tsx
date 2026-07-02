// 模型：claude-sonnet-4-6
// ImageTranslateStagePanel — 图片翻译 4 阶段编排面板
// Phase C: Translation UX Overhaul Agent 7
//
// 4 阶段（复用 useTranslateStage 的 4 段 URL 状态: pick/translating/review/export，
//        但将 translating 渲染为 OCR 步骤以贴合图片翻译流程语义）：
//   - pick      — 任务选择 + 源/目标语种 + 原图预览（preview-before-OCR）
//   - ocr       — <ProgressRing> 进度环 + useTranslateJob 1s 轮询 + 取消（同步返回则跳过）
//   - review    — <ResizableSplit> 左 ImageDualView + DictionaryCard，右 AnnotationList + 译文列表
//   - export    — 双语 PNG / 双语 PDF / 译文图 单选 + 导出按钮 + 完成按钮 reset
//
// URL state 由父组件 (ImageTranslateMode) 通过 stage + onStageChange 传入；
// 本组件对外是纯 props 驱动 + 阶段回调，便于测试与浏览器前进/后退。
//
// 日志规范（沿用 Phase A.6 / Phase B 模式）：
//   [translate-ui ISO] image-stage={stage} task={taskId}
//   [translate-ui ISO] image-ocr start task=… src=… tgt=…
//   [translate-ui ISO] image-export task=… format=…
//
// 复用 Phase A: StageIndicator / ResizableSplit / AnnotationList / useTranslateStage /
// useTranslateJob / useAnnotation / useToastStore / useImageBatch / ImageDualView /
// ImageRegionSvgOverlay / DictionaryCard / ImageBatchQueue / ProgressRing / ImagePreviewPane.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { LangCode, OCRRegion, OCRResult, Task } from '../types'
import { useStore } from '../store'
import type { TranslateStage } from '../hooks/useTranslateStage'
import { useTranslateJob } from '../hooks/useTranslateJob'
import { useAnnotation } from '../hooks/useAnnotation'
import { useToastStore } from '../hooks/useToast'
import { useImageBatch } from '../hooks/useImageBatch'
import { StageIndicator } from '../components/StageIndicator'
import { ResizableSplit } from '../components/ResizableSplit'
import { AnnotationList } from '../components/AnnotationList'
import { ImageDualView } from '../components/ImageDualView'
import { DictionaryCard } from '../components/DictionaryCard'
import { ImageBatchQueue } from '../components/ImageBatchQueue'
import { ProgressRing } from '../components/ProgressRing'
import { ConfidenceDot } from '../components/ConfidenceDot'
import { ImagePreviewPane } from '../components/ImagePreviewPane'

/** 图片翻译输出格式（仅本组件内部使用，不修改全局 types） */
export type ImageTranslateFormat = 'bilingual-png' | 'bilingual-pdf' | 'target-image'

export interface ImageTranslateStagePanelProps {
  /** 当前阶段（URL state 同步由父组件完成） */
  stage: TranslateStage
  /** 阶段切换回调（父组件负责写 URL searchParams） */
  onStageChange: (s: TranslateStage) => void
  /** 可选：预选任务 id（来自 URL ?task=…） */
  initialTaskId?: string
  /** 可选：自定义 className */
  className?: string
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif']

const LANG_OPTIONS: { code: LangCode; label: string }[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
]

const FORMAT_OPTIONS: { key: ImageTranslateFormat; label: string }[] = [
  { key: 'bilingual-png', label: '双语 PNG' },
  { key: 'bilingual-pdf', label: '双语 PDF' },
  { key: 'target-image', label: '译文图' },
]

function fileNameForFormat(taskName: string | undefined, format: ImageTranslateFormat): string {
  const base = (taskName ?? 'translation').replace(/\.[^.]+$/, '')
  const ext = format === 'bilingual-png' ? 'png' : format === 'bilingual-pdf' ? 'pdf' : 'png'
  return `${base}-${format}.${ext}`
}

/** 仅 image-done / page-done / finished 视为「完成」 */
function isJobTerminal(status: string, frames: ReadonlyArray<{ kind?: string }>): boolean {
  if (status === 'finished' || status === 'failed' || status === 'cancelled') return true
  return frames.some((f) => f.kind === 'finished')
}

export function ImageTranslateStagePanel({
  stage,
  onStageChange,
  initialTaskId,
  className,
}: ImageTranslateStagePanelProps) {
  const tasks = useStore((s) => s.tasks)
  const imageTasks = useMemo(() => tasks.filter((t) => IMAGE_EXTS.includes(t.ext)), [tasks])
  const addImageTranslateRecent = useStore((s) => s.addImageTranslateRecent)

  // ==== Pick 阶段状态 ====
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(initialTaskId)
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')

  // ==== OCR/Translating 阶段状态 ====
  const [jobId, setJobId] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [translations, setTranslations] = useState<Record<number, string>>({})
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null)

  // ==== Review 阶段状态 ====
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'overlay' | 'stacked' | 'original'>('overlay')
  const [fontSize, setFontSize] = useState(14)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSelected, setBatchSelected] = useState<string[]>([])

  // ==== Export 阶段状态 ====
  const [exportFormat, setExportFormat] = useState<ImageTranslateFormat>('bilingual-png')
  const [exporting, setExporting] = useState(false)

  // ==== Phase A hook 集成 ====
  const job = useTranslateJob(jobId, { pollMs: 1000 })
  const annotationHook = useAnnotation(selectedTaskId ?? null)
  const annotationCount = annotationHook.count
  const pushToast = useToastStore((s) => s.push)
  const batch = useImageBatch()

  const selectedTask = useMemo<Task | null>(
    () => imageTasks.find((t) => t.id === selectedTaskId) ?? null,
    [imageTasks, selectedTaskId],
  )

  // ==== 同步：selectedTask 变更 → 重置 OCR / 翻译结果 ====
  const prevSelectedTaskIdRef = useRef<string | undefined>(selectedTaskId)
  useEffect(() => {
    if (prevSelectedTaskIdRef.current === selectedTaskId) return
    prevSelectedTaskIdRef.current = selectedTaskId
    setOcrResult(null)
    setTranslations({})
    setSelectedIdx(null)
    setHoveredIdx(null)
    setJobId(null)
    setTranslateError(null)
    setStartedAtIso(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId])

  // ==== 同步：batch status → toast ====
  useEffect(() => {
    if (batch.status === 'completed') pushToast({ kind: 'success', message: '批量翻译完成' })
    else if (batch.status === 'failed') pushToast({ kind: 'error', message: '批量翻译失败' })
    else if (batch.status === 'cancelled') pushToast({ kind: 'info', message: '批量翻译已取消' })
  }, [batch.status, pushToast])

  // ==== 日志：阶段切换 ====
  useEffect(() => {
    console.info(
      `[translate-ui ${new Date().toISOString()}] image-stage=${stage} task=${selectedTaskId ?? initialTaskId ?? '-'}`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedTaskId])

  // ==== 进度百分比 ====
  const ocrPercent = useMemo(() => {
    if (job.total > 0) {
      return Math.min(100, Math.round((job.completed / job.total) * 100))
    }
    if (job.status === 'finished') return 100
    if (job.status === 'failed' || job.status === 'cancelled') return 0
    return 0
  }, [job.total, job.completed, job.status])

  // ==== 同步 / 异步 OCR 完成后自动进入 review ====
  useEffect(() => {
    if (stage !== 'translating') return
    // 异步：job 终态 → review
    if (jobId && isJobTerminal(job.status, job.frames)) {
      onStageChange('review')
    }
    // 同步：mock 直接返回 ocrResult 也算完成
    if (!jobId && ocrResult && !translating && !translateError) {
      onStageChange('review')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, jobId, job.status, job.frames, ocrResult, translating, translateError])

  // ==== Pick handlers ====
  const handleStartOCR = useCallback(async () => {
    if (!selectedTaskId) {
      pushToast({ kind: 'warning', message: '请先选择图片任务' })
      return
    }
    setTranslateError(null)
    setOcrResult(null)
    setTranslations({})
    setSelectedIdx(null)
    setHoveredIdx(null)

    const ts = new Date().toISOString()
    console.info(`[translate-ui ${ts}] image-ocr start task=${selectedTaskId} src=${sourceLang} tgt=${targetLang}`)
    setStartedAtIso(ts)
    setTranslating(true)

    try {
      // 1) OCR
      const ocrRes = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ taskId: selectedTaskId }),
      })
      if (!ocrRes.ok) {
        let msg = `OCR ${ocrRes.status}`
        try { const j = await ocrRes.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const ocrData = (await ocrRes.json()) as OCRResult
      setOcrResult(ocrData)

      // 2) 同步返回则不创建 job；若服务端附 header X-Job-Id 则进入轮询模式
      const serverJobId = ocrRes.headers.get('x-job-id')
      if (serverJobId) {
        setJobId(serverJobId)
        onStageChange('translating')
      }

      // 3) 同步翻译（standalone 模式，传 OCR 文本）
      const trRes = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          taskId: 'standalone',
          sourceLang,
          targetLang,
          text: ocrData.text || '',
        }),
      })
      if (!trRes.ok) {
        let msg = `翻译 ${trRes.status}`
        try { const j = await trRes.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const trData = await trRes.json()
      const segs: Array<{ source: string; target: string }> = trData.segments || []
      const newTranslations: Record<number, string> = {}
      const regionToSeg = new Map<number, number>()
      ocrData.regions.forEach((r, i) => {
        const idx = segs.findIndex((s) => s.source === r.text)
        regionToSeg.set(i, idx >= 0 ? idx : i)
      })
      for (let i = 0; i < ocrData.regions.length; i++) {
        const segIdx = regionToSeg.get(i) ?? i
        newTranslations[i] = segs[segIdx]?.target ?? ''
      }
      setTranslations(newTranslations)
      addImageTranslateRecent(selectedTaskId)

      // 4) 若无 jobId（同步 mock 路径）直接进入 review
      if (!serverJobId) {
        onStageChange('review')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTranslateError(msg)
      pushToast({ kind: 'error', message: `识别失败：${msg}` })
    } finally {
      setTranslating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, sourceLang, targetLang, pushToast, addImageTranslateRecent, onStageChange])

  // ==== Translating handlers ====
  const handleCancelOCR = useCallback(async () => {
    const ok = await job.cancel()
    if (ok) {
      pushToast({ kind: 'info', message: 'OCR 任务已取消' })
      onStageChange('pick')
    } else {
      // 即使 cancel 失败（mock 路径没有真实 job），也允许回退到 pick
      onStageChange('pick')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, pushToast, onStageChange])

  // ==== Review handlers ====
  const handleCopyAll = useCallback(() => {
    if (!ocrResult) return
    const lines = ocrResult.regions.map((_, i) => translations[i] || '').filter(Boolean)
    const text = lines.join('\n')
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      pushToast({ kind: 'success', message: '已复制全部译文' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrResult, translations])

  const handleRetranslate = useCallback(async () => {
    if (selectedIdx == null || !ocrResult) return
    const reg = ocrResult.regions[selectedIdx]
    try {
      const r = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ taskId: 'standalone', sourceLang, targetLang, text: reg.text }),
      })
      if (!r.ok) throw new Error(`重译 ${r.status}`)
      const data = await r.json()
      const tgt = data.segments?.[0]?.target ?? ''
      setTranslations((prev) => ({ ...prev, [selectedIdx]: tgt }))
      pushToast({ kind: 'success', message: '已重译' })
    } catch (e) {
      pushToast({ kind: 'error', message: `重译失败：${e instanceof Error ? e.message : String(e)}` })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, ocrResult, sourceLang, targetLang, pushToast])

  const handleCopyRegion = useCallback(() => {
    if (selectedIdx == null) return
    const text = translations[selectedIdx] || ''
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, translations])

  const handleOpenGlossary = useCallback(() => {
    pushToast({ kind: 'info', message: '术语库入口（待接入）' })
  }, [pushToast])

  // ==== Batch handlers ====
  const toggleBatchTask = useCallback((taskId: string) => {
    setBatchSelected((prev) => prev.includes(taskId) ? prev.filter((t) => t !== taskId) : [...prev, taskId])
  }, [])

  const handleBatchStart = useCallback(async () => {
    if (batchSelected.length === 0) return
    try {
      await batch.start({ taskIds: batchSelected, sourceLang, targetLang })
    } catch (e) {
      pushToast({ kind: 'error', message: `batch 启动失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }, [batch, batchSelected, sourceLang, targetLang, pushToast])

  const handleBatchCancel = useCallback(async () => {
    await batch.cancel()
  }, [batch])

  // ==== Export handlers ====
  const handleExport = useCallback(async () => {
    if (!selectedTaskId) {
      pushToast({ kind: 'warning', message: '请先选择图片任务' })
      return
    }
    const ts = new Date().toISOString()
    console.info(`[translate-ui ${ts}] image-export task=${selectedTaskId} format=${exportFormat}`)
    setExporting(true)
    try {
      // 用 inspect/translate/export 端点（与 DocTranslateStagePanel 一致）
      const params = new URLSearchParams({
        taskId: selectedTaskId,
        format: exportFormat === 'bilingual-pdf' ? 'bilingual-pdf' : 'bilingual-docx',
        sourceLang,
        targetLang,
      })
      const r = await fetch(`/api/inspect/translate/export?${params.toString()}`, {
        credentials: 'same-origin',
      })
      if (!r.ok) throw new Error(`export ${r.status}`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileNameForFormat(selectedTask?.name, exportFormat)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      pushToast({ kind: 'success', message: '导出成功' })
    } catch (e) {
      pushToast({ kind: 'error', message: `导出失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setExporting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, exportFormat, sourceLang, targetLang, selectedTask?.name, pushToast])

  const handleReset = useCallback(() => {
    setJobId(null)
    setTranslateError(null)
    setStartedAtIso(null)
    setOcrResult(null)
    setTranslations({})
    setSelectedIdx(null)
    setHoveredIdx(null)
    setExporting(false)
    setBatchSelected([])
    onStageChange('pick')
    // 通知父组件（URL ?task= 仍保留以便 pick 阶段预选）
    pushToast({ kind: 'info', message: '已重置，可重新选择文件' })
  }, [onStageChange, pushToast])

  // ===== 渲染 =====
  // 顶部 StageIndicator：复用 Phase A.1，但传递自定义 labels 把 "翻译中" 改为 "识别中"
  const stageLabels = useMemo(
    () => ({ pick: '选择图片', translating: '识别中', review: '校对', export: '导出' }),
    [],
  )

  // 空任务列表：占位
  if (imageTasks.length === 0) {
    return (
      <div
        data-testid="oa-image-stage-empty"
        className={`oa-image-stage-empty ${className ?? ''}`.trim()}
        role="status"
        aria-label="无图片任务"
      >
        <StageIndicator current={stage} labels={stageLabels} />
        <div className="oa-image-stage-empty-body">
          暂无图片任务，请先在「文件」页面上传 png / jpg / jpeg / bmp / webp / gif 图片
        </div>
      </div>
    )
  }

  return (
    <div
      className={`oa-image-stage-panel ${className ?? ''}`.trim()}
      data-testid="oa-image-stage-panel"
      data-stage={stage}
    >
      {/* 顶部阶段指示器 */}
      <header className="oa-image-stage-panel-header">
        <StageIndicator
          current={stage}
          labels={stageLabels}
          onChange={(s) => onStageChange(s)}
          ariaLabel="图片翻译流程步骤"
        />
      </header>

      <main className="oa-image-stage-panel-body">
        {stage === 'pick' && (
          <section
            className="oa-image-stage-pick"
            data-testid="oa-image-stage-pick"
            aria-label="选择图片"
          >
            <div className="oa-image-stage-pick-toolbar">
              <label className="oa-image-stage-pick-field">
                <span>源语言</span>
                <select
                  className="oa-image-stage-pick-select"
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value as LangCode)}
                  data-testid="oa-image-stage-source-lang"
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="oa-image-stage-pick-field">
                <span>目标语言</span>
                <select
                  className="oa-image-stage-pick-select"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value as LangCode)}
                  data-testid="oa-image-stage-target-lang"
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={() => setBatchOpen(true)}
                data-testid="oa-image-stage-batch"
                title="批量翻译 (⌘+U)"
              >
                📦 批量
              </button>
            </div>

            <div className="oa-image-stage-pick-task">
              <label className="oa-image-stage-pick-field">
                <span>选择图片</span>
                <select
                  className="oa-image-stage-pick-select"
                  value={selectedTaskId ?? ''}
                  onChange={(e) => setSelectedTaskId(e.target.value || undefined)}
                  data-testid="oa-image-stage-task-select"
                >
                  <option value="">— 选择已上传图片 —</option>
                  {imageTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* preview-before-OCR */}
            {selectedTaskId ? (
              <div className="oa-image-stage-pick-preview" data-testid="oa-image-stage-pick-preview">
                <ImagePreviewPane
                  taskId={selectedTaskId}
                  showGrid
                  page={1}
                />
              </div>
            ) : (
              <div className="oa-image-stage-pick-preview-empty" data-testid="oa-image-stage-pick-preview-empty">
                请从下拉框选择图片任务，预览将在此显示
              </div>
            )}

            {translateError && (
              <div
                className="oa-image-stage-error"
                role="alert"
                data-testid="oa-image-stage-error"
              >
                {translateError}
              </div>
            )}

            <div className="oa-image-stage-pick-actions">
              <button
                type="button"
                className="oa-btn-primary"
                onClick={handleStartOCR}
                disabled={!selectedTaskId || translating}
                data-testid="oa-image-stage-start-ocr"
              >
                {translating ? '识别中…' : '开始识别'}
              </button>
            </div>
          </section>
        )}

        {stage === 'translating' && (
          <section
            className="oa-image-stage-ocr"
            data-testid="oa-image-stage-ocr"
            aria-label="识别中"
          >
            <div className="oa-image-stage-ocr-progress">
              <ProgressRing percent={ocrPercent} label={ocrPercent + '%'} />
              <div className="oa-image-stage-ocr-meta">
                <div className="oa-image-stage-ocr-label">
                  {jobId ? `识别 job=${jobId.slice(0, 8)}…` : '同步识别中…'}
                </div>
                <div className="oa-image-stage-ocr-stats">
                  完成 {job.completed} / {job.total || '?'} ·
                  状态 <strong>{job.status}</strong>
                </div>
                {job.error && (
                  <div className="oa-image-stage-ocr-error" data-testid="oa-image-stage-ocr-error">
                    {job.error}
                  </div>
                )}
              </div>
            </div>

            <div className="oa-image-stage-ocr-actions">
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={handleCancelOCR}
                data-testid="oa-image-stage-ocr-cancel"
              >
                取消
              </button>
              {startedAtIso && (
                <span
                  className="oa-image-stage-ocr-started-at"
                  data-testid="oa-image-stage-ocr-started-at"
                >
                  启动时间：{startedAtIso}
                </span>
              )}
            </div>
          </section>
        )}

        {stage === 'review' && (
          <section
            className="oa-image-stage-review"
            data-testid="oa-image-stage-review"
            aria-label="校对"
          >
            <ResizableSplit
              storageKey={selectedTaskId ? `translate-image-review-${selectedTaskId}` : 'translate-image-review'}
              direction="horizontal"
              initialRatio={0.55}
              second={
                <div className="oa-image-stage-review-secondary" data-testid="oa-image-stage-review-secondary">
                  <AnnotationList taskId={selectedTaskId ?? ''} segmentId={selectedIdx != null ? String(selectedIdx) : undefined} />
                  <div className="oa-image-stage-review-region-list" data-testid="oa-image-stage-review-region-list">
                    <header>区域翻译</header>
                    {(ocrResult?.regions ?? []).map((r: OCRRegion, i) => (
                      <div
                        key={i}
                        className="oa-image-stage-review-region-row"
                        data-testid={`oa-image-stage-review-region-row-${i}`}
                        data-selected={selectedIdx === i}
                        onClick={() => setSelectedIdx(i)}
                      >
                        <ConfidenceDot confidence={r.confidence} showValue size={8} />
                        <span className="oa-image-stage-review-region-text">{r.text || '(空)'}</span>
                        <span className="oa-image-stage-review-region-translation">
                          {translations[i] || '⏳ 翻译中…'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
              <div className="oa-image-stage-review-primary" data-testid="oa-image-stage-review-primary">
                {selectedTask ? (
                  <ImageDualView
                    imageSrc={selectedTask.originalUrl}
                    imageSize={ocrResult?.imageSize ?? { width: 0, height: 0 }}
                    regions={ocrResult?.regions ?? []}
                    translations={translations}
                    selectedIdx={selectedIdx}
                    hoveredIdx={hoveredIdx}
                    viewMode={viewMode}
                    onSelectRegion={(idx) => setSelectedIdx(idx)}
                    onHoverRegion={(idx) => setHoveredIdx(idx)}
                    onCopyAll={handleCopyAll}
                    onSaveBilingual={() => {
                      pushToast({ kind: 'info', message: '双语图保存（待接入）' })
                    }}
                  />
                ) : (
                  <div className="oa-image-stage-review-empty" data-testid="oa-image-stage-review-empty">
                    任务不存在
                  </div>
                )}
              </div>
            </ResizableSplit>

            {selectedIdx !== null && ocrResult && ocrResult.regions[selectedIdx] && (
              <DictionaryCard
                open
                anchor={{ x: 320, y: 200 }}
                sourceText={ocrResult.regions[selectedIdx].text}
                translation={translations[selectedIdx] ?? ''}
                confidence={ocrResult.regions[selectedIdx].confidence}
                busy={false}
                onClose={() => setSelectedIdx(null)}
                onRetranslate={handleRetranslate}
                onCopy={handleCopyRegion}
                onOpenGlossary={handleOpenGlossary}
                onFontSizeChange={(d) => setFontSize((s) => Math.max(10, Math.min(28, s + d)))}
                fontSize={fontSize}
              />
            )}

            <div className="oa-image-stage-review-footer">
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={() => onStageChange('pick')}
                data-testid="oa-image-stage-review-back"
              >
                ← 返回 pick
              </button>
              <button
                type="button"
                className="oa-btn-primary"
                onClick={() => onStageChange('export')}
                data-testid="oa-image-stage-review-next"
              >
                继续到导出 →
              </button>
            </div>
          </section>
        )}

        {stage === 'export' && (
          <section
            className="oa-image-stage-export"
            data-testid="oa-image-stage-export"
            aria-label="导出"
          >
            <fieldset className="oa-image-stage-export-formats">
              <legend>输出格式</legend>
              {FORMAT_OPTIONS.map((f) => (
                <label key={f.key} className="oa-image-stage-export-format">
                  <input
                    type="radio"
                    name="image-export-format"
                    value={f.key}
                    checked={exportFormat === f.key}
                    onChange={() => setExportFormat(f.key)}
                    data-testid={`oa-image-stage-export-fmt-${f.key}`}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </fieldset>

            {selectedTask && (
              <div
                className="oa-image-stage-export-task"
                data-testid="oa-image-stage-export-task"
              >
                任务：<strong>{selectedTask.name}</strong> · {sourceLang} → {targetLang}
              </div>
            )}

            <div className="oa-image-stage-export-actions">
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={() => onStageChange('review')}
                data-testid="oa-image-stage-export-back"
              >
                ← 返回校对
              </button>
              <button
                type="button"
                className="oa-btn-primary"
                onClick={handleExport}
                disabled={exporting || !selectedTaskId}
                data-testid="oa-image-stage-export-go"
              >
                {exporting ? '导出中…' : '导出'}
              </button>
              <button
                type="button"
                className="oa-btn-ghost"
                onClick={handleReset}
                data-testid="oa-image-stage-export-finish"
              >
                完成（回到 pick）
              </button>
            </div>
          </section>
        )}
      </main>

      {/* ImageBatchQueue 始终挂载，由 open 控制可见性 */}
      <ImageBatchQueue
        open={batchOpen}
        tasks={imageTasks}
        selectedTaskIds={batchSelected}
        jobId={batch.jobId}
        status={batch.status}
        items={batch.items}
        onClose={() => setBatchOpen(false)}
        onToggleTask={toggleBatchTask}
        onStart={handleBatchStart}
        onCancel={handleBatchCancel}
      />
    </div>
  )
}