import React from 'react'

interface ToolbarProps {
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onExportMD: () => void
  onExportHTML: () => void
  onVersionHistory: () => void
  onTogglePerf: () => void
  perfVisible: boolean
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#cdd6f4',
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  transition: 'background 0.15s',
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: '#45475a',
  margin: '0 4px',
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onBold, onItalic, onUnderline,
  onExportMD, onExportHTML,
  onVersionHistory, onTogglePerf, perfVisible,
}) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '8px 16px',
    background: '#181825',
    borderBottom: '1px solid #313244',
    overflowX: 'auto',
  }}>
    <span style={{ fontWeight: 700, color: '#cba6f7', fontSize: 14, marginRight: 12 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -3, marginRight: 4 }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      Office Doc Engine
    </span>

    <div style={separatorStyle} />

    <button style={btnStyle} onClick={onBold} title="加粗 (Ctrl+B)">
      <b>B</b>
    </button>
    <button style={btnStyle} onClick={onItalic} title="斜体 (Ctrl+I)">
      <i>I</i>
    </button>
    <button style={btnStyle} onClick={onUnderline} title="下划线 (Ctrl+U)">
      <u>U</u>
    </button>

    <div style={separatorStyle} />

    <button style={{ ...btnStyle, color: '#a6e3a1' }} onClick={onExportMD} title="导出 Markdown">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2 }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      MD
    </button>
    <button style={{ ...btnStyle, color: '#a6e3a1' }} onClick={onExportHTML} title="导出 HTML">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2 }}>
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
      HTML
    </button>

    <div style={separatorStyle} />

    <button style={{ ...btnStyle, color: '#fab387' }} onClick={onVersionHistory} title="版本历史">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2 }}>
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      历史
    </button>

    <div style={{ flex: 1 }} />

    <button
      style={{ ...btnStyle, color: perfVisible ? '#89b4fa' : '#6c7086' }}
      onClick={onTogglePerf}
      title="性能面板"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2 }}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      Perf
    </button>
  </div>
)