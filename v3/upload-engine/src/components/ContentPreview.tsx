// ============================================================
// ContentPreview — Online 内容预览 Modal
// 从服务端 URL 拉取文件，在线渲染，无需下载
// PDF → 浏览器内嵌预览 | 文档 → 文本提取 | 图片/视频/音频 → 原生渲染
// ============================================================

import React, { useState, useEffect, useCallback } from 'react'
import type { UploadFile } from '../types'
import { formatSize } from '../validator'

interface Props {
  file: UploadFile
  onClose: () => void
}

const D = {
  purple: '#7c3aed',
  green: '#059669',
  red: '#dc2626',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
}

type LoadState = 'loading' | 'loaded' | 'error'

const IMG = /^(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/i
const VID = /^(mp4|mov|mkv|webm|avi|m4v|flv|wmv|ts)$/i
const AUD = /^(mp3|wav|ogg|m4a|aac|wma|pcm|amr)$/i
const TXT = /^(txt|md|csv|json|xml|html|htm|css|js|ts|jsx|tsx|py|java|go|rs|yaml|yml|toml|ini|cfg|log|srt|sql|sh|bash|zsh)$/i

export const ContentPreview: React.FC<Props> = ({ file, onClose }) => {
  const [state, setState] = useState<LoadState>('loading')
  const [contentUrl, setContentUrl] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [mimeType, setMimeType] = useState<string>('')

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isImage = IMG.test(ext)
  const isVideo = VID.test(ext)
  const isAudio = AUD.test(ext)
  const isPdf = ext === 'pdf'
  const isText = TXT.test(ext)
  // office 文档：doc/docx/xls/xlsx/ppt/pptx 等
  const isOffice = /^(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i.test(ext)

  // 从服务端 URL 拉取文件
  useEffect(() => {
    if (!file.url) {
      setErrorMsg('没有可用的服务端地址')
      setState('error')
      return
    }

    let cancelled = false
    setState('loading')
    setTextContent(null)
    setContentUrl(null)

    const load = async () => {
      try {
        const resp = await fetch(file.url!)
        if (!resp.ok) {
          if (!cancelled) { setErrorMsg(`服务端返回 HTTP ${resp.status}`); setState('error') }
          return
        }

        const blob = await resp.blob()
        if (cancelled) return

        const blobUrl = URL.createObjectURL(blob)
        const ct = blob.type || resp.headers.get('Content-Type') || ''
        setMimeType(ct)

        if (isImage || isVideo || isAudio) {
          setContentUrl(blobUrl)
          setState('loaded')
        } else if (isPdf) {
          // PDF 浏览器内嵌预览
          setContentUrl(blobUrl)
          setState('loaded')
        } else if (isText) {
          const text = await blob.text()
          if (!cancelled) { setTextContent(text); setState('loaded') }
        } else if (isOffice) {
          // Office 文档：尝试提取文本内容
          try {
            const text = await blob.text()
            // 从二进制中提取可读文本
            const readable = extractReadableText(text, ext)
            if (!cancelled) {
              if (readable.trim().length > 50) {
                setTextContent(readable)
              } else {
                setTextContent(`[${ext.toUpperCase()} 文档 — ${formatSize(file.size)}]\n\n此文档格式需服务端渲染引擎支持。\n生产环境可通过 OnlyOffice / LibreOffice Server 转为 HTML/PDF 在线预览。\n\n文件已从服务端加载，可通过上方 URL 访问。`)
              }
              setState('loaded')
            }
          } catch {
            if (!cancelled) { setErrorMsg('文档解析失败'); setState('error') }
          }
        } else {
          // 未知格式，尝试当文本读取
          try {
            const text = await blob.text()
            if (!cancelled && text.length > 0) {
              setTextContent(text)
              setState('loaded')
            }
          } catch {
            if (!cancelled) { setErrorMsg('无法预览此文件格式'); setState('error') }
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err.message ?? '网络请求失败')
          setState('error')
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [file.url])

  // 清理 blob URL
  useEffect(() => {
    return () => {
      if (contentUrl?.startsWith('blob:')) URL.revokeObjectURL(contentUrl)
    }
  }, [contentUrl])

  const handleCopy = useCallback(async () => {
    if (!textContent) return
    try {
      await navigator.clipboard.writeText(textContent)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = textContent
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select(); document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [textContent])

  // Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const icon = isPdf ? '📕' : isImage ? '🖼️' : isVideo ? '🎬' : isAudio ? '🎵' : isOffice ? '📊' : '📄'

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={{ fontSize: 24 }}>{icon}</span>
            <div>
              <div style={styles.title}>{file.name}</div>
              <div style={styles.subtitle}>
                {formatSize(file.size)} · {(ext || 'bin').toUpperCase()}
                {mimeType && <span style={{ marginLeft: 8, color: D.gray400 }}>{mimeType}</span>}
                {file.hash && (
                  <span style={{ marginLeft: 12, fontFamily: 'monospace', fontSize: 11, color: D.gray400 }}>
                    SHA256: {file.hash.slice(0, 16)}...
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={styles.headerRight}>
            {textContent && (
              <button onClick={handleCopy} style={actionBtnStyle(copied)}>
                {copied ? '✓ 已复制' : '📋 复制内容'}
              </button>
            )}
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
        </div>

        {/* Server URL bar */}
        {file.url && (
          <div style={styles.urlBar}>
            <span style={{ fontSize: 11, color: D.gray400, marginRight: 8 }}>服务端</span>
            <code style={styles.urlCode}>{file.url}</code>
            <span style={{
              fontSize: 10, marginLeft: 8, padding: '2px 8px', borderRadius: 4,
              background: state === 'loading' ? '#eff6ff' : state === 'error' ? '#fef2f2' : '#ecfdf5',
              color: state === 'loading' ? '#2563eb' : state === 'error' ? D.red : D.green,
            }}>
              {state === 'loading' ? '加载中...' : state === 'error' ? '失败' : '已加载'}
            </span>
          </div>
        )}

        {/* Body */}
        <div style={styles.body}>
          {state === 'loading' && (
            <div style={styles.centerBox}>
              <div style={styles.spinner} />
              <div style={{ fontSize: 14, color: D.gray500, marginTop: 16 }}>正在从服务端拉取文件...</div>
              <div style={{ fontSize: 12, color: D.gray400, marginTop: 4, fontFamily: 'monospace' }}>
                GET {file.url}
              </div>
            </div>
          )}

          {state === 'error' && (
            <div style={styles.centerBox}>
              <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 16 }}>⚠️</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: D.gray700, marginBottom: 8 }}>加载失败</div>
              <div style={{ fontSize: 13, color: D.gray500 }}>{errorMsg}</div>
              <button onClick={() => {
                setState('loading')
                setErrorMsg(null)
                // 重新触发 fetch
                const load = async () => {
                  try {
                    const resp = await fetch(file.url!)
                    if (!resp.ok) { setErrorMsg(`HTTP ${resp.status}`); setState('error'); return }
                    const blob = await resp.blob()
                    const blobUrl = URL.createObjectURL(blob)
                    if (isImage || isVideo || isAudio || isPdf) {
                      setContentUrl(blobUrl)
                    } else {
                      const text = await blob.text()
                      setTextContent(text)
                    }
                    setState('loaded')
                  } catch (err: any) {
                    setErrorMsg(err.message ?? '重试失败')
                    setState('error')
                  }
                }
                load()
              }} style={{
                marginTop: 16, padding: '6px 16px', fontSize: 12,
                border: `1px solid ${D.purple}`, borderRadius: 6,
                background: '#fff', color: D.purple, cursor: 'pointer',
              }}>
                重试
              </button>
            </div>
          )}

          {state === 'loaded' && (
            <>
              {/* Image inline */}
              {isImage && contentUrl && (
                <div style={styles.mediaWrap}>
                  <img src={contentUrl} alt={file.name} style={styles.image} />
                </div>
              )}

              {/* Video player */}
              {isVideo && contentUrl && (
                <div style={styles.mediaWrap}>
                  <video controls autoPlay style={styles.video} src={contentUrl} />
                </div>
              )}

              {/* Audio player */}
              {isAudio && contentUrl && (
                <div style={{ ...styles.centerBox, padding: 40 }}>
                  <div style={{ fontSize: 48, marginBottom: 20 }}>🎵</div>
                  <audio controls autoPlay style={{ width: '100%', maxWidth: 420 }}>
                    <source src={contentUrl} type={mimeType || file.type} />
                  </audio>
                </div>
              )}

              {/* PDF — 浏览器内嵌 iframe 预览 */}
              {isPdf && contentUrl && (
                <iframe
                  src={contentUrl}
                  style={{ width: '100%', height: '100%', minHeight: 500, border: 'none' }}
                  title={file.name}
                />
              )}

              {/* Text / Office extracted text */}
              {textContent && (
                <div style={styles.textBox}>
                  <pre style={styles.textPre}>{textContent}</pre>
                </div>
              )}

              {/* Fallback — 不应该到这里 */}
              {!isImage && !isVideo && !isAudio && !isPdf && !textContent && contentUrl && (
                <div style={styles.centerBox}>
                  <div style={{ fontSize: 64, opacity: 0.3, marginBottom: 16 }}>📄</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: D.gray700, marginBottom: 8 }}>
                    {(ext || 'bin').toUpperCase()} 文件
                  </div>
                  <div style={{ fontSize: 13, color: D.gray500 }}>
                    文件已从服务端加载（{formatSize(file.size)}），浏览器不支持直接预览此格式
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// 从 Office 二进制中提取可读文本
function extractReadableText(raw: string, ext: string): string {
  // 过滤掉不可打印字符，保留中英文、数字、标点
  const cleaned = raw.replace(/[^\x20-\x7E\u4e00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\n\r\t]/g, '')
  // 去掉过短的行
  const lines = cleaned.split(/\n/).filter(l => l.trim().length > 0)
  // 如果提取出足够多的行，说明是可读内容
  if (lines.length > 3) {
    return lines.join('\n')
  }
  return cleaned.substring(0, 5000)
}

function actionBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 500,
    background: active ? D.green : D.gray100,
    color: active ? '#fff' : D.gray700,
    border: 'none', borderRadius: 6, cursor: 'pointer',
    transition: 'all .15s',
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    width: 'min(1000px, 94vw)', height: 'min(90vh, 800px)',
    background: '#fff', borderRadius: 16,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px', borderBottom: `1px solid ${D.gray200}`, flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 16, fontWeight: 600, color: D.gray900, wordBreak: 'break-all' },
  subtitle: { fontSize: 12, color: D.gray500, marginTop: 2 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  closeBtn: {
    width: 32, height: 32, border: 'none', borderRadius: 8, cursor: 'pointer',
    fontSize: 16, color: D.gray500, background: D.gray100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  urlBar: {
    display: 'flex', alignItems: 'center',
    padding: '8px 24px', background: D.gray50,
    borderBottom: `1px solid ${D.gray200}`, flexShrink: 0,
  },
  urlCode: {
    fontSize: 11, fontFamily: 'monospace', color: D.purple,
    background: '#fff', padding: '3px 10px', borderRadius: 4,
    border: `1px solid ${D.gray200}`, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
  },
  body: {
    flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column',
  },
  centerBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, minHeight: 300, padding: 40,
  },
  spinner: {
    width: 40, height: 40, borderRadius: '50%',
    border: `3px solid ${D.gray200}`, borderTopColor: D.purple,
    animation: 'spin 0.8s linear infinite',
  },
  mediaWrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, background: D.gray50, minHeight: 300,
  },
  image: {
    maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
  },
  video: {
    width: '100%', maxHeight: '100%', borderRadius: 8,
    background: '#000', outline: 'none',
  },
  textBox: {
    background: '#1e1e1e', flex: 1, overflow: 'auto', minHeight: 300,
  },
  textPre: {
    margin: 0, padding: 24, fontSize: 13, lineHeight: 1.85,
    color: '#d4d4d4', fontFamily: "'SF Mono','Monaco','Menlo','Consolas',monospace",
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    userSelect: 'text', tabSize: 2,
  },
}