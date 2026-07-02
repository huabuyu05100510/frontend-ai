// 模型：claude-sonnet-4-6
// DocTranslateTaskPanel — File picker + lang selects + format checkboxes + start

import type { Task, LangCode, DocTranslateFormat } from '../types'
import { FileTextIcon, UploadIcon } from '../design/icons'

export interface DocTranslateTaskPanelProps {
  tasks: Task[]
  selectedTask: Task | null
  onSelectTask: (task: Task) => void
  sourceLang: string
  targetLang: string
  onChangeSourceLang: (lang: string) => void
  onChangeTargetLang: (lang: string) => void
  formats: DocTranslateFormat[]
  onToggleFormat: (fmt: DocTranslateFormat) => void
  onStartTranslate: () => void
  busy: boolean
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
  { key: 'target-pdf', label: '纯译文 PDF' },
  { key: 'vtt', label: '字幕 VTT' },
]

export function DocTranslateTaskPanel(props: DocTranslateTaskPanelProps) {
  const { tasks, selectedTask, onSelectTask, sourceLang, targetLang, onChangeSourceLang, onChangeTargetLang, formats, onToggleFormat, onStartTranslate, busy } = props

  return (
    <div className="xf-doc-translate-task-panel" data-testid="doc-translate-task-panel">
      <div className="xf-doc-translate-toolbar">
        <select
          className="xf-select"
          value={sourceLang}
          onChange={e => onChangeSourceLang(e.target.value)}
          data-testid="doc-translate-source-lang"
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <span className="xf-doc-translate-arrow">→</span>
        <select
          className="xf-select"
          value={targetLang}
          onChange={e => onChangeTargetLang(e.target.value)}
          data-testid="doc-translate-target-lang"
        >
          {LANG_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </div>

      <div className="xf-doc-translate-formats">
        {FORMAT_OPTIONS.map(f => (
          <label key={f.key} className="xf-doc-translate-format-item">
            <input
              type="checkbox"
              checked={formats.includes(f.key)}
              onChange={() => onToggleFormat(f.key)}
              data-testid={`doc-translate-fmt-${f.key}`}
            />
            <span>{f.label}</span>
          </label>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="xf-empty" data-testid="doc-translate-empty">
          <div className="xf-empty-icon"><UploadIcon size={32} /></div>
          <div className="xf-empty-title">暂无可翻译文档</div>
          <div className="xf-empty-desc">请先在「文档预览」上传文件</div>
        </div>
      ) : (
        <div className="xf-doc-translate-file-grid" data-testid="doc-translate-file-grid">
          {tasks.map(t => (
            <div
              key={t.id}
              className={`xf-file-card${selectedTask?.id === t.id ? ' selected' : ''}`}
              onClick={() => onSelectTask(t)}
              data-testid={`doc-translate-card-${t.id}`}
            >
              <div className="xf-file-card-icon"><FileTextIcon size={24} /></div>
              <div className="xf-file-card-name">{t.name}</div>
              <div className="xf-file-card-ext">{t.ext.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}

      <div className="xf-doc-translate-actions">
        <button
          className="xf-btn-solid"
          onClick={onStartTranslate}
          disabled={!selectedTask || busy}
          data-testid="doc-translate-start"
          type="button"
        >
          {busy ? '翻译中…' : '开始翻译'}
        </button>
      </div>
    </div>
  )
}
