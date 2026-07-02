// 模型：claude-sonnet-4-6
// usePalette — palette open/close state + global ⌘K / Esc listeners

import { useCallback, useEffect, useState } from 'react'

export interface UsePaletteResult {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export function usePalette(): UsePaletteResult {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => {
    setIsOpen(true)
    const ts = new Date().toISOString()
    console.info(`[palette ${ts}] opened`)
  }, [])
  const close = useCallback(() => {
    setIsOpen(false)
    const ts = new Date().toISOString()
    console.info(`[palette ${ts}] closed`)
  }, [])
  const toggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev
      const ts = new Date().toISOString()
      console.info(`[palette ${ts}] ${next ? 'opened' : 'closed'}`)
      return next
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K'
      const isModifier = e.metaKey || e.ctrlKey
      if (isK && isModifier) {
        e.preventDefault()
        setIsOpen(prev => !prev)
        return
      }
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { isOpen, open, close, toggle }
}