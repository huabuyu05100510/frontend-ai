// 模型：claude-sonnet-4-6
// AnnotationPopup — Modal-wrapped form for adding/editing an annotation
//
// Form fields (conditional on kind):
//   - align_fix: 2 select dropdowns (src index + tgt index) OR free text
//   - seg_rating: 1-5 star picker + textarea
//   - alt_trans: textarea
// Submit: ⌘+Enter or Cmd+Enter
// Esc closes
// Uses <Modal> from ./Modal (focus trap, Esc, AnimatePresence)

import { useEffect, useState, KeyboardEvent } from 'react'
import { Modal } from './Modal'
import { useAnnotation } from '../hooks/useAnnotation'
import type { AnnotationKind, TranslateAnnotation } from '../types'

export interface AnnotationPopupProps {
  open: boolean
  onClose: () => void
  taskId: string
  segmentId?: string
  kind?: AnnotationKind
  srcText?: string
  tgtText?: string
  initialPayload?: object
  editingId?: string
  onSaved?: (ann: TranslateAnnotation) => void
}

const STAR_LABELS = ['1', '2', '3', '4', '5']

function defaultKindPayload(kind: AnnotationKind, srcText: string, tgtText: string): Record<string, unknown> {
  if (kind === 'align_fix') {
    return {
      srcIndex: 0,
      tgtIndex: 0,
      srcText,
      tgtText,
    }
  }
  if (kind === 'seg_rating') {
    return { rating: 3, comment: '' }
  }
  return { text: '' }
}

function payloadFromObject(payload: object | undefined): Record<string, unknown> {
  if (!payload) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) return {}
  return payload as Record<string, unknown>
}

export function AnnotationPopup({
  open,
  onClose,
  taskId,
  segmentId,
  kind: kindProp,
  srcText = '',
  tgtText = '',
  initialPayload,
  editingId,
  onSaved,
}: AnnotationPopupProps) {
  const kind: AnnotationKind = kindProp ?? 'alt_trans'
  const { addAnnotation } = useAnnotation(taskId)
  const [payload, setPayload] = useState<Record<string, unknown>>(() => ({
    ...defaultKindPayload(kind, srcText, tgtText),
    ...payloadFromObject(initialPayload),
  }))
  const [submitting, setSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Reset state when popup opens or kind/initialPayload changes
  useEffect(() => {
    if (!open) return
    setPayload({
      ...defaultKindPayload(kind, srcText, tgtText),
      ...payloadFromObject(initialPayload),
    })
    setValidationError(null)
    setSubmitting(false)
  }, [open, kind, srcText, tgtText, initialPayload])

  const validate = (): string | null => {
    if (kind === 'alt_trans') {
      const text = String(payload.text ?? '').trim()
      if (!text) return '请输入备选译文'
    } else if (kind === 'seg_rating') {
      const r = Number(payload.rating ?? 0)
      if (!(r >= 1 && r <= 5)) return '请选择 1-5 星评分'
    } else if (kind === 'align_fix') {
      if (typeof payload.srcIndex !== 'number' || typeof payload.tgtIndex !== 'number') {
        return '请选择对齐源/目标索引'
      }
    }
    return null
  }

  const handleSubmit = async () => {
    const err = validate()
    if (err) {
      setValidationError(err)
      return
    }
    setSubmitting(true)
    setValidationError(null)
    const ts = new Date().toISOString()
    console.info(
      `[translate-annotation ${ts}] action=popup-save kind=${kind} segId=${segmentId ?? ''} note=popup save`,
    )
    const result = await addAnnotation({
      taskId,
      segmentId: segmentId ?? '0',
      kind,
      srcText,
      tgtText,
      payload,
    })
    setSubmitting(false)
    if (result) {
      onSaved?.(result)
      onClose()
    } else {
      setValidationError('保存失败，请重试')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  // Split src/tgt into tokens for align_fix selects
  const srcTokens = srcText ? srcText.split(/\s+/).filter(Boolean) : []
  const tgtTokens = tgtText ? tgtText.split(/\s+/).filter(Boolean) : []

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={editingId ? '编辑标注' : '添加标注'}
      width="md"
      data-testid="oa-annotation-popup"
    >
      <div
        className="oa-annotation-popup"
        data-testid="oa-annotation-popup"
        data-kind={kind}
        role="dialog"
        aria-modal="true"
        onKeyDown={handleKeyDown}
      >
        {/* Kind header / indicator */}
        <div
          className="oa-annotation-popup-kind"
          data-testid={`oa-annotation-popup-kind-${kind}`}
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          类型：<strong>{kind === 'align_fix' ? '对齐修正' : kind === 'seg_rating' ? '段落评分' : '备选翻译'}</strong>
          {editingId && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>(编辑 {editingId})</span>}
        </div>

        {/* align_fix form */}
        {kind === 'align_fix' && (
          <div className="oa-annotation-popup-form-align_fix" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>源端 token 索引</span>
              <select
                data-testid="oa-annotation-popup-src-select"
                value={String(payload.srcIndex ?? 0)}
                onChange={(e) => setPayload(p => ({ ...p, srcIndex: Number(e.target.value) }))}
                style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 4 }}
              >
                {srcTokens.map((t, i) => (
                  <option key={i} value={String(i)}>{i}: {t}</option>
                ))}
                {srcTokens.length === 0 && <option value="0">(无 token)</option>}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>目标端 token 索引</span>
              <select
                data-testid="oa-annotation-popup-tgt-select"
                value={String(payload.tgtIndex ?? 0)}
                onChange={(e) => setPayload(p => ({ ...p, tgtIndex: Number(e.target.value) }))}
                style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 4 }}
              >
                {tgtTokens.map((t, i) => (
                  <option key={i} value={String(i)}>{i}: {t}</option>
                ))}
                {tgtTokens.length === 0 && <option value="0">(无 token)</option>}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>备注（可选）</span>
              <textarea
                data-testid="oa-annotation-popup-textarea"
                value={String(payload.comment ?? '')}
                onChange={(e) => setPayload(p => ({ ...p, comment: e.target.value }))}
                rows={2}
                style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, resize: 'vertical' }}
              />
            </label>
          </div>
        )}

        {/* seg_rating form */}
        {kind === 'seg_rating' && (
          <div className="oa-annotation-popup-form-seg_rating" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span style={{ fontSize: 13, marginRight: 8 }}>评分：</span>
              {STAR_LABELS.map(label => {
                const n = Number(label)
                const current = Number(payload.rating ?? 0)
                const active = n <= current
                return (
                  <button
                    key={label}
                    type="button"
                    data-testid={`oa-annotation-popup-star-${label}`}
                    onClick={() => setPayload(p => ({ ...p, rating: n }))}
                    aria-label={`${n} 星`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 22,
                      color: active ? 'var(--color-warning)' : 'var(--color-border-strong)',
                      padding: '0 4px',
                    }}
                  >
                    ★
                  </button>
                )
              })}
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {Number(payload.rating ?? 0)}/5
              </span>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>反馈（可选）</span>
              <textarea
                data-testid="oa-annotation-popup-textarea"
                value={String(payload.comment ?? '')}
                onChange={(e) => setPayload(p => ({ ...p, comment: e.target.value }))}
                rows={3}
                style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, resize: 'vertical' }}
              />
            </label>
          </div>
        )}

        {/* alt_trans form */}
        {kind === 'alt_trans' && (
          <div className="oa-annotation-popup-form-alt_trans" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {srcText && (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                原文：<span style={{ color: 'var(--color-text)' }}>{srcText}</span>
              </div>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>备选译文</span>
              <textarea
                data-testid="oa-annotation-popup-textarea"
                value={String(payload.text ?? '')}
                onChange={(e) => setPayload(p => ({ ...p, text: e.target.value }))}
                rows={3}
                placeholder="输入更准确的翻译…"
                style={{ padding: 6, border: '1px solid var(--color-border)', borderRadius: 4, resize: 'vertical' }}
              />
            </label>
          </div>
        )}

        {/* Validation error */}
        {validationError && (
          <div
            data-testid="oa-annotation-popup-error"
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {validationError}
          </div>
        )}

        {/* Footer */}
        <div
          className="oa-annotation-popup-footer"
          data-testid="oa-annotation-popup-footer"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--color-border-light)',
          }}
        >
          <span style={{ flex: 1, fontSize: 11, color: 'var(--color-text-tertiary)', alignSelf: 'center' }}>
            ⌘+Enter 提交
          </span>
          <button
            type="button"
            data-testid="oa-annotation-popup-cancel"
            onClick={() => onClose()}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderRadius: 4,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="oa-annotation-popup-submit"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            style={{
              padding: '6px 14px',
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-text-inverse)',
              borderRadius: 4,
              fontSize: 13,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? '保存中…' : editingId ? '更新' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}