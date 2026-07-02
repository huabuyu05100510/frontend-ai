// TopBar — 顶栏（品牌 + 搜索 + AI 健康状态 + 用户区）
// 模型：claude-sonnet-4-6
import React from 'react'
import { SearchIcon, LayersIcon, OfficeIcon } from '../design/icons'
import { useTheme } from '../hooks/useTheme'
import { ThemeToggle } from './ThemeToggle'
import { usePalette } from '../palette'

export interface TopBarHealth {
  status: 'ok' | 'degraded'
  reason?: string | null
  translate?: { ok?: boolean; providers: string[] }
  ocr?: { ok?: boolean; providers: string[] }
}

export interface TopBarProps {
  /** 当前激活的菜单 key（用于面包屑 / 标题） */
  activeLabel: string
  /** AI 服务健康状态 */
  health?: TopBarHealth
  /** 搜索（可选） — 如提供则调用；如未提供则默认打开命令面板 */
  onSearch?: (q: string) => void
}

export const TopBar: React.FC<TopBarProps> = ({ activeLabel, health, onSearch }) => {
  const [q, setQ] = React.useState('')
  const { theme, toggleTheme } = useTheme()
  const palette = usePalette()

  const handleSearchActivate = () => {
    // 未提供 onSearch 时，触发命令面板（⌘K palette）
    if (!onSearch) palette.open()
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter 键在未提供 onSearch 时也触发 palette
    if (e.key === 'Enter' && !onSearch) {
      palette.open()
    }
  }

  return (
    <header className="oa-topbar">
      <a href="#main-content" className="oa-skip-link">跳到主要内容</a>

      <div className="oa-topbar-left">
        <div className="oa-topbar-brand">
          <div className="oa-topbar-brand-logo">
            <OfficeIcon size={20} />
          </div>
          <div className="oa-topbar-brand-text">
            <span className="oa-topbar-brand-name">Office AI</span>
            <span className="oa-topbar-brand-tag">{activeLabel} · v5.0</span>
          </div>
        </div>
      </div>

      <div className="oa-topbar-search">
        <span className="oa-topbar-search-icon">
          <SearchIcon size={16} />
        </span>
        <input
          type="search"
          placeholder="搜索文件、翻译任务、智检记录…  按 ⌘K 打开命令面板"
          value={q}
          onChange={e => { setQ(e.target.value); onSearch?.(e.target.value) }}
          onFocus={handleSearchActivate}
          onClick={handleSearchActivate}
          onKeyDown={handleSearchKeyDown}
          aria-label="全局搜索（⌘K 打开命令面板）"
        />
        <kbd className="oa-kbd oa-topbar-kbd" aria-hidden="true">⌘K</kbd>
      </div>

      <div className="oa-topbar-actions">
        <ThemeToggle onClick={toggleTheme} theme={theme} />
        {health && (
          <span
            className={`oa-topbar-badge ${health.status === 'degraded' ? 'degraded' : ''}`}
            title={health.reason || `翻译 ${health.translate?.providers.length || 0} 个 · OCR ${health.ocr?.providers.length || 0} 个`}
          >
            <span className="oa-topbar-badge-dot" />
            AI · {health.status === 'ok' ? '已就绪' : '降级模式'}
          </span>
        )}
        <button className="oa-btn oa-btn-ghost oa-btn-sm" title="了解更多">
          <LayersIcon size={14} />
        </button>
      </div>
    </header>
  )
}

TopBar.displayName = 'TopBar'