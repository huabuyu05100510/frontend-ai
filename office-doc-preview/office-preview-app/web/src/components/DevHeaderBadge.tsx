// 模型：claude-sonnet-4-6
// DevHeaderBadge — dev-only (?dev=1) badge that surfaces X-* response headers
//
// Strategy: when fetch resolves, snapshot response headers into a session-scoped
// ring buffer (last 5 min) keyed by URL. The badge reads from this buffer and
// from performance.getEntriesByType('resource') to show recent activity.

import { useEffect, useMemo, useRef, useState } from 'react'

const DISMISS_KEY = 'dev-header-badge-dismissed'
const FIVE_MIN_MS = 5 * 60 * 1000

type HeaderSnapshot = { url: string; headers: Record<string, string>; ts: number }

const snapshots: HeaderSnapshot[] = []
const MAX = 200

export function recordDevHeaders(url: string, headers: Headers) {
  const obj: Record<string, string> = {}
  headers.forEach((v, k) => {
    if (k.toLowerCase().startsWith('x-')) obj[k] = v
  })
  if (Object.keys(obj).length === 0) return
  snapshots.push({ url, headers: obj, ts: Date.now() })
  while (snapshots.length > MAX) snapshots.shift()
  // Notify subscribers
  for (const cb of subscribers) cb()
}

const subscribers = new Set<() => void>()

function useDevFlag(): boolean {
  const [flag, setFlag] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setFlag(params.get('dev') === '1')
  }, [])
  return flag
}

function useDismissed(): boolean {
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
  }, [])
  return dismissed
}

export function DevHeaderBadge() {
  const devFlag = useDevFlag()
  const dismissed = useDismissed()
  const [bump, setBump] = useState(0)
  const [open, setOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!devFlag || dismissed) return
    const cb = () => setBump(b => b + 1)
    subscribers.add(cb)
    // Re-read every 5s in case new requests arrived
    intervalRef.current = setInterval(() => setBump(b => b + 1), 5000)
    return () => {
      subscribers.delete(cb)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [devFlag, dismissed])

  const data = useMemo(() => {
    if (!devFlag || dismissed) return null
    const now = Date.now()
    const recent = snapshots.filter(s => now - s.ts < FIVE_MIN_MS)
    const headerCounts: Record<string, number> = {}
    for (const s of recent) {
      for (const k of Object.keys(s.headers)) {
        headerCounts[k] = (headerCounts[k] ?? 0) + 1
      }
    }
    const uniqueHeaders = Object.keys(headerCounts).sort()
    return { count: recent.length, headerCounts, uniqueHeaders }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, devFlag, dismissed])

  if (!devFlag || dismissed) return null

  return (
    <div className="dev-header-badge" data-testid="dev-header-badge">
      <button
        type="button"
        className="dev-header-badge-trigger"
        onClick={() => setOpen(o => !o)}
        aria-label="可观测响应头"
      >
        🔭 可观测 {data ? `(${data.count})` : ''}
      </button>
      {open && data && (
        <div className="dev-header-badge-panel" role="dialog">
          <div className="dev-header-badge-header">
            <span>最近 5 分钟响应头</span>
            <button
              type="button"
              className="dev-header-badge-dismiss"
              onClick={() => {
                if (typeof localStorage !== 'undefined') localStorage.setItem(DISMISS_KEY, '1')
                // Emit a custom event so the host (or test) can react
                try { window.dispatchEvent(new CustomEvent('dev-header-badge-dismissed')) } catch {}
                try { window.location.reload() } catch {}
              }}
              data-testid="dev-header-badge-dismiss"
              aria-label="关闭可观测面板"
            >
              ×
            </button>
          </div>
          {data.uniqueHeaders.length === 0 ? (
            <div className="dev-header-badge-empty">暂无 X-* 响应头</div>
          ) : (
            <ul className="dev-header-badge-list">
              {data.uniqueHeaders.map(h => (
                <li key={h}>
                  <code>{h}</code> <span>{data.headerCounts[h]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
