// ============================================================
// ServerResponse — 服务端回传，极简卡片
// ============================================================

import React from 'react'
import type { UploadFile } from '../types'
import { formatSize } from '../validator'

interface ServerResponseData {
  url?: string
  instant?: boolean
  merged?: boolean
  merkleVerified?: boolean
  merkleRoot?: string
  mergeDuration?: number
  chunkCount?: number
  encrypted?: boolean
  protocol?: string
  requestId?: string
  serverTiming?: { hash?: number; merge?: number; total?: number }
}

interface Props {
  file: UploadFile | null
  responseData?: ServerResponseData | null
  protocolMetrics?: {
    protocol: string
    concurrency: number
    duration: number
    throughput: number
  } | null
}

const D = {
  purple: '#7c3aed',
  green: '#059669',
  greenBg: '#ecfdf5',
  blue: '#2563eb',
  red: '#dc2626',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

export const ServerResponse: React.FC<Props> = ({ file, responseData, protocolMetrics }) => {
  if (!file && !responseData) return null

  return (
    <div style={card}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: D.gray900 }}>
        📡 服务端回传
        {responseData?.protocol && (
          <span style={{ fontSize: 10, color: D.gray400, marginLeft: 6, fontFamily: 'monospace' }}>
            via {responseData.protocol}
          </span>
        )}
      </div>

      {file && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: D.gray900,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 6,
          }}>
            {file.name}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 10,
              background: file.status === 'done' ? D.greenBg :
                file.status === 'instant' ? '#f5f3ff' :
                file.status === 'failed' ? '#fef2f2' : '#eff6ff',
              color: file.status === 'done' ? D.green :
                file.status === 'instant' ? D.purple :
                file.status === 'failed' ? D.red : D.blue,
            }}>
              {file.status === 'done' ? '上传完成' :
               file.status === 'instant' ? '秒传命中' :
               file.status === 'failed' ? '失败' : file.status}
            </span>
            {file.status === 'instant' && (
              <span style={{ fontSize: 10, color: D.gray400 }}>文件已存在，无需重复上传</span>
            )}
          </div>
        </div>
      )}

      {responseData && (
        <div style={{
          background: D.gray50, borderRadius: 8, padding: '10px 12px',
          fontFamily: 'monospace', fontSize: 11, lineHeight: 1.9,
          maxHeight: 260, overflow: 'auto',
        }}>
          {responseData.requestId && <ResLine label="requestId" value={responseData.requestId} color={D.blue} />}
          {responseData.url && <ResLine label="url" value={responseData.url} color={D.green} mono />}
          {responseData.instant && <ResComment text="秒传命中" />}
          {responseData.merged && <ResComment text="分片合并完成" />}
          {responseData.merkleVerified !== undefined && (
            <ResLine label="merkleVerified" value={String(responseData.merkleVerified)} color={responseData.merkleVerified ? D.green : D.red} />
          )}
          {responseData.merkleRoot && <ResLine label="merkleRoot" value={responseData.merkleRoot.slice(0, 16) + '...'} />}
          {responseData.chunkCount != null && <ResLine label="chunkCount" value={String(responseData.chunkCount)} />}
          {responseData.encrypted && <ResComment text="AES-256-GCM 加密" />}
          {responseData.serverTiming && (
            <div style={{ color: D.gray500, marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e7eb' }}>
              <ResLine label="server hash" value={`${responseData.serverTiming.hash ?? 0}ms`} />
              <ResLine label="server merge" value={`${responseData.serverTiming.merge ?? 0}ms`} />
            </div>
          )}
        </div>
      )}

      {protocolMetrics && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: D.greenBg, borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: D.green, marginBottom: 6 }}>
            {protocolMetrics.protocol}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: D.gray400 }}>并发</span><span style={{ fontWeight: 500, color: D.gray700 }}>{protocolMetrics.concurrency}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: D.gray400 }}>耗时</span><span style={{ fontWeight: 500, color: D.gray700 }}>{(protocolMetrics.duration / 1000).toFixed(1)}s</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gridColumn: '1 / -1' }}>
              <span style={{ color: D.gray400 }}>吞吐</span><span style={{ fontWeight: 500, color: D.gray700 }}>{formatSize(protocolMetrics.throughput)}/s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResLine({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ color: D.gray500 }}>
      <span style={{ color: D.gray400 }}>{label}:</span>{' '}
      <span style={{ color: color ?? D.gray700, wordBreak: mono ? 'break-all' : undefined }}>
        {mono ? value : `"${value}"`}
      </span>
    </div>
  )
}

function ResComment({ text }: { text: string }) {
  return <div style={{ color: D.gray400, fontStyle: 'italic' }}>// {text}</div>
}

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 16,
  border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}