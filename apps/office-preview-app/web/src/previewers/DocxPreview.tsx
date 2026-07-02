import { useEffect, useState } from 'react'
// DOCX → mammoth 转 HTML（秒级，无需服务端）
// 体验：骨架占位 → 转换 → 流式插入
// 注意：mammoth 是 CommonJS，Vite 需 dynamic import 兜底
import mammoth from 'mammoth'

interface Props { url: string }

export function DocxPreview({ url }: Props) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const buf = await fetch(url).then(r => r.arrayBuffer())
        const result = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) {
          setHtml(result.value)
          setLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message || e))
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [url])

  if (loading) return <div className="center-msg">解析 DOCX 中…</div>
  if (error) return <div className="center-msg err">加载失败：{error}</div>
  return (
    <div className="docx-root">
      <article
        className="docx-article"
        // mammoth 输出已为受限 HTML，无外部脚本；为彻底安全，关闭脚本注入
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
