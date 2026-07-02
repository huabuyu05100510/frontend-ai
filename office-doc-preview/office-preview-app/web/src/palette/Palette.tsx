// 模型：claude-sonnet-4-6
// Palette — modal-like UI for ⌘K command palette
// Phase 1.C: skeleton UI; Phase 2.B will add 3 more sources

import { useState, useMemo, useEffect, useRef } from 'react'
import { paletteRegistry, type PaletteItem } from './registry'
import type { UsePaletteResult } from './usePalette'

export interface PaletteProps {
  palette: UsePaletteResult
}

export function Palette({ palette }: PaletteProps) {
  const [query, setQuery] = useState('')
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    if (!palette.isOpen) return []
    return paletteRegistry.search(query)
  }, [palette.isOpen, query])

  // Group results by group label — always called to preserve hook order
  const grouped = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    for (const item of results) {
      const list = map.get(item.group) ?? []
      list.push(item)
      map.set(item.group, list)
    }
    return Array.from(map.entries())
  }, [results])

  // Reset state when opening
  useEffect(() => {
    if (palette.isOpen) {
      setQuery('')
      setHighlightedIdx(0)
      // Focus input after render
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [palette.isOpen])

  // Clamp highlighted index to results length
  useEffect(() => {
    if (highlightedIdx >= results.length) {
      setHighlightedIdx(Math.max(0, results.length - 1))
    }
  }, [results.length, highlightedIdx])

  if (!palette.isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && results[highlightedIdx]) {
      e.preventDefault()
      results[highlightedIdx].action()
      palette.close()
    }
  }

  let runningIdx = -1

  return (
    <div className="oa-palette-mask" onClick={palette.close}>
      <div className="oa-palette" onClick={e => e.stopPropagation()} data-testid="palette">
        <input
          ref={inputRef}
          className="oa-palette-input"
          type="text"
          placeholder="搜索命令、文件、操作…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="palette-input"
        />
        <div className="oa-palette-list">
          {results.length === 0 && (
            <div className="oa-palette-empty">无匹配项</div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="oa-palette-group">
              <div className="oa-palette-group-title">{group}</div>
              {items.map(item => {
                runningIdx++
                const isHighlighted = runningIdx === highlightedIdx
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`oa-palette-item ${isHighlighted ? 'highlighted' : ''}`}
                    onClick={() => { item.action(); palette.close() }}
                    onMouseEnter={() => setHighlightedIdx(runningIdx)}
                  >
                    <span className="oa-palette-item-title">{item.title}</span>
                    {item.subtitle && (
                      <span className="oa-palette-item-subtitle">{item.subtitle}</span>
                    )}
                    {item.shortcut && (
                      <span className="oa-palette-item-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

Palette.displayName = 'Palette'