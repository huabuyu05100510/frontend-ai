import React, { useState, useEffect } from 'react'
import type { FieldConfig, Rect } from '../../core/types'

interface Props {
  fieldId: string | null
  initialRect: Rect | null
  initialConfig: Partial<FieldConfig> | null
  onSave: (config: FieldConfig) => void
  onDelete: (fieldId: string) => void
  onClose: () => void
}

const DATA_TYPE_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '复选框' },
  { value: 'select', label: '下拉' },
] as const

export function ConfigPanel({ fieldId, initialConfig, onSave, onDelete, onClose }: Props) {
  const [label, setLabel] = useState('')
  const [dataType, setDataType] = useState<FieldConfig['dataType']>('text')
  const [required, setRequired] = useState(false)
  const [regex, setRegex] = useState('')
  const [description, setDescription] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (initialConfig) {
      setLabel(initialConfig.label ?? '')
      setDataType(initialConfig.dataType ?? 'text')
      setRequired(initialConfig.required ?? false)
      setRegex(initialConfig.regex ?? '')
      setDescription(initialConfig.description ?? '')
    } else {
      setLabel('')
      setDataType('text')
      setRequired(false)
      setRegex('')
      setDescription('')
    }
    setSaved(false)
  }, [fieldId, initialConfig])

  if (!fieldId) return null

  const handleSave = () => {
    if (!label.trim()) return
    const config: FieldConfig = {
      id: fieldId,
      label: label.trim(),
      dataType,
      required,
      regex: regex.trim() || undefined,
      description: description.trim() || undefined,
      order: initialConfig?.order ?? Date.now(),
    }
    onSave(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handleDelete = () => {
    if (window.confirm(`确认删除字段「${label || fieldId}」？`)) {
      onDelete(fieldId)
    }
  }

  return (
    <div style={{
      width: 280, borderLeft: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column',
      background: '#fff', height: '100%',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid #e8e8e8',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>字段配置</span>
        <button onClick={onClose} style={{
          border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#8c8c8c',
          padding: '0 4px', lineHeight: 1,
        }}>×</button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>字段名 <span style={{ color: '#ff4d4f' }}>*</span></label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="如：发票号码"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>数据类型</label>
          <select
            value={dataType}
            onChange={e => setDataType(e.target.value as FieldConfig['dataType'])}
            style={inputStyle}
          >
            {DATA_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="required-checkbox"
            type="checkbox"
            checked={required}
            onChange={e => setRequired(e.target.checked)}
            style={{ width: 14, height: 14, cursor: 'pointer' }}
          />
          <label htmlFor="required-checkbox" style={{ fontSize: 13, color: '#262626', cursor: 'pointer' }}>
            是否必填
          </label>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>校验规则</label>
          <input
            value={regex}
            onChange={e => setRegex(e.target.value)}
            placeholder="正则表达式，选填"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>备注</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="字段说明，选填"
            rows={3}
            style={{ ...inputStyle, resize: 'none' }}
          />
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #e8e8e8', display: 'flex', gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!label.trim()}
          style={{
            flex: 1, padding: '7px 0', border: 'none', borderRadius: 5,
            background: label.trim() ? (saved ? '#52c41a' : '#1890ff') : '#d9d9d9',
            color: '#fff', fontSize: 13, cursor: label.trim() ? 'pointer' : 'not-allowed',
            transition: 'background .2s',
          }}
        >
          {saved ? '✓ 已保存' : '保存字段'}
        </button>
        <button
          onClick={handleDelete}
          style={{
            flex: 1, padding: '7px 0', border: '1px solid #ff4d4f', borderRadius: 5,
            background: '#fff5f5', color: '#ff4d4f', fontSize: 13, cursor: 'pointer',
          }}
        >
          删除字段
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#595959', marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid #d9d9d9',
  borderRadius: 4, fontSize: 13, boxSizing: 'border-box', outline: 'none',
  fontFamily: 'inherit', color: '#262626', background: '#fff',
}
