// 模型：claude-sonnet-4-6
// DocPreviewPane — 文档双语预览面板（source / target / dual）
//
// 3 种 mode:
//   - source: 仅显示原文（按 pageRange 渲染 N 页）
//   - target: 仅显示译文 + 下载按钮（若提供 onDownload）
//   - dual:   双栏 1:1（左右 grid，不接 ResizableSplit — 留给 Phase A.2 agent）
//
// 图片源: GET /api/files/:taskId/preview?as=page&n={N}（PNG lazy 加载）
// 日志:   [translate-ui ISO] doc-preview mode=… pages=… task=…

import React, { useEffect, useMemo } from 'react'

export type DocPreviewMode = 'source' | 'target' | 'dual'

export interface DocPreviewPaneProps {
  taskId?: string
  pageRange?: [number, number] // 1-based inclusive, default [1, 2]
  mode?: DocPreviewMode         // default 'source'
  /** 目标模式下显示下载按钮（若提供） */
  onDownload?: () => void
  /** 下载按钮 tooltip 文案（默认 '下载双语 DOCX'） */
  downloadLabel?: string
  className?: string
}

const PAGE_LABELS: Record<DocPreviewMode, string> = {
  source: '原文',
  target: '译文',
  dual: '双语',
}

/** 从 [start, end] inclusive 生成页号数组 */
function pagesFromRange(range: [number, number]): number[] {
  const [s, e] = range
  const start = Math.max(1, Math.min(s, e))
  const end = Math.max(s, e)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

/** 单页预览（图片 + 状态指示） */
function PreviewPage({ taskId, page }: { taskId: string; page: number }) {
  const src = `/api/files/${encodeURIComponent(taskId)}/preview?as=page&n=${page}`
  return (
    <div
      data-testid={`oa-doc-preview-page-${page}`}
      className="oa-doc-preview-page"
    >
      <div className="oa-doc-preview-page-header">
        <span className="oa-doc-preview-page-num">第 {page} 页</span>
        <span className="oa-doc-preview-page-status">加载中…</span>
      </div>
      <div className="oa-doc-preview-page-body">
        <img
          src={src}
          alt={`文档第 ${page} 页预览`}
          loading="lazy"
          decoding="async"
          className="oa-doc-preview-image"
          onLoad={(e) => {
            // img 在 .oa-doc-preview-page-body 里，status 在同级 .oa-doc-preview-page-header 里
            // 所以需要先 closest() 到 .oa-doc-preview-page 容器，再 querySelector 找 status
            const status = (e.currentTarget.closest('.oa-doc-preview-page')?.querySelector(
              '.oa-doc-preview-page-status',
            ) as HTMLElement | null)
            if (status) status.textContent = '已加载'
          }}
          onError={(e) => {
            const status = (e.currentTarget.closest('.oa-doc-preview-page')?.querySelector(
              '.oa-doc-preview-page-status',
            ) as HTMLElement | null)
            if (status) status.textContent = '加载失败'
          }}
        />
      </div>
    </div>
  )
}

/**
 * 文档预览面板
 *
 * - 无 taskId → 占位态（不渲染 page）
 * - source: 单列 N 页
 * - target: 单列 N 页 + 下载按钮（若 onDownload 提供）
 * - dual:   两列（原文左 + 译文右），CSS grid 1fr 1fr；暂不用 ResizableSplit
 */
export function DocPreviewPane({
  taskId,
  pageRange = [1, 2],
  mode = 'source',
  onDownload,
  downloadLabel = '下载双语 DOCX',
  className,
}: DocPreviewPaneProps) {
  const pages = useMemo(() => pagesFromRange(pageRange), [pageRange])

  // 日志：挂载/参数变更时打印一次
  useEffect(() => {
    if (!taskId) return
    const pagesLabel = `${pages[0]}-${pages[pages.length - 1]}`
    console.info(
      `[translate-ui ${new Date().toISOString()}] doc-preview mode=${mode} pages=${pagesLabel} task=${taskId}`,
    )
  }, [taskId, mode, pages])

  // 占位态（无 taskId）
  if (!taskId) {
    return (
      <div
        data-testid="oa-doc-preview"
        data-mode="placeholder"
        className={`oa-doc-preview oa-doc-preview--placeholder ${className ?? ''}`.trim()}
      >
        <div className="oa-doc-preview-empty">
          <span className="oa-doc-preview-empty-icon" aria-hidden="true">📄</span>
          <p className="oa-doc-preview-empty-text">请先选择文件</p>
          <p className="oa-doc-preview-empty-hint">上传文件后可在此预览前几页</p>
        </div>
      </div>
    )
  }

  const showDownload = !!onDownload && (mode === 'target' || mode === 'dual')
  const rootMode = mode

  // dual: 1 个外层 grid，每个 cell 内含该模式的 N 页
  if (mode === 'dual') {
    return (
      <div
        data-testid="oa-doc-preview"
        data-mode={rootMode}
        className={`oa-doc-preview ${className ?? ''}`.trim()}
      >
        <div className="oa-doc-preview-header">
          <DocPreviewModeSwitcher active={mode} />
          {showDownload && (
            <button
              type="button"
              data-testid="oa-doc-preview-download"
              className="oa-doc-preview-download"
              onClick={onDownload}
              title={downloadLabel}
            >
              <span aria-hidden="true">⬇</span> {downloadLabel}
            </button>
          )}
        </div>
        <div className="oa-doc-preview-grid oa-doc-preview-grid--dual">
          <section className="oa-doc-preview-column" aria-label="原文">
            <header className="oa-doc-preview-column-header">{PAGE_LABELS.source}</header>
            {pages.map((p) => <PreviewPage key={`src-${p}`} taskId={taskId} page={p} />)}
          </section>
          <section className="oa-doc-preview-column" aria-label="译文">
            <header className="oa-doc-preview-column-header">{PAGE_LABELS.target}</header>
            {pages.map((p) => <PreviewPage key={`tgt-${p}`} taskId={taskId} page={p} />)}
          </section>
        </div>
      </div>
    )
  }

  // source / target: 单列
  return (
    <div
      data-testid="oa-doc-preview"
      data-mode={rootMode}
      className={`oa-doc-preview ${className ?? ''}`.trim()}
    >
      <div className="oa-doc-preview-header">
        <DocPreviewModeSwitcher active={mode} />
        {showDownload && (
          <button
            type="button"
            data-testid="oa-doc-preview-download"
            className="oa-doc-preview-download"
            onClick={onDownload}
            title={downloadLabel}
          >
            <span aria-hidden="true">⬇</span> {downloadLabel}
          </button>
        )}
      </div>
      <div className="oa-doc-preview-grid oa-doc-preview-grid--single">
        {pages.map((p) => <PreviewPage key={`${rootMode}-${p}`} taskId={taskId} page={p} />)}
      </div>
    </div>
  )
}

/**
 * 内嵌 3 按钮 mode 切换器（source/target/dual）
 * 注: 这是视觉占位。真正的 mode 切换由容器组件（DocTranslateStagePanel）控制，
 *  本组件只通过 props 接收 mode。本组件内仍渲染切换器以提示用户可切换。
 */
function DocPreviewModeSwitcher({ active }: { active: DocPreviewMode }) {
  return (
    <div className="oa-doc-preview-mode-switcher" role="tablist" aria-label="预览模式">
      {(['source', 'target', 'dual'] as DocPreviewMode[]).map((m) => (
        <button
          type="button"
          key={m}
          role="tab"
          aria-selected={active === m}
          data-testid={`oa-doc-preview-mode-${m}`}
          className={`oa-doc-preview-mode-switch ${active === m ? 'is-active' : ''}`}
        >
          {PAGE_LABELS[m]}
        </button>
      ))}
    </div>
  )
}