// 颜色迁移至 semantic.ts (Phase 2.A)
// SamplesPage — 示例库（展示官方样本文件）
// 模型：claude-sonnet-4-6
import { useEffect, useState } from 'react'
import { FolderIcon, FileIcon } from '../design/icons'

SamplesPage.displayName = 'SamplesPage'

interface SampleFile {
  id: string
  name: string
  ext: string
  size: number
  url: string
}

const FIXTURE_SAMPLE: SampleFile = {
  id: 'fixture',
  name: '示例：商务合同模板.pdf',
  ext: 'pdf',
  size: 245760,
  url: '/files/sample.pdf',
}

export function SamplesPage() {
  const [samples, setSamples] = useState<SampleFile[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch('/api/files?demo=true')
      .then(r => r.ok ? r.json() : { files: [] })
      .then(j => { if (alive) setSamples(j.files || []) })
      .catch(() => { if (alive) setSamples([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // 至少保证 1 个 fixture 卡片可见（避免首屏空白 + 兜底）
  const display = samples.length > 0 ? samples : [FIXTURE_SAMPLE]

  return (
    <div>
      <div className="oa-page-header">
        <h1 className="oa-page-title">
          <FolderIcon size={24} style={{ color: 'var(--color-primary)' }} />
          示例库
        </h1>
        <div className="oa-page-subtitle">
          官方样本文件 · 点击「打开」在新窗口预览
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {display.map(f => (
          <div
            key={f.id}
            data-testid={f.id === 'fixture' ? 'sample-card-fixture' : `sample-card-${f.id}`}
            className="oa-card"
          >
            <div className="oa-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileIcon size={16} />
                <span className="oa-card-title" title={f.name}>{f.name}</span>
              </div>
            </div>
            <div className="oa-card-body" style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {(f.ext || '').toUpperCase()} · {(f.size / 1024).toFixed(1)} KB
            </div>
            <div className="oa-card-footer">
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="oa-btn oa-btn-primary"
                style={{ textDecoration: 'none' }}
              >
                打开
              </a>
            </div>
          </div>
        ))}
      </div>

      {samples.length === 0 && (
        <div className="oa-empty" style={{ marginTop: 24 }}>
          <div className="oa-empty-desc">
            暂无示例文件，请上传
          </div>
        </div>
      )}
    </div>
  )
}

export default SamplesPage