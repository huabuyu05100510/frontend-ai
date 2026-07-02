// 模型：claude-sonnet-4-6
// DocTranslateMemoryPanel — TM list + threshold slider

import { useState } from 'react'
import { useTranslationMemory } from '../hooks/useTranslationMemory'

export interface DocTranslateMemoryPanelProps {
  sourceLang: string
  targetLang: string
}

export function DocTranslateMemoryPanel({ sourceLang, targetLang }: DocTranslateMemoryPanelProps) {
  const { entries, loading } = useTranslationMemory(sourceLang, targetLang)
  const [threshold, setThreshold] = useState(0.7)

  return (
    <div className="xf-doc-translate-memory-panel" data-testid="doc-translate-memory-panel">
      <div className="xf-doc-translate-panel-header">
        <h3>翻译记忆 <span className="xf-doc-translate-panel-count">({entries.length})</span></h3>
        <div className="xf-doc-translate-panel-actions">
          <label className="xf-doc-translate-threshold">
            阈值 {threshold.toFixed(2)}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              data-testid="doc-translate-memory-threshold"
            />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="xf-doc-translate-loading">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="xf-doc-translate-empty" data-testid="doc-translate-memory-empty">
          暂无翻译记忆，可在「实时翻译」中点击「👍」沉淀高频句对。
        </div>
      ) : (
        <ul className="xf-doc-translate-memory-list">
          {entries.map(e => (
            <li key={e.id} className="xf-doc-translate-memory-row" data-testid={`doc-translate-memory-row-${e.id}`}>
              <span className="xf-doc-translate-memory-source">{e.source}</span>
              <span className="xf-doc-translate-memory-arrow">→</span>
              <span className="xf-doc-translate-memory-target">{e.target}</span>
              {typeof e.score === 'number' ? <span className="xf-doc-translate-memory-score">{(e.score * 100).toFixed(0)}%</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
