// 模型：claude-sonnet-4-6
// AppRouter — pass-through wrapper that logs route changes.
// BrowserRouter is now hoisted to main.tsx so App itself can call useLocation()
// (Phase 0 bugfix: useLocation() requires Router context, so the provider must
// sit above any component that consumes the router state).

import { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { routeToMenuKey, MenuKey } from '../routes'

export interface AppRouterProps {
  children: ReactNode
}

function RouteLogger() {
  const loc = useLocation()
  const ts = new Date().toISOString()
  const menuKey = routeToMenuKey(loc.pathname) as MenuKey
  console.info(`[router ${ts}] navigate: ${loc.pathname} -> ${menuKey}`)
  return null
}

export function AppRouter({ children }: AppRouterProps) {
  return (
    <>
      <RouteLogger />
      {children}
    </>
  )
}