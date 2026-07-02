// 双栏对比模式外层布局 — 格式工具条 + 列标题 + picker / DualColumnView / DualImageColumn
// 从 InspectCompareModal 提取（重构后独立组件）
// 模型：claude-sonnet-4-6
import type { Task, InspectDiffResponse } from '../types'
import { DualColumnView } from './DualColumnView'
import { DualImageColumn } from './DualImageColumn'
import { FilePicker } from './FilePicker'

interface Props {
  source: Task
  compare: Task | null
  diff: InspectDiffResponse | null
  loading: boolean
  loadError: string | null
  onRetry: () => void
}

/** 判断 task 是否有栅格化页面（可用于原文件布局渲染） */
function hasPages(t: Task | null): boolean {
  return !!(t?.pages && t.pages.length > 0)
}

export function DualLayout({ source, compare, diff, loading, loadError, onRetry }: Props) {
  // 有页面数据 → 原文件布局双栏（图片+文字层+差异高亮）
  const useImageMode = hasPages(source) && hasPages(compare)

  return (
    <div className="icm-dual-layout">

      {/* 格式工具条（翻译对比设计稿） */}
      <div className="icm-format-bar">
        <div className="icm-format-tools">
          {(['B', 'I', 'U', 'S', 'X²', 'X₂'] as const).map((t, i) => (
            <button key={i} type="button" className="icm-fmt-btn">{t}</button>
          ))}
          <span className="icm-fmt-sep" />
          <button type="button" className="icm-fmt-btn-text">原文对照</button>
          <button type="button" className="icm-fmt-btn-text">AI辅助</button>
        </div>
        <div className="icm-format-right">
          <span className="icm-zoom-label">100%</span>
          <button type="button" className="icm-btn-ai">AI翻译</button>
          <select className="icm-lang-select" aria-label="语言切换">
            <option>中文（简体）</option>
            <option>English</option>
          </select>
        </div>
      </div>

      {/* 列标题（源 / 目标 文件名） */}
      <div className="icm-dual-colheads">
        <div className="icm-colhead">
          <span className="icm-pane-badge icm-pane-src">源</span>
          <span className="icm-pane-name" title={source.name}>{source.name}</span>
        </div>
        <div className="icm-colhead-div" />
        <div className="icm-colhead">
          <span className="icm-pane-badge icm-pane-tgt">目标</span>
          <span className="icm-pane-name" title={compare?.name || source.name}>
            {compare?.name || source.name}
          </span>
        </div>
      </div>

      {/* 双栏模式但没选对比文件 → 文件选择器 */}
      {!compare ? (
        <FilePicker sourceId={source.id} sourceName={source.name} />
      ) : useImageMode ? (
        /* 原文件布局：左右各显示完整文档（图片+文字层+差异高亮） */
        <DualImageColumn source={source} compare={compare} diff={diff} />
      ) : (
        /* 纯文本 fallback（txt/md 等无 pages 的文件） */
        <DualColumnView
          diff={diff}
          loading={loading}
          loadError={loadError}
          onRetry={onRetry}
        />
      )}
    </div>
  )
}
