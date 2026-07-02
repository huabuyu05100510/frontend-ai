import React, { useState, useEffect, useRef } from 'react'
import { InspectionText } from './scenes/inspection/InspectionText'
import { OCRGeneralView } from './scenes/ocr-general/OCRGeneralView'
import { TemplateEditor } from './scenes/ocr-custom/TemplateEditor'
import { DualColumnLayout } from './scenes/translation/DualColumnLayout'
import { StreamingScene } from './scenes/streaming/StreamingScene'
import { PerfCollector } from './perf/PerfCollector'
import { PerfPanel } from './perf/PerfPanel'

type Tab = 'inspection' | 'ocr-general' | 'ocr-custom' | 'translation' | 'streaming'

const TABS: Array<{ id: Tab; label: string; icon: string; desc: string }> = [
  { id: 'inspection',  label: '智检标注',     icon: '🔍', desc: '文本校对 · 波浪线 + 错误面板联动' },
  { id: 'ocr-general', label: 'OCR 通用识别', icon: '📷', desc: '图片识别 · 双向 hover 联动' },
  { id: 'ocr-custom',  label: 'OCR 自定义',   icon: '✏️', desc: '画框配置字段 · 模板管理' },
  { id: 'translation', label: '翻译双栏',     icon: '🌐', desc: '双栏对比 · 段落滚动同步' },
  { id: 'streaming',   label: 'AI 流式渲染',  icon: '🌊', desc: 'Streaming Markdown · Generative UI · 竞态防护' },
]

// 全局单例，跨 Tab 共享
const globalCollector = new PerfCollector()

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('inspection')
  const [perfVisible, setPerfVisible] = useState(false)
  const collectorRef = useRef(globalCollector)

  useEffect(() => {
    collectorRef.current.start()
    return () => collectorRef.current.stop()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', background: '#f0f2f5' }}>
      {/* Top nav */}
      <header style={{
        background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
        padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', marginRight: 8 }}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>多模态 AI 渲染引擎</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>Multimodal Render Engine · Demo</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.desc}
              style={{
                padding: '8px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                background: activeTab === tab.id ? 'rgba(255,255,255,0.25)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.75)',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'background .15s, color .15s',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <button
          onClick={() => setPerfVisible(v => !v)}
          title="性能面板"
          style={{
            padding: '5px 12px', border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 6, cursor: 'pointer', fontSize: 11,
            background: perfVisible ? 'rgba(255,255,255,0.25)' : 'transparent',
            color: 'rgba(255,255,255,0.85)',
            display: 'flex', alignItems: 'center', gap: 5,
            transition: 'background .15s',
          }}
        >
          <span>📊</span>
          <span>性能面板</span>
        </button>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginLeft: 8 }}>
          React 18 · TypeScript · ProseMirror · rbush · Vitest
        </div>
      </header>

      {/* Sub header with description */}
      <div style={{
        background: '#fff', padding: '8px 20px', borderBottom: '1px solid #e8e8e8',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        {TABS.find(t => t.id === activeTab) && (() => {
          const tab = TABS.find(t => t.id === activeTab)!
          return (
            <>
              <span style={{ fontSize: 16 }}>{tab.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#262626' }}>{tab.label}</span>
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{tab.desc}</span>
            </>
          )
        })()}
        <div style={{ flex: 1 }} />
        <TechBadges tab={activeTab} />
      </div>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'inspection'  && <InspectionText collector={collectorRef.current} />}
        {activeTab === 'ocr-general' && <OCRGeneralView collector={collectorRef.current} />}
        {activeTab === 'ocr-custom'  && <TemplateEditor />}
        {activeTab === 'translation' && <DualColumnLayout />}
        {activeTab === 'streaming'   && <StreamingScene />}
      </main>

      <PerfPanel
        collector={collectorRef.current}
        visible={perfVisible}
        onClose={() => setPerfVisible(false)}
      />
    </div>
  )
}

function TechBadges({ tab }: { tab: Tab }) {
  const badges: Record<Tab, string[]> = {
    inspection:  ['ProseMirror', 'DecorationSet', 'AnnotationStore', 'EventBus'],
    'ocr-general': ['ImageCoordAdapter', 'SVGLayer', 'R-Tree', '双向联动'],
    'ocr-custom':  ['DrawTool', 'ResizeTool', 'StateMachine', 'localStorage'],
    translation: ['ScrollSyncBridge', 'ParagraphMapper', '段落对齐'],
    streaming:   ['StreamingParser', 'BracketDepth', 'AbortController', '版本号竞态防护'],
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {badges[tab].map(b => (
        <span key={b} style={{
          padding: '2px 8px', borderRadius: 10, fontSize: 10,
          background: '#f0f5ff', color: '#597ef7', border: '1px solid #adc6ff',
        }}>{b}</span>
      ))}
    </div>
  )
}
