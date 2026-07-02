// SideMenu — 左侧导航（4 大模块分组：大厂风格）
// 模型：claude-sonnet-4-6
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileTextIcon, LanguagesIcon, ShieldCheckIcon, ScanIcon,
  ChevronRightIcon, SparkleIcon, FolderIcon, ImageIcon, BookmarkIcon, MicIcon, LayersIcon, UploadIcon,
} from '../design/icons'
import { menuKeyToRoute } from '../routes'

export type MenuKey =
  | 'files' | 'translate' | 'qc' | 'ocr' | 'voice' | 'convert' | 'upload'
  | 'bookmarks' | 'samples' | 'gallery'

type AnyKey = string

interface MenuItem {
  key: AnyKey
  label: string
  desc: string
  icon: React.FC<{ size?: number }>
}

export interface MenuGroup {
  title: string
  items: MenuItem[]
}

const GROUPS: MenuGroup[] = [
  {
    title: '文档',
    items: [
      { key: 'files', label: '文档预览', desc: '上传 · 转换 · 预览', icon: FileTextIcon },
    ],
  },
  {
    title: 'AI 能力',
    items: [
      { key: 'translate', label: '智能翻译', desc: '9 语言 · 多引擎', icon: LanguagesIcon },
      { key: 'qc', label: '智检校对', desc: 'AI 错误检测 · 合规', icon: ShieldCheckIcon },
      { key: 'ocr', label: 'OCR 识别', desc: '图片文字 · 区域坐标', icon: ScanIcon },
      { key: 'convert', label: '格式转换', desc: 'PDF · 高清图片 · 标注', icon: LayersIcon },
      { key: 'upload', label: '上传中心', desc: '分片 · 秒传 · 压缩', icon: UploadIcon },
      { key: 'voice', label: '语音中心', desc: '实时翻译 · TTS · ASR', icon: MicIcon },
    ],
  },
  {
    title: '工具集',
    items: [
      { key: 'bookmarks', label: '收藏夹', desc: '常用任务快速访问', icon: BookmarkIcon },
      { key: 'samples', label: '示例库', desc: '官方样本文件', icon: FolderIcon },
      { key: 'gallery', label: '图片画廊', desc: '视觉资产浏览', icon: ImageIcon },
    ],
  },
]

export interface SideMenuProps {
  active: MenuKey
  /** Optional: when provided, called instead of internal useNavigate. Useful for testing. */
  onChange?: (key: MenuKey) => void
}

// 4 大模块 + 工具集占位项（bookmarks / samples / gallery 已实现）
const ACTIVE_KEYS: ReadonlySet<MenuKey> = new Set([
  'files', 'translate', 'qc', 'ocr', 'convert', 'upload', 'voice',
  'bookmarks', 'samples', 'gallery',
])

export const SideMenu: React.FC<SideMenuProps> = ({ active, onChange }) => {
  const navigate = useNavigate()
  const handleChange = (key: string) => {
    if (!ACTIVE_KEYS.has(key as MenuKey)) return
    if (onChange) {
      onChange(key as MenuKey)
    } else {
      navigate(menuKeyToRoute(key as MenuKey))
    }
  }
  return (
    <aside className="oa-sidemenu" aria-label="主导航">
      {GROUPS.map(group => (
        <div key={group.title} className="oa-sidemenu-section">
          <div className="oa-sidemenu-section-title">{group.title}</div>
          {group.items.map(item => {
            const Icon = item.icon
            const isActive = item.key === active
            return (
              <button
                key={item.key}
                type="button"
                className={`oa-sidemenu-item ${isActive ? 'active' : ''}`}
                onClick={() => handleChange(item.key)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="oa-sidemenu-item-icon">
                  <Icon size={18} />
                </span>
                <span className="oa-sidemenu-item-text">
                  <span className="oa-sidemenu-item-label">
                    {item.label}
                    {['translate', 'qc', 'ocr', 'voice', 'convert', 'upload'].includes(item.key) ? (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#722ed1', fontWeight: 600 }}>AI</span>
                    ) : null}
                  </span>
                  <span className="oa-sidemenu-item-desc">{item.desc}</span>
                </span>
                {isActive && (
                  <ChevronRightIcon size={14} style={{ color: '#1677ff' }} />
                )}
              </button>
            )
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div className="oa-sidemenu-section">
        <div style={{
          padding: 12, background: 'linear-gradient(135deg, #f9f0ff, #e6f4ff)',
          borderRadius: 8, fontSize: 12, color: '#4e5969', lineHeight: 1.5,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <SparkleIcon size={14} style={{ color: '#722ed1', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, color: '#1f2329', marginBottom: 2 }}>AI 能力说明</div>
            <div>翻译支持 MiniMax / 智谱 GLM / 火山引擎；OCR 使用多模态视觉模型；智检调 LLM 检测错别字与合规问题。</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

SideMenu.displayName = 'SideMenu'