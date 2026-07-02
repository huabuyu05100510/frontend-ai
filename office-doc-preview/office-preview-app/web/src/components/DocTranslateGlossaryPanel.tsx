// 模型：claude-sonnet-4-6
// DocTranslateGlossaryPanel — Term list + CSV import + apply button

import { useGlossary } from '../hooks/useGlossary'

export interface DocTranslateGlossaryPanelProps {
  sourceLang: string
  targetLang: string
  onApplyToTranslate: (glossaryId: string) => void
}

export function DocTranslateGlossaryPanel({ sourceLang, targetLang, onApplyToTranslate }: DocTranslateGlossaryPanelProps) {
  const { terms, loading, add, remove, importCsv } = useGlossary(sourceLang, targetLang)
  const fileInputId = 'doc-translate-glossary-file-input'

  return (
    <div className="xf-doc-translate-glossary-panel" data-testid="doc-translate-glossary-panel">
      <div className="xf-doc-translate-panel-header">
        <h3>术语表 <span className="xf-doc-translate-panel-count">({terms.length})</span></h3>
        <div className="xf-doc-translate-panel-actions">
          <button
            type="button"
            className="xf-btn"
            onClick={() => document.getElementById(fileInputId)?.click()}
            data-testid="doc-translate-glossary-import"
          >
            导入 CSV
          </button>
          <button
            type="button"
            className="xf-btn xf-btn-solid"
            onClick={() => onApplyToTranslate('current')}
            data-testid="doc-translate-glossary-apply"
          >
            应用于本次翻译
          </button>
          <input
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            data-testid="doc-translate-glossary-file"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) await importCsv(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="xf-doc-translate-loading">加载中…</div>
      ) : terms.length === 0 ? (
        <div className="xf-doc-translate-empty" data-testid="doc-translate-glossary-empty">
          暂无术语，可点击「导入 CSV」从文件批量添加。
        </div>
      ) : (
        <ul className="xf-doc-translate-glossary-list">
          {terms.map(t => (
            <li key={t.id} className="xf-doc-translate-glossary-row" data-testid={`doc-translate-glossary-row-${t.id}`}>
              <span className="xf-doc-translate-glossary-source">{t.source}</span>
              <span className="xf-doc-translate-glossary-arrow">→</span>
              <span className="xf-doc-translate-glossary-target">{t.target}</span>
              {t.pos ? <span className="xf-doc-translate-glossary-pos">{t.pos}</span> : null}
              <button
                type="button"
                className="xf-btn xf-btn-link"
                onClick={() => remove(t.id)}
                aria-label={`删除术语 ${t.source}`}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
