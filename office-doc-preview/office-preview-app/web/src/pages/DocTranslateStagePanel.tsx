// 模型：claude-sonnet-4-6
// DocTranslateStagePanel — 文档翻译 4 阶段编排面板
// Phase B: Translation UX Overhaul Agent 6
//
// 4 阶段: pick → translating → review → export
// - 阶段切换由父组件 (TranslationPage) 通过 stage + onStageChange 控制（URL state 同步）
// - pick: 空态 + 任务选择 + 语言选择 + 前 2 页预览
// - translating: <DocTranslateProgress> + 取消 + auto-advance 到 review
// - review: React.lazy(<TranslationLayout>) + ResizableSplit + AnnotationList
// - export: 4 种格式单选 + 导出按钮（fetch + toast）+ 完成按钮 reset
//
// 日志规范（Phase A.6 延续）:
//   [translate-ui ISO] stage=...  task=...  annotations=...
//   [translate-ui ISO] doc-translate start task=...  src=...  tgt=...
//   [translate-ui ISO] doc-translate export task=...  format=...
//
// 复用 Phase A: StageIndicator, ResizableSplit, AnnotationList, useTranslateJob,
// useTranslateStage (URL state 由父组件管理；此处只暴露数据回调), useAnnotation,
// useToastStore (zustand), DocPreviewPane, DocTranslateProgress

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { LangCode, DocTranslateFormat, Task } from '../types'
import { useStore } from '../store'
import { useTranslateJob } from '../hooks/useTranslateJob'
import { useAnnotation } from '../hooks/useAnnotation'
import { useToastStore } from '../hooks/useToast'
import { StageIndicator } from '../components/StageIndicator'
import { ResizableSplit } from '../components/ResizableSplit'
import { AnnotationList } from '../components/AnnotationList'
import { DocPreviewPane } from '../components/DocPreviewPane'
import { DocTranslateProgress } from '../components/DocTranslateProgress'

// React.lazy: 仅 review 阶段加载 1350 行 TranslationLayout（生产代码）
const TranslationLayout = lazy(() =>
  import('../inspect/TranslationLayout').then((m) => ({ default: m.TranslationLayout })),
)

export interface DocTranslateStagePanelProps {
  /** 当前阶段（URL state 同步由父组件完成） */
  stage: import('../hooks/useTranslateStage').TranslateStage
  /** 阶段切换回调 */
  onStageChange: (s: import('../hooks/useTranslateStage').TranslateStage) => void
  /** 可选：预选任务 id（来自 URL ?task=…） */
  initialTaskId?: string
  /** 可选：自定义 className */
  className?: string
}

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

const FORMAT_OPTIONS: { key: DocTranslateFormat; label: string }[] = [
  { key: 'bilingual-docx', label: '双语 DOCX' },
  { key: 'bilingual-pdf', label: '双语 PDF' },
  { key: 'target-pdf', label: '译文 PDF' },
  { key: 'vtt', label: 'VTT' },
]

/** 过滤文档类任务（docx/pdf/pptx/xlsx/txt/md 等） */
function filterDocTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) =>
    ['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls', 'pdf', 'txt', 'md'].includes(t.ext),
  )
}

/** 默认文档导出文件名（含扩展名） */
function fileNameForFormat(taskName: string | undefined, format: DocTranslateFormat): string {
  const base = (taskName ?? 'translation').replace(/\.[^.]+$/, '')
  const ext =
    format === 'bilingual-docx' ? 'docx'
      : format === 'bilingual-pdf' ? 'pdf'
        : format === 'target-pdf' ? 'pdf'
          : format === 'vtt' ? 'vtt'
            : 'bin'
  return `${base}.${ext}`
}

export function DocTranslateStagePanel({
  stage,
  onStageChange,
  initialTaskId,
  className,
}: DocTranslateStagePanelProps) {
  const tasks = useStore((s) => s.tasks)
  const docTasks = useMemo(() => filterDocTasks(tasks), [tasks])

  // ==== Pick 阶段状态 ====
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(initialTaskId)
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')

  // ==== Translating 阶段状态 ====
  const [jobId, setJobId] = useState<string | null>(null)
  const [glossaryHits, setGlossaryHits] = useState(0)
  const [tmHits, setTmHits] = useState(0)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null)

  // ==== Export 阶段状态 ====
  const [exportFormat, setExportFormat] = useState<DocTranslateFormat>('bilingual-docx')
  const [exporting, setExporting] = useState(false)

  // ==== Phase A hook 集成 ====
  // 注：URL state 由父组件 DocTranslateMode 负责；本组件只暴露 stage + onStageChange
  // 不在此处调用 useTranslateStage，避免与父组件双重同步导致竞态
  const job = useTranslateJob(jobId, { pollMs: 1000 })

  // 标注数据（review 阶段需要）
  const annotationHook = useAnnotation(selectedTaskId ?? null)
  const annotationCount = annotationHook.count

  const pushToast = useToastStore((s) => s.push)

  // 日志：阶段切换
  useEffect(() => {
    console.info(
      `[translate-ui ${new Date().toISOString()}] stage=${stage} task=${selectedTaskId ?? initialTaskId ?? '-'} annotations=${annotationCount}`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedTaskId, annotationCount])

  // 计算进度百分比 + ETA
  const percent =
    job.total > 0
      ? Math.min(100, (job.completed / job.total) * 100)
      : job.status === 'finished' ? 100 : 0
  const eta = computeEtaForStatus(job)

  // 翻译完成 → auto-advance 到 review
  useEffect(() => {
    if (stage === 'translating' && job.status === 'finished' && job.completed >= job.total && job.total > 0) {
      onStageChange('review')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status, job.completed, job.total, stage])

  // ==== Pick handlers ====
  const handleStartTranslate = useCallback(async () => {
    if (!selectedTaskId) {
      pushToast({ kind: 'warning', message: '请先选择文件' })
      return
    }
    setTranslateError(null)
    const newJobId = 'tj_' + Date.now().toString(36)
    const startedAtNow = new Date().toISOString()
    setStartedAtIso(startedAtNow)
    console.info(
      `[translate-ui ${startedAtNow}] doc-translate start task=${selectedTaskId} src=${sourceLang} tgt=${targetLang}`,
    )
    setTranslating(true)
    try {
      const r = await fetch('/api/inspect/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          taskId: selectedTaskId,
          sourceLang,
          targetLang,
          jobId: newJobId,
        }),
      })
      if (!r.ok) {
        let msg = `API ${r.status}`
        try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const hdrJobId = r.headers.get('x-job-id') || newJobId
      const gHits = Number(r.headers.get('x-translate-glossary-hits') || 0)
      const tHits = Number(r.headers.get('x-translate-tm-hits') || 0)
      setJobId(hdrJobId)
      setGlossaryHits(gHits)
      setTmHits(tHits)
      onStageChange('translating')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTranslateError(msg)
      pushToast({ kind: 'error', message: `翻译启动失败：${msg}` })
    } finally {
      setTranslating(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, sourceLang, targetLang, pushToast, onStageChange])

  // ==== Translating handlers ====
  const handleCancel = useCallback(async () => {
    const ok = await job.cancel()
    if (ok) {
      pushToast({ kind: 'info', message: '翻译任务已取消' })
      onStageChange('pick')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, onStageChange, pushToast])

  // ==== Review handlers ====
  const handleDownload = useCallback(async () => {
    if (!selectedTaskId) {
      pushToast({ kind: 'warning', message: '请先选择文件' })
      return
    }
    const ts = new Date().toISOString()
    console.info(
      `[translate-ui ${ts}] doc-translate export task=${selectedTaskId} format=${exportFormat}`,
    )
    setExporting(true)
    try {
      const params = new URLSearchParams({
        taskId: selectedTaskId,
        format: exportFormat,
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
      const task = tasks.find((t) => t.id === selectedTaskId)
      a.download = fileNameForFormat(task?.name, exportFormat)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      pushToast({ kind: 'success', message: '导出成功' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast({ kind: 'error', message: `导出失败：${msg}` })
    } finally {
      setExporting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, exportFormat, sourceLang, targetLang, tasks, pushToast])

  // ==== Export handlers ====
  const handleReset = useCallback(() => {
    setJobId(null)
    setTranslateError(null)
    setStartedAtIso(null)
    setGlossaryHits(0)
    setTmHits(0)
    // 通过 props 回流到父组件（URL state 同步由 DocTranslateMode 负责）
    onStageChange('pick')
    pushToast({ kind: 'info', message: '已重置，可重新选择文件' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStageChange, pushToast])

  // 当前任务的引用（review 阶段需要）
  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId])

  // ===== 渲染 =====
  const stages = ['pick', 'translating', 'review', 'export'] as const
  const stageIndex = stages.indexOf(stage)

  return (
    <div
      className={`oa-doc-stage-panel ${className ?? ''}`.trim()}
      data-testid="oa-doc-stage-panel"
      data-stage={stage}
    >
      {/* 顶部：阶段指示器 */}
      <header className="oa-doc-stage-panel-header">
        <StageIndicator
          current={stage}
          onChange={(s) => onStageChange(s)}
        />
      </header>

      <main className="oa-doc-stage-panel-body">
        {stage === 'pick' && (
          <section
            className="oa-doc-stage-pick"
            data-testid="oa-doc-stage-pick"
            aria-label="选择文件"
          >
            <div className="oa-doc-stage-pick-toolbar">
              <label className="oa-doc-stage-pick-field">
                <span>源语言</span>
                <select
                  className="oa-doc-stage-pick-select"
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value as LangCode)}
                  data-testid="oa-doc-stage-source-lang"
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="oa-doc-stage-pick-field">
                <span>目标语言</span>
                <select
                  className="oa-doc-stage-pick-select"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value as LangCode)}
                  data-testid="oa-doc-stage-target-lang"
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {docTasks.length > 0 ? (
              <div className="oa-doc-stage-pick-task">
                <label className="oa-doc-stage-pick-field">
                  <span>选择文件</span>
                  <select
                    className="oa-doc-stage-pick-select"
                    value={selectedTaskId ?? ''}
                    onChange={(e) => setSelectedTaskId(e.target.value || undefined)}
                    data-testid="oa-doc-stage-task-select"
                  >
                    <option value="">— 选择已上传文件 —</option>
                    {docTasks.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div
                className="oa-doc-stage-pick-empty"
                data-testid="oa-doc-stage-pick-empty"
              >
                请先在「文件」页面上传文档（docx / pdf / pptx / xlsx / txt / md）
              </div>
            )}

            <div className="oa-doc-stage-pick-preview">
              <DocPreviewPane
                mode="source"
                pageRange={[1, 2]}
                taskId={selectedTaskId}
              />
            </div>

            {translateError && (
              <div
                className="oa-doc-stage-error"
                role="alert"
                data-testid="oa-doc-stage-error"
              >
                {translateError}
              </div>
            )}

            <div className="oa-doc-stage-pick-actions">
              <button
                type="button"
                className="oa-btn-primary"
                onClick={handleStartTranslate}
                disabled={!selectedTaskId || translating}
                data-testid="oa-doc-stage-start"
              >
                {translating ? '启动中…' : '开始翻译'}
              </button>
            </div>
          </section>
        )}

        {stage === 'translating' && jobId && (
          <section
            className="oa-doc-stage-translating"
            data-testid="oa-doc-stage-translating"
            aria-label="翻译中"
          >
            <DocTranslateProgress
              jobId={jobId}
              status={mapJobStatusToProgressStatus(job.status)}
              percent={percent}
              eta={eta}
              completed={job.completed}
              total={job.total}
              glossaryHits={glossaryHits}
              tmHits={tmHits}
              error={translateError ?? job.error}
              onCancel={handleCancel}
              onExportPartial={() => undefined}
            />
            <div className="oa-doc-stage-translating-preview">
              <DocPreviewPane
                mode="source"
                pageRange={[1, 1]}
                taskId={selectedTaskId}
              />
            </div>
            {startedAtIso && (
              <div
                className="oa-doc-stage-translating-meta"
                data-testid="oa-doc-stage-translating-meta"
              >
                启动时间：{startedAtIso} · job={jobId}
              </div>
            )}
          </section>
        )}

        {stage === 'review' && selectedTaskId && (
          <section
            className="oa-doc-stage-review"
            data-testid="oa-doc-stage-review"
            aria-label="校对"
          >
            <ResizableSplit
              storageKey={`translate-doc-review-${selectedTaskId}`}
              direction="horizontal"
              initialRatio={0.55}
              second={
                <div className="oa-doc-stage-review-secondary" data-testid="oa-doc-stage-annotations">
                  <AnnotationList taskId={selectedTaskId} />
                </div>
              }
            >
              <div className="oa-doc-stage-review-primary">
                <Suspense
                  fallback={
                    <div
                      className="oa-doc-stage-review-loading"
                      data-testid="oa-translation-layout-loading"
                    >
                      加载双语对照…
                    </div>
                  }
                >
                  <TranslationLayout
                    onDownload={handleDownload}
                  />
                </Suspense>
              </div>
            </ResizableSplit>
            <div className="oa-doc-stage-review-footer">
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={() => onStageChange('pick')}
                data-testid="oa-doc-stage-review-back"
              >
                ← 返回 pick
              </button>
              <button
                type="button"
                className="oa-btn-primary"
                onClick={() => onStageChange('export')}
                data-testid="oa-doc-stage-review-next"
              >
                继续到导出 →
              </button>
            </div>
          </section>
        )}

        {stage === 'export' && (
          <section
            className="oa-doc-stage-export"
            data-testid="oa-doc-stage-export"
            aria-label="导出"
          >
            <fieldset className="oa-doc-stage-export-formats">
              <legend>输出格式</legend>
              {FORMAT_OPTIONS.map((f) => (
                <label key={f.key} className="oa-doc-stage-export-format">
                  <input
                    type="radio"
                    name="export-format"
                    value={f.key}
                    checked={exportFormat === f.key}
                    onChange={() => setExportFormat(f.key)}
                    data-testid={`oa-doc-stage-export-fmt-${f.key}`}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </fieldset>

            {selectedTask && (
              <div
                className="oa-doc-stage-export-task"
                data-testid="oa-doc-stage-export-task"
              >
                任务：<strong>{selectedTask.name}</strong> · {sourceLang} → {targetLang}
              </div>
            )}

            <div className="oa-doc-stage-export-actions">
              <button
                type="button"
                className="oa-btn-secondary"
                onClick={() => onStageChange('review')}
                data-testid="oa-doc-stage-export-back"
              >
                ← 返回校对
              </button>
              <button
                type="button"
                className="oa-btn-primary"
                onClick={handleDownload}
                disabled={exporting || !selectedTaskId}
                data-testid="oa-doc-stage-export-go"
              >
                {exporting ? '导出中…' : '导出'}
              </button>
              <button
                type="button"
                className="oa-btn-ghost"
                onClick={handleReset}
                data-testid="oa-doc-stage-export-finish"
              >
                完成（回到 pick）
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

/** 把 useTranslateJob 的 status 缩减为 DocTranslateProgress 接受的 6 个枚举 */
function mapJobStatusToProgressStatus(s: import('../hooks/useTranslateJob').TranslateJobStatus): import('../components/DocTranslateProgress').DocTranslateStatus {
  if (s === 'paused' || s === 'resumed') return 'running'
  return s
}

/** 计算 ETA 文本（中文） */
function computeEtaForStatus(job: {
  status: string
  completed: number
  total: number
  frames: Array<{ ts: number; seq: number; kind?: string }>
}): string {
  if (job.status === 'finished') return '完成'
  if (job.status === 'failed') return '失败'
  if (job.status === 'cancelled') return '已取消'
  if (!job.total || job.completed >= job.total) return '—'
  if (job.frames.length < 2) return '计算中…'
  const startedFrame = job.frames.find((f) => f.kind === 'started')
  const lastFrame = job.frames[job.frames.length - 1]
  if (!startedFrame || !lastFrame) return '—'
  const elapsed = lastFrame.ts - startedFrame.ts
  if (elapsed <= 0) return '—'
  const msPerPage = elapsed / Math.max(1, job.completed)
  const remainingPages = job.total - job.completed
  const etaSec = Math.round((msPerPage * remainingPages) / 1000)
  if (etaSec < 1) return '即将完成'
  if (etaSec < 60) return `约 ${etaSec}s`
  return `约 ${Math.round(etaSec / 60)}m ${etaSec % 60}s`
}
