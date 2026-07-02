// RightPanel — 右侧工具栏（任务列表 + 系统状态）
// 模型：claude-sonnet-4-6
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskIcon, ClockIcon, AlertCircleIcon, CheckCircleIcon, ChevronRightIcon } from '../design/icons'
import { useStore } from '../store'

export interface RightTaskItem {
  id: string
  name: string
  status: string
  progress?: number
  createdAt: number
}

export interface RightPanelProps {
  /** 最近任务列表（来自 store） */
  tasks?: RightTaskItem[]
  /** 选中任务 id */
  selectedTaskId?: string | null
  /** 点击任务回调（若提供则优先使用；否则内部 useNavigate） */
  onSelectTask?: (taskId: string) => void
  /** AI 健康状态 */
  health?: {
    status: 'ok' | 'degraded'
    pdfium?: { engine: string; available: boolean }
    translate?: { providers: string[]; active: string }
    ocr?: { providers: string[]; active: string }
  }
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function statusType(s: string): 'ok' | 'pending' | 'error' | 'info' {
  if (['ready', 'done', 'success'].includes(s)) return 'ok'
  if (['error', 'failed'].includes(s)) return 'error'
  if (['pending', 'queued'].includes(s)) return 'pending'
  return 'info'
}

const STATUS_LABEL: Record<string, string> = {
  ready: '就绪', done: '完成', success: '成功',
  pending: '等待', queued: '排队', converting: '转换中',
  error: '失败', failed: '失败',
}

export const RightPanel: React.FC<RightPanelProps> = ({
  tasks = [], selectedTaskId, onSelectTask, health,
}) => {
  const navigate = useNavigate()
  const select = useStore(s => s.select)
  const handleSelectTask = (taskId: string) => {
    const ts = new Date().toISOString()
    console.info(`[rightpanel ${ts}] selectTask:`, taskId)
    // 通知父组件（用于 store 同步等）
    onSelectTask?.(taskId)
    // 自行 navigate — 之前因 onSelectTask 是 no-op 函数而阻断
    const t = useStore.getState().tasks.find(x => x.id === taskId)
    if (t) select(t)
    navigate(`/files?task=${encodeURIComponent(taskId)}`)
  }
  const handleViewAll = () => {
    const ts = new Date().toISOString()
    console.info(`[rightpanel ${ts}] viewAll → /files`)
    navigate('/files')
  }
  return (
    <aside className="oa-right-panel" aria-label="任务与状态" style={{
      gridArea: 'rightpanel',
      width: 320,
      background: '#fff',
      borderLeft: '1px solid #e5e7eb',
      height: 'calc(100vh - var(--layout-top-bar-height))',
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      {/* === 最近任务 === */}
      <div>
        <div style={{
          fontSize: 12, fontWeight: 600, color: '#86909c',
          textTransform: 'uppercase', letterSpacing: '0.04em',
          marginBottom: 8, padding: '0 4px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <TaskIcon size={12} />
          最近任务 · {tasks.length}
        </div>
        {tasks.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#86909c', fontSize: 13 }}>
            暂无任务
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tasks.slice(0, 8).map(t => {
              const isSelected = t.id === selectedTaskId
              const sType = statusType(t.status)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTask(t.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: 8, borderRadius: 6, textAlign: 'left',
                    background: isSelected ? '#e6f4ff' : 'transparent',
                    border: '1px solid',
                    borderColor: isSelected ? '#91caff' : 'transparent',
                    cursor: 'pointer', transition: 'all 120ms',
                    width: '100%',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f2f3f5' }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, color: '#1f2329',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', marginBottom: 4,
                    }}>
                      {t.name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={`oa-badge oa-badge-${sType}`}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                      <span style={{ fontSize: 11, color: '#86909c' }}>
                        <ClockIcon size={10} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                        {formatTime(t.createdAt)}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
        {tasks.length > 0 && (
          <button
            type="button"
            data-testid="rightpanel-view-all"
            onClick={handleViewAll}
            style={{
              marginTop: 8, padding: '6px 8px',
              background: 'transparent', border: '1px dashed #d9d9d9',
              borderRadius: 6, color: '#1677ff', fontSize: 12,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 4,
            }}
          >
            查看全部
            <ChevronRightIcon size={12} />
          </button>
        )}
      </div>

      {/* === 系统状态 === */}
      {health && (
        <div style={{
          padding: 12, background: '#fafafa', borderRadius: 8,
          border: '1px solid #f0f1f3',
        }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#86909c',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            系统状态
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <StatusRow
              icon={health.status === 'ok' ? <CheckCircleIcon size={14} style={{ color: '#52c41a' }} /> : <AlertCircleIcon size={14} style={{ color: '#faad14' }} />}
              label="整体健康"
              value={health.status === 'ok' ? '正常' : '降级'}
            />
            {health.pdfium && (
              <StatusRow
                icon={<CheckCircleIcon size={14} style={{ color: health.pdfium.available ? '#52c41a' : '#86909c' }} />}
                label="PDFium 引擎"
                value={health.pdfium.engine}
              />
            )}
            {health.translate && (
              <StatusRow
                icon={<CheckCircleIcon size={14} style={{ color: health.translate.providers.length ? '#52c41a' : '#faad14' }} />}
                label="翻译 Provider"
                value={`${health.translate.active} · ${health.translate.providers.length}`}
              />
            )}
            {health.ocr && (
              <StatusRow
                icon={<CheckCircleIcon size={14} style={{ color: health.ocr.providers.length ? '#52c41a' : '#faad14' }} />}
                label="OCR Provider"
                value={`${health.ocr.active} · ${health.ocr.providers.length}`}
              />
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

const StatusRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
    {icon}
    <span style={{ color: '#4e5969', flex: 1 }}>{label}</span>
    <span style={{ color: '#1f2329', fontWeight: 500, fontFamily: 'monospace' }}>{value}</span>
  </div>
)

RightPanel.displayName = 'RightPanel'