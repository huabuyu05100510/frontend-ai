// Office AI — v5.0 重构（大厂视觉 + 三栏布局 + 真实 AI 集成）
// 模型：claude-sonnet-4-6
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { AppLayoutV2, AppLayoutV2Props } from './AppLayoutV2'
import { FilesPage } from './pages/FilesPage'
import { TranslationPage } from './pages/TranslationPage'
import { QualityCheckPage } from './pages/QualityCheckPage'
import { OCRPage } from './pages/OCRPage'
import { VoicePage } from './pages/VoicePage'
import { FormatConvertPage } from './pages/FormatConvertPage'
import { UploadCenterPage } from './pages/UploadCenterPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { SamplesPage } from './pages/SamplesPage'
import { GalleryPage } from './pages/GalleryPage'
import { useStore } from './store'
import { RightTaskItem } from './components/RightPanel'
import { AlertCircleIcon } from './design/icons'
import { AppRouter } from './router/AppRouter'
import { routeToMenuKey, menuKeyToRoute, MenuKey } from './routes'
import { Palette, usePalette, useRegisterNavigationItems } from './palette'

/** ⌘K Palette 容器：注册导航项 + 渲染面板 */
function PaletteHost() {
  useRegisterNavigationItems()
  const palette = usePalette()
  return <Palette palette={palette} />
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || ''

interface HealthAll {
  ok: boolean
  status: 'ok' | 'degraded'
  version: string
  pdfium: { ok: boolean; engine: string; available: boolean }
  translate: { ok: boolean; providers: string[]; active: string }
  ocr: { ok: boolean; providers: string[]; active: string }
  qc: { ok: boolean; active: string }
}

async function fetchHealth(): Promise<HealthAll | null> {
  try {
    const r = await fetch(`${API_BASE}/api/health/all`, { cache: 'no-store' })
    if (!r.ok) return null
    return await r.json()
  } catch (e) {
    console.warn('[health] fetch failed:', e)
    return null
  }
}

const MENU_LABELS: Record<AppLayoutV2Props['active'], string> = {
  files: '文档预览',
  translate: '智能翻译',
  qc: '智检校对',
  ocr: 'OCR 识别',
  convert: '格式转换',
  upload: '上传中心',
  voice: '语音中心',
  bookmarks: '收藏夹',
  samples: '示例库',
  gallery: '图片画廊',
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const active = routeToMenuKey(location.pathname) as AppLayoutV2Props['active']
  const onMenuChange = (key: AppLayoutV2Props['active']) => {
    navigate(menuKeyToRoute(key as MenuKey))
  }
  const [health, setHealth] = useState<HealthAll | null>(null)
  const tasks = useStore(s => s.tasks)

  // 启动 + 30s 健康轮询
  useEffect(() => {
    fetchHealth().then(setHealth)
    const t = setInterval(() => fetchHealth().then(setHealth), 30_000)
    return () => clearInterval(t)
  }, [])

  const taskItems: RightTaskItem[] = tasks.slice(0, 20).map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    createdAt: t.createdAt,
  }))

  const activeTaskId = useStore.getState().selected?.id || tasks[0]?.id

  return (
    <AppShell>
      <PaletteHost />
      <AppRouter>
        <AppLayoutV2
          active={active}
          onMenuChange={onMenuChange}
          activeLabel={MENU_LABELS[active]}
        health={health ? {
          status: health.status,
          reason: health.translate.providers.length === 0 ? '翻译降级到 mock 模式' : null,
          pdfium: health.pdfium,
          translate: health.translate,
          ocr: health.ocr,
        } : undefined}
        tasks={taskItems}
        selectedTaskId={activeTaskId}
        onSelectTask={(taskId) => {
          // 路由交给 RightPanel 内部 useNavigate 完成；此处仅同步 store
          const ts = new Date().toISOString()
          console.info(`[app ${ts}] selectTask dispatched:`, taskId)
          const t = tasks.find(x => x.id === taskId)
          if (t) useStore.getState().select(t)
        }}
        showRightPanel={active === 'files'}
        fullWidth={active === 'qc' || active === 'ocr' || active === 'convert' || active === 'upload' || active === 'voice'}
      >
        {/* 降级模式 banner */}
        {health && health.status === 'degraded' && (
          <div className="oa-alert oa-alert-warning" style={{ marginBottom: 24 }}>
            <AlertCircleIcon size={16} />
            <div>
              <strong>AI 服务降级模式</strong> — 当前无可用 AI Provider Key，
              翻译/OCR/智检将使用本地启发式（fallback）结果。
              请在服务端配置 <code>MINIMAX_API_KEY</code> / <code>ZHIPU_API_KEY</code> 后重启。
            </div>
          </div>
        )}

        {active === 'files' && <FilesPage />}
        {active === 'translate' && <TranslationPage />}
        {active === 'qc' && <QualityCheckPage />}
        {active === 'ocr' && <OCRPage />}
        {active === 'voice' && <VoicePage />}
        {active === 'convert' && <FormatConvertPage />}
        {active === 'upload' && <UploadCenterPage />}
        {active === 'bookmarks' && <BookmarksPage />}
        {active === 'samples' && <SamplesPage />}
        {active === 'gallery' && <GalleryPage />}
      </AppLayoutV2>
      </AppRouter>
    </AppShell>
  )
}