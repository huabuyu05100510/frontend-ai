// 模型：claude-sonnet-4-6
// Templates source — palette items that jump to common workflow templates

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerPaletteItems, paletteRegistry, type PaletteItem } from '../registry'
import { ROUTES } from '../../routes'

interface TemplateItem {
  id: string
  title: string
  subtitle: string
  route: string
  keywords: string[]
}

const TEMPLATES: TemplateItem[] = [
  { id: 'tpl-translate-new', title: '新建翻译', subtitle: '打开智能翻译页', route: ROUTES.translate, keywords: ['new', 'translate', '新建', '翻译'] },
  { id: 'tpl-qc-new', title: '新建智检', subtitle: '打开智检校对页', route: ROUTES.qc, keywords: ['new', 'qc', 'check', '新建', '智检', '校对'] },
  { id: 'tpl-ocr-new', title: '新建OCR', subtitle: '打开 OCR 识别页', route: ROUTES.ocr, keywords: ['new', 'ocr', '新建', '识别'] },
  { id: 'tpl-convert-new', title: '新建格式转换', subtitle: '打开格式转换页', route: ROUTES.convert, keywords: ['new', 'convert', 'format', '新建', '格式转换'] },
  { id: 'tpl-upload-new', title: '新建上传', subtitle: '打开上传中心', route: ROUTES.upload, keywords: ['new', 'upload', '新建', '上传'] },
  { id: 'tpl-voice-new', title: '新建语音', subtitle: '打开语音中心', route: ROUTES.voice, keywords: ['new', 'voice', 'speech', '新建', '语音'] },
  { id: 'tpl-files-list', title: '查看所有文件', subtitle: '回到文档预览列表', route: ROUTES.files, keywords: ['files', 'list', '文件', '列表'] },
]

/** Imperative registration */
export function registerTemplatesItems(navigate: (path: string) => void): PaletteItem[] {
  const items: PaletteItem[] = TEMPLATES.map(t => ({
    id: t.id,
    title: t.title,
    subtitle: t.subtitle,
    group: '模板',
    keywords: t.keywords,
    action: () => navigate(t.route),
  }))
  registerPaletteItems(items)
  return items
}

/** Hook variant */
export function useRegisterTemplatesItems(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const items = registerTemplatesItems(navigate)
    return () => {
      for (const item of items) paletteRegistry.unregister(item.id)
    }
  }, [navigate])
}