import React from 'react'

interface POICardProps {
  title: string
  address?: string
  rating?: number
  distance?: string
  category?: string
  imageUrl?: string
}

export function POICard({ title, address, rating, distance, category, imageUrl }: POICardProps) {
  const stars = rating ? Math.round(rating) : 0

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      display: 'flex', gap: 12, maxWidth: 360, border: '1px solid #f0f0f0',
    }}>
      {/* 图标/封面 */}
      <div style={{
        width: 64, height: 64, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
        background: imageUrl ? 'transparent' : 'linear-gradient(135deg, #1890ff 0%, #36cfc9 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {imageUrl
          ? <img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <span style={{ fontSize: 28 }}>📍</span>
        }
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#262626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {category && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#f0f5ff', color: '#597ef7', flexShrink: 0 }}>
              {category}
            </span>
          )}
        </div>

        {address && (
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {address}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {rating !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ color: '#faad14', fontSize: 12 }}>{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
              <span style={{ fontSize: 12, color: '#595959', fontWeight: 600 }}>{rating.toFixed(1)}</span>
            </div>
          )}
          {distance && (
            <span style={{ fontSize: 11, color: '#1890ff' }}>📏 {distance}</span>
          )}
        </div>
      </div>
    </div>
  )
}
