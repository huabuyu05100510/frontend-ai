import { useEffect, useState } from 'react'

interface Props { url: string }

export function TextPreview({ url }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    fetch(url).then(r => r.text()).then(t => {
      if (!cancelled) { setText(t); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [url])
  if (loading) return <div className="center-msg">加载中…</div>
  return (
    <pre className="text-root">{text}</pre>
  )
}
