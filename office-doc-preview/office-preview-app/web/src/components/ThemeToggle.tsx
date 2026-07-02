// 模型：claude-sonnet-4-6
// ThemeToggle — Sun/Moon icon button to flip theme

import React from 'react'

export interface ThemeToggleProps {
  onClick: () => void
  theme?: 'light' | 'dark'
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ onClick, theme }) => {
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      className="oa-theme-toggle"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

ThemeToggle.displayName = 'ThemeToggle'
