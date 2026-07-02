// 双栏模式：文件选择器（compare=null 时显示）
// 模型：claude-sonnet-4-6
import { useStore } from '../store'
import type { Task } from '../types'

interface Props {
  sourceId: string
  sourceName: string
}

/** 文件类型 → 简短图标字 */
export function fileGlyph(ext: string): string {
  const e = (ext || '').toLowerCase()
  if (['txt', 'md'].includes(e)) return '📄'
  if (['pdf'].includes(e)) return '📕'
  if (['doc', 'docx'].includes(e)) return '📘'
  if (['ppt', 'pptx'].includes(e)) return '📗'
  if (['xls', 'xlsx'].includes(e)) return '📊'
  return '📄'
}

export function FilePicker({ sourceId, sourceName }: Props) {
  const tasks = useStore(s => s.tasks)
  const setInspectCompare = useStore(s => s.setInspectCompare)
  const candidates = tasks.filter(t => t.id !== sourceId)

  return (
    <div className="icm-picker" data-testid="inspect-compare-picker">
      <div className="icm-picker-hd">
        <span className="icm-picker-title">选择要对比的第二个文件</span>
        <span className="icm-picker-sub">源文件：<b>{sourceName}</b></span>
      </div>
      <ul className="icm-picker-list">
        {candidates.map(t => (
          <li key={t.id}>
            <button
              type="button"
              className="icm-picker-item"
              data-testid={`inspect-compare-pick-${t.id}`}
              onClick={() => setInspectCompare(t)}
            >
              <span className="icm-picker-icon">{fileGlyph(t.ext)}</span>
              <span className="icm-picker-name" title={t.name}>{t.name}</span>
              <span className="icm-picker-ext">{t.ext}</span>
            </button>
          </li>
        ))}
        {candidates.length === 0 && (
          <li className="icm-picker-empty">没有其他可对比的文件，请先上传第二个文件。</li>
        )}
      </ul>
    </div>
  )
}
