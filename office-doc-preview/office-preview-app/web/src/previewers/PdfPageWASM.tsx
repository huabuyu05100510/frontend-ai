// PdfPageWASM：单页 WASM 渲染组件（v2 — Worker + 渐进式渲染）
// 模型：claude-sonnet-4-6
//
// v2 改动：
//   - 删除内联 fetch + loadDocument + page.render 主线程阻塞
//   - 所有 WASM 操作通过 PdfWasmCoordinator → Web Worker
//   - 渐进式渲染：0.5x 低清 ImageBitmap 先显示 → 1.0x 全清替换
//   - 文字层从 Worker Float32Array 构建 DOM span
//   - doc 缓存由 Coordinator 管理，共享给 PdfPreviewWASM_v2
//   - 保持现有 Props 接口向后兼容
//
// 与 PdfPreviewWASM v2 的关系：
//   - PdfPageWASM：渲染单页到 slot，用于翻译双栏等场景
//   - PdfPreviewWASM v2：整本文档查看器（虚拟滚动 + 缩放）

import { useEffect, useRef, useState } from 'react'
import { getCoordinator } from './pdf-wasm/coordinator'
import { buildTextLayerFromCharBoxes } from './pdf-wasm/text-layer-builder'

// ============ 组件 ============

interface Props {
  url: string
  pageNum: number
  scale?: number
  targetW?: number
  targetH?: number
  noTextLayer?: boolean
  /** 服务端文字层 URL（上传文件场景可用，跳过 Worker 文字提取） */
  serverTextUrl?: string
}

/**
 * 单页 WASM 渲染 v2。挂载后通过 Worker 渲染 canvas + 透明文字层。
 */
export function PdfPageWASM({ url, pageNum, scale = 1.5, targetW, targetH, noTextLayer, serverTextUrl }: Props) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [progPhase, setProgPhase] = useState<'lowRes' | 'fullRes' | ''>('')

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | null = null
    const coordinator = getCoordinator()
    console.log('[pdf-page-wasm-v2] mount', url, 'page=', pageNum, 'targetW=', targetW, 'targetH=', targetH)

    setPhase('loading')
    setErrMsg('')
    setProgPhase('')

    ;(async () => {
      try {
        // 1. 打开文档（Coordinator 管理缓存）
        const { docId, pageSizes, release: doRelease } = await coordinator.openDocument(url)
        if (cancelled) { doRelease(); return }
        release = doRelease

        // 2. 获取本页尺寸，计算 scale
        const pageMeta = pageSizes[pageNum - 1]
        if (!pageMeta) throw new Error(`page ${pageNum} not found`)

        const originalW = pageMeta.w
        const originalH = pageMeta.h
        const computedScale = targetW != null ? targetW / originalW : scale

        setPhase('rendering')

        // 3. 渐进式渲染：Coordinator 先发 0.5x 低清，后发全清
        const t0 = performance.now()
        const slot = slotRef.current
        if (!slot || cancelled) return

        coordinator.requestRender(docId, pageNum, computedScale, {
          priority: 'high',
          onBitmap: (result) => {
            if (cancelled) { try { result.bitmap.close() } catch {}; return }
            applyBitmap(slot, result)
            if (result.phase === 'low') {
              setProgPhase('lowRes')
              console.log('[pdf-page-wasm-v2] low-res', url, 'page=', pageNum, 'ms=', Math.round(performance.now() - t0))
            } else {
              setProgPhase('fullRes')
              console.log('[pdf-page-wasm-v2] full-res', url, 'page=', pageNum, 'ms=', Math.round(performance.now() - t0))
              setPhase('ready')
            }
          },
        })

        // 4. 文字层
        if (!noTextLayer) {
          loadTextLayer(cancelled ? null : slot, url, serverTextUrl, coordinator, docId, pageNum, computedScale, () => cancelled)
        }

      } catch (e: any) {
        if (!cancelled) {
          console.error('[pdf-page-wasm-v2] error', url, 'page=', pageNum, e?.message || e)
          setErrMsg(e?.message || String(e))
          setPhase('error')
        }
      }
    })()

    return () => {
      cancelled = true
      console.log('[pdf-page-wasm-v2] unmount', url, 'page=', pageNum)
      if (release) release()
    }
  }, [url, pageNum, scale, targetW, targetH])

  return (
    <div
      className={`pdf-page-wasm is-${phase}`}
      data-page={pageNum}
      data-url={url}
      data-testid={`pdf-page-wasm-${pageNum}`}
    >
      {phase === 'loading' && <div className="pdf-page-wasm-msg">下载 PDF…</div>}
      {phase === 'rendering' && progPhase !== 'fullRes' && (
        <div className="pdf-page-wasm-msg">
          {progPhase === 'lowRes' ? '精细渲染中…' : `渲染第 ${pageNum} 页…`}
        </div>
      )}
      {phase === 'error' && <div className="pdf-page-wasm-msg err">加载失败：{errMsg}</div>}
      <div className="pdf-page-wasm-slot" ref={slotRef} />
    </div>
  )
}

// ============ 内部工具 ============

function applyBitmap(slot: HTMLElement, result: { bitmap: ImageBitmap; width: number; height: number; phase: string }) {
  const { bitmap, width, height, phase } = result

  slot.style.width = `${width}px`
  slot.style.height = `${height}px`

  // 如果是低清替换全清，先移旧 canvas
  if (phase === 'full') {
    const existing = slot.querySelector('.pdf-page-wasm-canvas')
    if (existing) existing.remove()
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.className = 'pdf-page-wasm-canvas'
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(bitmap, 0, 0)
  }

  // 保留文字层
  const textLayer = slot.querySelector('.pdf-page-wasm-text')
  slot.textContent = ''
  slot.appendChild(canvas)
  if (textLayer) slot.appendChild(textLayer)
}

async function loadTextLayer(
  slot: HTMLElement | null,
  url: string,
  serverTextUrl: string | undefined,
  coordinator: ReturnType<typeof getCoordinator>,
  docId: number,
  pageNum: number,
  scale: number,
  isCancelled: () => boolean,
) {
  if (!slot || isCancelled()) return

  try {
    let textHtml = ''

    if (serverTextUrl) {
      // 服务端文字层（已有精准对齐）
      const resp = await fetch(serverTextUrl)
      if (resp.ok) {
        textHtml = await resp.text()
        // 提取 inner spans（对齐 PdfImagesPreview）
        const open = textHtml.indexOf('>')
        const close = textHtml.lastIndexOf('</div>')
        if (open >= 0 && close > open) textHtml = textHtml.slice(open + 1, close)
      }
    }

    if (!textHtml) {
      // Worker 文字提取
      const textResult = await coordinator.requestTextExtract(docId, pageNum, scale)
      if (isCancelled()) return
      textHtml = buildTextLayerFromCharBoxes(textResult.positions, textResult.chars, textResult.pageW, textResult.pageH)
    }

    if (isCancelled() || !textHtml) return

    const textLayer = document.createElement('div')
    textLayer.className = 'pdf-page-wasm-text'
    textLayer.innerHTML = textHtml
    slot.appendChild(textLayer)
  } catch (e) {
    console.warn('[pdf-page-wasm-v2] text-layer failed', e)
  }
}