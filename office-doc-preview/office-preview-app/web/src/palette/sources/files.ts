// 模型：claude-sonnet-4-6
// Files source — palette items that list current uploaded tasks (top 20)

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerPaletteItems, paletteRegistry, type PaletteItem } from '../registry'
import { useStore } from '../../store'

const MAX_TASKS = 20

/** Imperative registration (used by tests + non-React contexts) */
export function registerFilesItems(navigate: (path: string) => void, tasks: Array<{ id: string; name: string }>): PaletteItem[] {
  const items: PaletteItem[] = tasks.slice(0, MAX_TASKS).map(t => ({
    id: `file-${t.id}`,
    title: t.name,
    subtitle: '打开文件',
    group: '文件',
    keywords: ['file', 'task', '文件', 'open', t.name],
    action: () => navigate(`/files?task=${encodeURIComponent(t.id)}`),
  }))
  registerPaletteItems(items)
  return items
}

/** Hook: register files items; unregister on unmount */
export function useRegisterFilesItems(): void {
  const navigate = useNavigate()
  const tasks = useStore(s => s.tasks)
  useEffect(() => {
    const items = registerFilesItems(navigate, tasks as Array<{ id: string; name: string }>)
    return () => {
      for (const item of items) paletteRegistry.unregister(item.id)
    }
  }, [navigate, tasks])
}