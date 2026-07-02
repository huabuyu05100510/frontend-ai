import { useEffect, useRef, useState } from 'react'

export function useFps(): number {
  const [fps, setFps] = useState(60)
  const frames = useRef(0)
  const last = useRef(performance.now())
  useEffect(() => {
    let raf = 0
    const loop = () => {
      frames.current++
      const now = performance.now()
      if (now - last.current >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - last.current)))
        frames.current = 0
        last.current = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}

export function PerfHUD({ rows }: { rows: Array<[string, string]> }) {
  const fps = useFps()
  return (
    <div className="perf-hud">
      <div>
        <span className="k">FPS</span>
        <span className="v" style={{ color: fps >= 55 ? 'var(--green)' : 'var(--yellow)' }}>
          {fps}
        </span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  )
}
