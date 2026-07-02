import { useState, useEffect, useCallback } from 'react'
import type { PageTranslationState, TranslationMode, LangCode } from '../shared/types'

const ANNO_ENABLED_KEY = 'xtAnnotationEnabled'

// ─── 支持语言 ──────────────────────────────────────────────
const LANGUAGES: Array<{ code: LangCode; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
]

const DEFAULT_STATE: PageTranslationState = {
  active: false,
  mode: 'bilingual',
  srcLang: 'auto',
  tgtLang: 'zh',
  progress: 0,
  total: 0,
  translated: 0,
}

export default function App() {
  const [pageState, setPageState] = useState<PageTranslationState>(DEFAULT_STATE)
  const [tgtLang, setTgtLang] = useState<LangCode>('zh')
  const [mode, setMode] = useState<TranslationMode>('bilingual')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)
  const [annoEnabled, setAnnoEnabled] = useState(true)
  // A7: 沉浸式 4 tab
  const [activeTab, setActiveTab] = useState<'translate' | 'annotation' | 'settings' | 'about'>('translate')
  const [pageUrl, setPageUrl] = useState<string>('')
  const [pageTitle, setPageTitle] = useState<string>('')

  // 注意：旧 key 已外泄，部署前必须轮换。
  // 安全策略：① 不再写 storage.sync（避免 Google 帐号跨设备同步）
  //          ② 用户未配置时 background.ts 用 HARDCODED_API_KEY fallback 兜底
  // 用户填了 key 走 storage.local；没填也能跑（fallback）

  const isKeyValid = apiKey.startsWith('sk-') && apiKey.length >= 10

  // ── 初始化：读取当前 tab 状态 + 存储的配置 ──────────────
  useEffect(() => {
    chrome.storage.local.get(['xt_api_key', 'xt_tgt_lang', 'xt_mode']).then(result => {
      const key = (result.xt_api_key as string) || ''
      setApiKey(key)
      if (key) {
        console.log(JSON.stringify({ ts: Date.now(), level: 'info', component: 'xt:popup', msg: 'key loaded', masked: '***' + key.slice(-4) }))
      } else {
        console.log(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'xt:popup', msg: 'key missing' }))
      }
      if (result.xt_tgt_lang) setTgtLang(result.xt_tgt_lang as LangCode)
      if (result.xt_mode) setMode(result.xt_mode as TranslationMode)
    })

    // Agent 8: 读取 annotation toggle 状态
    chrome.storage.sync.get([ANNO_ENABLED_KEY]).then(r => {
      const v = r[ANNO_ENABLED_KEY]
      // 默认开启（undefined / null = true）
      setAnnoEnabled(v === undefined || v === null ? true : Boolean(v))
    })

    sendToContent({ type: 'GET_STATE' }).then(state => {
      if (state) setPageState(state as PageTranslationState)
    })

    // A7: 拉取当前页 URL/标题（用于 page-info 卡片）
    chrome.tabs.query({}).then(tabs => {
      const selfTabId = tabs.find(t => t.id !== undefined)?.id
      // 取首个非扩展页的 URL/标题
      const t = tabs.find(x => x.url && !x.url.startsWith('chrome-extension://') && !x.url.startsWith('chrome://'))
      if (t?.url) setPageUrl(t.url)
      if (t?.title) setPageTitle(t.title)
      void selfTabId
    })
  }, [])

  // ── 监听翻译进度 ──────────────────────────────────────
  useEffect(() => {
    const handler = (msg: { type: string; state: PageTranslationState }) => {
      if (msg.type === 'STATE_UPDATE') setPageState(msg.state)
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // ── 操作 ──────────────────────────────────────────────
  const handleTranslate = useCallback(async () => {
    if (apiKey) {
      await chrome.storage.local.set({ xt_api_key: apiKey, xt_tgt_lang: tgtLang, xt_mode: mode })
    }
    await sendToContent({ type: 'TRANSLATE', srcLang: 'auto', tgtLang, mode })
  }, [apiKey, tgtLang, mode])

  const handleRestore = useCallback(async () => {
    await sendToContent({ type: 'RESTORE' })
  }, [])

  const handleModeChange = useCallback(async (newMode: TranslationMode) => {
    setMode(newMode)
    await chrome.storage.local.set({ xt_mode: newMode })
    if (pageState.active) {
      await sendToContent({ type: 'SET_MODE', mode: newMode })
    }
  }, [pageState.active])

  // Agent 8: 标注开关切换
  const handleAnnoToggle = useCallback(async (next: boolean) => {
    setAnnoEnabled(next)
    await chrome.storage.sync.set({ [ANNO_ENABLED_KEY]: next })
    // 广播到 content script（也走 storage.onChanged 兜底）
    chrome.runtime.sendMessage({ type: 'XT_ANNOTATION_TOGGLE', enabled: next }).catch(() => {})
  }, [])

  return (
    <div className="popup">
      {/* Header — 沉浸式品牌渐变 */}
      <header className="popup-header">
        <span className="popup-logo">🌐</span>
        <div>
          <div className="popup-title">智能网页翻译</div>
          <div className="popup-subtitle">双语对照 · 词对齐 · 标注改进</div>
        </div>
      </header>

      {/* Tab 切换 — 沉浸式 4 tab */}
      <nav className="popup-tabs" role="tablist">
        <button
          className={`popup-tab ${activeTab === 'translate' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'translate'}
          onClick={() => setActiveTab('translate')}
          data-testid="tab-translate"
        >
          🌐 翻译
        </button>
        <button
          className={`popup-tab ${activeTab === 'annotation' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'annotation'}
          onClick={() => setActiveTab('annotation')}
          data-testid="tab-annotation"
        >
          📊 标注
        </button>
        <button
          className={`popup-tab ${activeTab === 'settings' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
          data-testid="tab-settings"
        >
          ⚙️ 设置
        </button>
        <button
          className={`popup-tab ${activeTab === 'about' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'about'}
          onClick={() => setActiveTab('about')}
          data-testid="tab-about"
        >
          ℹ️ 关于
        </button>
      </nav>

      {/* ── Tab: 翻译 ─────────────────────────────────────── */}
      <div className={`tab-panel ${activeTab === 'translate' ? 'active' : ''}`} role="tabpanel">

      {/* 语言选择 */}
      <section className="popup-section">
        <div className="lang-row">
          <span className="lang-label">自动检测</span>
          <button className="swap-btn" title="交换语言">⇄</button>
          <select
            className="lang-select"
            value={tgtLang}
            onChange={e => setTgtLang(e.target.value)}
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 模式切换 */}
      <section className="popup-section">
        <div className="mode-row">
          <button
            className={`mode-btn ${mode === 'bilingual' ? 'active' : ''}`}
            onClick={() => handleModeChange('bilingual')}
          >
            双语对照
          </button>
          <button
            className={`mode-btn ${mode === 'translation-only' ? 'active' : ''}`}
            onClick={() => handleModeChange('translation-only')}
          >
            仅译文
          </button>
          <button
            className={`mode-btn ${mode === 'sidebar' ? 'active' : ''}`}
            onClick={() => handleModeChange('sidebar')}
          >
            侧边栏
          </button>
        </div>
      </section>

      {/* 进度 */}
      {pageState.active && (
        <section className="popup-section">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pageState.progress}%` }} />
          </div>
          <div className="progress-text">
            {pageState.translated}/{pageState.total} 段 · {pageState.progress}%
          </div>
        </section>
      )}

      {/* 操作按钮 */}
      <section className="popup-section">
        {!pageState.active ? (
          <button className="primary-btn" onClick={handleTranslate}>
            翻译此页面
          </button>
        ) : (
          <button className="restore-btn" onClick={handleRestore}>
            还原原文
          </button>
        )}
      </section>

      {/* Agent 8: 标注 toggle */}
      <section className="popup-section anno-toggle-section">
        <label className="anno-toggle-row">
          <span className="anno-toggle-label">
            <span className="anno-toggle-emoji">📊</span>
            <span>参与标注改进</span>
          </span>
          <button
            type="button"
            className={`toggle-switch ${annoEnabled ? 'on' : 'off'}`}
            role="switch"
            aria-checked={annoEnabled}
            aria-label="参与标注改进"
            onClick={() => handleAnnoToggle(!annoEnabled)}
            data-testid="anno-toggle"
          >
            <span className="toggle-knob" />
          </button>
        </label>
        <div className="anno-toggle-hint">
          {annoEnabled
            ? '翻译时会显示词对齐 ✏️ 和段评分 ⭐，可点选提交'
            : '已关闭。不会写入 IDB，也不会同步到后端'}
        </div>
      </section>

      </div>
      {/* ── /Tab: 翻译 ────────────────────────────────────── */}

      {/* ── Tab: 标注 ─────────────────────────────────────── */}
      <div className={`tab-panel ${activeTab === 'annotation' ? 'active' : ''}`} role="tabpanel">
        <section className="popup-section">
          <div className="section-title">标注改进</div>
          <div className="anno-toggle-section" style={{ marginTop: 0 }}>
            <label className="anno-toggle-row">
              <span className="anno-toggle-label">
                <span className="anno-toggle-emoji">📊</span>
                <span>启用标注</span>
              </span>
              <button
                type="button"
                className={`toggle-switch ${annoEnabled ? 'on' : 'off'}`}
                role="switch"
                aria-checked={annoEnabled}
                aria-label="启用标注"
                onClick={() => handleAnnoToggle(!annoEnabled)}
                data-testid="anno-toggle-tab2"
              >
                <span className="toggle-knob" />
              </button>
            </label>
            <div className="anno-toggle-hint">
              {annoEnabled
                ? 'hover 译文时显示 ✏️ 词修正 + ⭐ 段评分；数据本地写入 IDB'
                : '已关闭。不会在页面上显示标注 UI，也不会写入 IDB'}
            </div>
            <button
              type="button"
              className="export-btn"
              onClick={() => {
                chrome.runtime.sendMessage({ type: 'XT_FORCE_SYNC' }).catch(() => {})
              }}
              data-testid="export-btn"
            >
              📥 导出我的标注
            </button>
          </div>
        </section>
      </div>
      {/* ── /Tab: 标注 ────────────────────────────────────── */}

      {/* ── Tab: 设置 ─────────────────────────────────────── */}
      <div className={`tab-panel ${activeTab === 'settings' ? 'active' : ''}`} role="tabpanel">
        <section className="popup-section">
          <div className="section-title">API 配置</div>
          <button className="settings-toggle" onClick={() => setShowApiKey(v => !v)}>
            {showApiKey ? '▲' : '▼'} API Key {apiKey ? '(已配置)' : '(未配置)'}
          </button>
          {showApiKey && (
            <div className="api-key-row">
              <input
                type={keyVisible ? 'text' : 'password'}
                className="api-key-input"
                placeholder="留空则用内置 fallback key"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onBlur={() => apiKey && chrome.storage.local.set({ xt_api_key: apiKey })}
              />
              <button
                type="button"
                className="key-eye-btn"
                title={keyVisible ? '隐藏' : '显示'}
                onClick={() => setKeyVisible(v => !v)}
              >
                {keyVisible ? '🙈' : '👁'}
              </button>
            </div>
          )}
          {showApiKey && apiKey && !isKeyValid && (
            <div className="api-key-hint">⚠ Key 必须以 sk- 开头</div>
          )}
          <div className="anno-toggle-hint" style={{ marginTop: 8 }}>
            留空使用内置 fallback。Key 仅写入本地 storage.local，不会跨设备同步。
          </div>
        </section>
      </div>
      {/* ── /Tab: 设置 ────────────────────────────────────── */}

      {/* ── Tab: 关于 ─────────────────────────────────────── */}
      <div className={`tab-panel ${activeTab === 'about' ? 'active' : ''}`} role="tabpanel">
        <section className="popup-section">
          <div className="section-title">关于</div>
          <div className="about-card">
            <strong>智能网页翻译 v1.0.0</strong>
            沉浸式双语对照 + 词级对齐 hover 高亮 + 标注反馈闭环。
            <br />
            对标：沉浸式翻译 / 百度翻译。
            <br />
            技术栈：TypeScript · React · Vite · Vitest · Playwright。
            <br />
            模型：Claude (Sonnet 4.5)。
          </div>
          {pageUrl && (
            <div className="page-info" style={{ marginTop: 12 }}>
              <span className="page-info-icon">🌍</span>
              <span className="page-info-text">{pageTitle || pageUrl}</span>
            </div>
          )}
        </section>
      </div>
      {/* ── /Tab: 关于 ────────────────────────────────────── */}
    </div>
  )
}

// ─── 工具函数 ──────────────────────────────────────────────

interface ChromeTab {
  id?: number
  url?: string
  active?: boolean
}

/**
 * 从 tabs 列表里挑出 "用户正在浏览的页面"。
 *
 * ⚠ 不能直接用 `chrome.tabs.query({ active: true, lastFocusedWindow: true })`：
 *   popup 自己就是 lastFocusedWindow 的 active tab，会拿到自己。
 *
 * 策略：
 *   1. 优先：active + 非扩展/非 chrome:// /非 about: + 不是 popup 自己
 *   2. 备选：非扩展页里任意一个（用于 popup 在独立窗口时的兜底）
 *
 * 纯函数，便于单测。
 */
export function pickTargetTab(tabs: ChromeTab[], selfTabId: number | undefined): ChromeTab | undefined {
  const isUsable = (t: ChromeTab) =>
    t.id !== undefined &&
    t.id !== selfTabId &&
    !!t.url &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('about:')

  return (
    tabs.find(t => t.active && isUsable(t)) ??
    tabs.find(t => isUsable(t))
  )
}

async function sendToContent(msg: object): Promise<unknown> {
  const selfTabId = await new Promise<number | undefined>(r =>
    chrome.tabs.getCurrent(t => r(t?.id)),
  )
  const tabs = await chrome.tabs.query({})
  const target = pickTargetTab(tabs as ChromeTab[], selfTabId)
  if (!target?.id) {
    console.warn('[xt:popup] 找不到可翻译的 tab')
    return null
  }
  return chrome.tabs.sendMessage(target.id, msg).catch(err => {
    console.warn('[xt:popup] sendMessage 失败：', err?.message)
    return null
  })
}
