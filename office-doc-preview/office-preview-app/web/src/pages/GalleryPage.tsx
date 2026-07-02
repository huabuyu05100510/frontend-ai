// 颜色迁移至 semantic.ts (Phase 2.A)
// GalleryPage — 图片画廊（OCR/翻译生成的图像资产）
// 模型：claude-sonnet-4-6
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { ImageIcon } from '../design/icons'

GalleryPage.displayName = 'GalleryPage'

interface GalleryImage {
  taskId: string
  page: number
  url: string
  width?: number
  height?: number
}

const FIXTURE: GalleryImage = {
  taskId: 'fixture',
  page: 1,
  url: '/api/files/fixture-page.png',
  width: 800,
  height: 1130,
}

export function GalleryPage() {
  const tasks = useStore(s => s.tasks)
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null)

  const images: GalleryImage[] = useMemo(() => {
    const out: GalleryImage[] = []
    for (const t of tasks) {
      const pages = (t as any).pages as Array<{ page: number; url: string; width?: number; height?: number }> | undefined
      if (pages && pages.length) {
        for (const p of pages) {
          out.push({ taskId: t.id, page: p.page, url: p.url, width: p.width, height: p.height })
        }
      }
    }
    return out
  }, [tasks])

  const display = images.length > 0 ? images : [FIXTURE]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(null)
    }
    if (lightbox) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  return (
    <div>
      <div className="oa-page-header">
        <h1 className="oa-page-title">
          <ImageIcon size={24} style={{ color: 'var(--color-primary)' }} />
          图片画廊
        </h1>
        <div className="oa-page-subtitle">
          OCR / 翻译产生的图像资产 · {images.length} 张
        </div>
      </div>

      {images.length === 0 ? (
        <>
          <div className="oa-empty">
            <div className="oa-empty-icon"><ImageIcon size={48} /></div>
            <div className="oa-empty-title">暂无图片资产</div>
            <div className="oa-empty-desc">完成 OCR 识别或文档预览后，图像会自动归档到这里</div>
          </div>
          {/* Fixture thumbnail to demo UI */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <div
              data-testid="gallery-card-fixture"
              className="oa-card"
              style={{ width: 240, cursor: 'pointer', overflow: 'hidden' }}
              onClick={() => setLightbox(FIXTURE)}
            >
              <div style={{
                aspectRatio: '1 / 1.4',
                background: 'linear-gradient(135deg, var(--color-primary-bg), var(--blue-2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-primary)', fontSize: 48,
              }}>
                <ImageIcon size={48} />
              </div>
              <div className="oa-card-body" style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                示例图 · 第 1 页
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}>
          {display.map(img => (
            <div
              key={`${img.taskId}-${img.page}`}
              data-testid={`gallery-card-${img.taskId}-${img.page}`}
              className="oa-card"
              style={{ cursor: 'pointer', overflow: 'hidden' }}
              onClick={() => setLightbox(img)}
            >
              <div style={{
                aspectRatio: '1 / 1.4',
                background: 'var(--color-bg-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img
                  src={img.url}
                  alt={`page ${img.page}`}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  loading="lazy"
                />
              </div>
              <div className="oa-card-body" style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {img.taskId.slice(0, 8)} · 第 {img.page} 页
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          data-testid="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: 24, cursor: 'zoom-out',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={lightbox.url}
              alt={`page ${lightbox.page}`}
              style={{ maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain', background: '#fff' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default GalleryPage