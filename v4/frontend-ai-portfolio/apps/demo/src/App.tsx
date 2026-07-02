import React, { useState } from 'react';
import { ToastContainer } from '@portfolio/multimodal-render-engine/components/Toast';
import { DemoTranslation } from './DemoTranslation';
import { DemoInspection } from './DemoInspection';
import { DemoOCRGeneral } from './DemoOCRGeneral';
import { DemoTemplate } from './DemoTemplate';

type Tab = 'translation' | 'inspection' | 'ocr-general' | 'ocr-template';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'translation', label: '翻译双栏', icon: '📄' },
  { key: 'inspection', label: '智检标注', icon: '🔍' },
  { key: 'ocr-general', label: 'OCR 通用', icon: '📷' },
  { key: 'ocr-template', label: 'OCR 模板', icon: '📋' },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('translation');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{
        padding: '12px 24px',
        borderBottom: '1px solid #e8e8e8',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
      }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
          多模态 AI 渲染引擎 Demo
        </h1>
        <span style={{ color: '#999', fontSize: '12px' }}>
          v1.0 — 4 场景 × 生产级代码
        </span>
      </header>

      {/* Tabs */}
      <nav style={{
        display: 'flex',
        borderBottom: '1px solid #f0f0f0',
        background: '#fafafa',
        padding: '0 24px',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #1890ff' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '14px',
              color: activeTab === tab.key ? '#1890ff' : '#666',
              fontWeight: activeTab === tab.key ? 600 : 400,
              transition: 'all 150ms ease',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'translation' && <DemoTranslation />}
        {activeTab === 'inspection' && <DemoInspection />}
        {activeTab === 'ocr-general' && <DemoOCRGeneral />}
        {activeTab === 'ocr-template' && <DemoTemplate />}
      </main>

      <ToastContainer />
    </div>
  );
}