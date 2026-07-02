// AI Platform — Sidebar Shell + 4 Modules
// 模型：claude-sonnet-4-6
import { useState } from 'react'
import { FilesPage } from './pages/FilesPage'
import { TranslationPage } from './pages/TranslationPage'
import { QualityCheckPage } from './pages/QualityCheckPage'
import { OCRPage } from './pages/OCRPage'

type NavKey = 'files' | 'translate' | 'qc' | 'ocr'

const NAV: { key: NavKey; label: string; icon: string; desc: string }[] = [
  { key: 'files', label: '文档预览', icon: '📄', desc: '上传 & 预览' },
  { key: 'translate', label: '智能翻译', icon: '🌐', desc: 'AI 翻译平台' },
  { key: 'qc', label: '文本校对', icon: '✅', desc: '智检 · 合规' },
  { key: 'ocr', label: 'OCR 识别', icon: '🔍', desc: '图片文字识别' },
]

export default function App() {
  const [nav, setNav] = useState<NavKey>('files')

  return (
    <div className="plt-shell">
      <aside className="plt-sidebar">
        <div className="plt-sidebar-brand">
          <span className="plt-sidebar-logo">📊</span>
          <div className="plt-sidebar-title">AI Office</div>
          <div className="plt-sidebar-sub">智能文档平台</div>
        </div>
        <nav className="plt-nav">
          {NAV.map(item => (
            <button
              key={item.key}
              className={`plt-nav-item ${nav === item.key ? 'on' : ''}`}
              onClick={() => setNav(item.key)}
            >
              <span className="plt-nav-icon">{item.icon}</span>
              <div className="plt-nav-text">
                <div className="plt-nav-label">{item.label}</div>
                <div className="plt-nav-desc">{item.desc}</div>
              </div>
            </button>
          ))}
        </nav>
        <div className="plt-sidebar-footer">
          <div className="plt-sidebar-ver">v2.0 · AI 增强</div>
        </div>
      </aside>
      <main className="plt-main">
        {nav === 'files' && <FilesPage />}
        {nav === 'translate' && <TranslationPage />}
        {nav === 'qc' && <QualityCheckPage />}
        {nav === 'ocr' && <OCRPage />}
      </main>
    </div>
  )
}
