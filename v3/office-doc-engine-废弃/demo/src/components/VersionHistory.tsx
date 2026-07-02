import React, { useState } from 'react'
import type { VersionStore } from '../history/VersionStore'
import { DiffEngine } from '../history/DiffEngine'
import type { VersionSnapshot, DiffChunk } from '../core/types'

interface VersionHistoryProps {
  store: VersionStore
  isOpen: boolean
  onClose: () => void
  onRestore: (snapshotId: string) => void
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({ store, isOpen, onClose, onRestore }) => {
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>(store.list())
  const [selectedA, setSelectedA] = useState<string | null>(null)
  const [selectedB, setSelectedB] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffChunk[] | null>(null)

  if (!isOpen) return null

  const refresh = () => setSnapshots(store.list())

  const compare = () => {
    if (!selectedA || !selectedB) return
    const snapA = store.get(selectedA)
    const snapB = store.get(selectedB)
    if (!snapA || !snapB) return

    const textA = JSON.stringify(snapA.content)
    const textB = JSON.stringify(snapB.content)
    setDiff(DiffEngine.diff(textA, textB))
  }

  const handleRestore = (id: string) => {
    onRestore(id)
    onClose()
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
    }}>
      <div style={{
        width: '80vw',
        maxWidth: 900,
        maxHeight: '80vh',
        background: '#1e1e2e',
        borderRadius: 12,
        border: '1px solid #313244',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #313244',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 700, color: '#fab387', fontSize: 15 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -3, marginRight: 6 }}>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            版本历史
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#6c7086',
            cursor: 'pointer', fontSize: 18, padding: 0,
          }}>
            x
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: snapshot list */}
          <div style={{
            width: 300,
            borderRight: '1px solid #313244',
            overflow: 'auto',
            padding: 8,
          }}>
            {snapshots.length === 0 && (
              <div style={{ color: '#6c7086', fontSize: 13, padding: 16, textAlign: 'center' }}>
                暂无版本快照，开始编辑后自动创建
              </div>
            )}
            {snapshots.map(snap => (
              <div
                key={snap.id}
                onClick={() => {
                  if (!selectedA) setSelectedA(snap.id)
                  else if (!selectedB && snap.id !== selectedA) setSelectedB(snap.id)
                  else { setSelectedA(snap.id); setSelectedB(null) }
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: (snap.id === selectedA || snap.id === selectedB)
                    ? snap.id === selectedA ? '#cba6f722' : '#fab38722'
                    : 'transparent',
                  border: (snap.id === selectedA || snap.id === selectedB)
                    ? `1px solid ${snap.id === selectedA ? '#cba6f7' : '#fab387'}`
                    : '1px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#cdd6f4' }}>
                  {snap.label}
                  {snap.isPinned && <span style={{ color: '#f9e2af', marginLeft: 6, fontSize: 11 }}>已固定</span>}
                </div>
                <div style={{ fontSize: 11, color: '#6c7086', marginTop: 2 }}>
                  {new Date(snap.timestamp).toLocaleString('zh-CN')} · {snap.author}
                </div>
              </div>
            ))}
          </div>

          {/* Right: diff view */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {!selectedA && !selectedB && (
              <div style={{ color: '#6c7086', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
                选择左侧版本进行对比<br />
                <span style={{ fontSize: 11 }}>点击第一个版本作为基准，第二个版本作为对比</span>
              </div>
            )}

            {selectedA && selectedB && !diff && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <button
                  onClick={compare}
                  style={{
                    background: '#cba6f7',
                    border: 'none',
                    color: '#1e1e2e',
                    padding: '8px 20px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: 'inherit',
                  }}
                >
                  对比差异
                </button>
              </div>
            )}

            {diff && (
              <>
                <div style={{ marginBottom: 12, display: 'flex', gap: 12, fontSize: 13 }}>
                  <span style={{ color: '#a6e3a1' }}>+{DiffEngine.summary(diff).added} 新增</span>
                  <span style={{ color: '#f38ba8' }}>-{DiffEngine.summary(diff).removed} 删除</span>
                  <span style={{ color: '#6c7086' }}>{DiffEngine.summary(diff).unchanged} 未变</span>
                </div>
                <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {diff.map((chunk, i) => (
                    <span
                      key={i}
                      style={{
                        background: chunk.type === 'insert' ? '#a6e3a133' : chunk.type === 'delete' ? '#f38ba833' : 'transparent',
                        color: chunk.type === 'insert' ? '#a6e3a1' : chunk.type === 'delete' ? '#f38ba8' : '#cdd6f4',
                        textDecoration: chunk.type === 'delete' ? 'line-through' : 'none',
                      }}
                    >
                      {chunk.text}
                    </span>
                  ))}
                </div>
              </>
            )}

            {selectedA && store.get(selectedA) && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <button
                  onClick={() => handleRestore(selectedA)}
                  style={{
                    background: '#fab387',
                    border: 'none',
                    color: '#1e1e2e',
                    padding: '6px 16px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    fontWeight: 700,
                  }}
                >
                  恢复到此版本
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}