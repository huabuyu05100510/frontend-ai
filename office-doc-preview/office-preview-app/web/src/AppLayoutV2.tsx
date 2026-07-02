// AppLayoutV2 — v5.0 三栏布局（TopBar + SideMenu + Main + RightPanel）
// 模型：claude-sonnet-4-6
import React from 'react'
import { TopBar } from './components/TopBar'
import { SideMenu, MenuKey } from './components/SideMenu'
import { RightPanel, RightTaskItem } from './components/RightPanel'

export interface AppLayoutV2Props {
  /** 当前激活的菜单 */
  active: MenuKey
  onMenuChange: (key: MenuKey) => void
  /** 当前菜单对应的标题（用于 TopBar 面包屑） */
  activeLabel: string
  /** AI 健康状态（用于 TopBar 状态徽章 + RightPanel 详情） */
  health?: {
    status: 'ok' | 'degraded'
    reason?: string | null
    pdfium?: { engine: string; available: boolean }
    translate?: { ok?: boolean; providers: string[]; active: string }
    ocr?: { ok?: boolean; providers: string[]; active: string }
  }
  /** 任务列表（用于 RightPanel） */
  tasks?: RightTaskItem[]
  /** 当前选中任务 */
  selectedTaskId?: string | null
  onSelectTask?: (taskId: string) => void
  /** 是否显示右侧栏 */
  showRightPanel?: boolean
  /** 是否全宽模式（无 max-width + 无 padding，适用于 QC/OCR 编辑页） */
  fullWidth?: boolean
  /** 主内容 */
  children: React.ReactNode
}

export const AppLayoutV2: React.FC<AppLayoutV2Props> = ({
  active, onMenuChange, activeLabel,
  health, tasks = [], selectedTaskId, onSelectTask,
  showRightPanel = true, fullWidth = false,
  children,
}) => {
  // 动态 grid columns：3 列 / 2 列
  const gridTemplateColumns = showRightPanel
    ? 'var(--layout-side-menu-width) 1fr 320px'
    : 'var(--layout-side-menu-width) 1fr'
  const gridTemplateAreas = showRightPanel
    ? '"topbar topbar topbar" "sidemenu main rightpanel"'
    : '"topbar topbar" "sidemenu main"'

  return (
    <div
      className="oa-shell"
      style={{
        gridTemplateColumns,
        gridTemplateAreas,
      }}
    >
      <TopBar activeLabel={activeLabel} health={health} />

      <SideMenu active={active} onChange={onMenuChange} />

      <main className="oa-main" id="main-content" role="main" style={fullWidth ? { padding: 0 } : undefined}>
        {fullWidth ? (
          children
        ) : (
          <div className="oa-main-inner">
            {children}
          </div>
        )}
      </main>

      {showRightPanel && (
        <RightPanel
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          health={health}
        />
      )}
    </div>
  )
}

AppLayoutV2.displayName = 'AppLayoutV2'