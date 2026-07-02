/**
 * OCR 字段配置面板
 *
 * 设置字段名、数据类型、必填、校验规则。
 * 字段名为空时保存按钮禁用。
 *
 * @module scenes/ocr-custom/ConfigPanel
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { FieldConfig, FieldDataType } from '../../core/types';
import { toast } from '../../components/Toast';

interface ConfigPanelProps {
  fieldId: string | null;
  initialRect?: { x: number; y: number; w: number; h: number } | null;
  initialConfig?: Partial<FieldConfig> | null;
  onSave: (config: Omit<FieldConfig, 'id'> & { id?: string }) => void;
  onDelete: (fieldId: string) => void;
  onClose: () => void;
}

const DATA_TYPES: Array<{ value: FieldDataType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '复选框' },
  { value: 'select', label: '下拉' },
];

/**
 * 字段配置面板
 */
export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  fieldId,
  initialRect,
  initialConfig,
  onSave,
  onDelete,
  onClose,
}) => {
  const [label, setLabel] = useState(initialConfig?.label ?? '');
  const [dataType, setDataType] = useState<FieldDataType>(initialConfig?.dataType ?? 'text');
  const [required, setRequired] = useState(initialConfig?.required ?? false);
  const [regex, setRegex] = useState(initialConfig?.regex ?? '');
  const [description, setDescription] = useState(initialConfig?.description ?? '');
  const [error, setError] = useState('');

  // fieldId 变化时重置表单
  useEffect(() => {
    setLabel(initialConfig?.label ?? '');
    setDataType(initialConfig?.dataType ?? 'text');
    setRequired(initialConfig?.required ?? false);
    setRegex(initialConfig?.regex ?? '');
    setDescription(initialConfig?.description ?? '');
    setError('');
  }, [fieldId, initialConfig]);

  const handleSave = useCallback(() => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('请输入字段名');
      return;
    }

    onSave({
      id: fieldId ?? undefined,
      label: trimmedLabel,
      dataType,
      required,
      regex: regex.trim() || undefined,
      description: description.trim() || undefined,
      order: initialConfig?.order ?? 0,
    });

    toast.success(fieldId ? '字段已更新' : '字段已添加');
  }, [label, dataType, required, regex, description, fieldId, initialConfig, onSave]);

  const handleDelete = useCallback(() => {
    if (!fieldId) return;
    if (!window.confirm(`确认删除字段「${initialConfig?.label ?? label}」？`)) return;
    onDelete(fieldId);
  }, [fieldId, initialConfig, label, onDelete]);

  if (!fieldId) return null;

  return (
    <div
      role="dialog"
      aria-label="字段配置"
      style={{
        width: '300px',
        borderLeft: '1px solid #e8e8e8',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '15px' }}>
          {fieldId.startsWith('temp_') ? '新建字段' : '编辑字段'}
        </h3>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#999',
            padding: '2px 6px',
          }}
          title="关闭"
        >
          ×
        </button>
      </div>

      {/* 字段名 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontWeight: 500 }}>字段名 *</span>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setError(''); }}
          placeholder="如：发票号码"
          autoFocus
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: error ? '1px solid #ff4d4f' : '1px solid #d9d9d9',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        {error && <span style={{ color: '#ff4d4f', fontSize: '12px' }}>{error}</span>}
      </label>

      {/* 数据类型 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontWeight: 500 }}>数据类型</span>
        <select
          value={dataType}
          onChange={(e) => setDataType(e.target.value as FieldDataType)}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: '1px solid #d9d9d9',
            fontSize: '13px',
            outline: 'none',
          }}
        >
          {DATA_TYPES.map(dt => (
            <option key={dt.value} value={dt.value}>{dt.label}</option>
          ))}
        </select>
      </label>

      {/* 必填 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        <span style={{ fontWeight: 500 }}>必填</span>
      </label>

      {/* 校验规则 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontWeight: 500 }}>校验规则（选填）</span>
        <input
          type="text"
          value={regex}
          onChange={(e) => setRegex(e.target.value)}
          placeholder="正则表达式，如：^\d{8}$"
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: '1px solid #d9d9d9',
            fontSize: '13px',
            outline: 'none',
          }}
        />
      </label>

      {/* 备注 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontWeight: 500 }}>备注（选填）</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="字段说明..."
          rows={2}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: '1px solid #d9d9d9',
            fontSize: '13px',
            outline: 'none',
            resize: 'vertical',
          }}
        />
      </label>

      {/* 按钮 */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          disabled={!label.trim()}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: '4px',
            border: 'none',
            background: label.trim() ? '#1890ff' : '#d9d9d9',
            color: '#fff',
            cursor: label.trim() ? 'pointer' : 'not-allowed',
            fontSize: '13px',
          }}
        >
          保存字段
        </button>
        {fieldId && !fieldId.startsWith('temp_') && (
          <button
            onClick={handleDelete}
            style={{
              padding: '8px 12px',
              borderRadius: '4px',
              border: '1px solid #ff4d4f',
              background: '#fff',
              color: '#ff4d4f',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            删除字段
          </button>
        )}
      </div>

      {initialRect && (
        <div style={{ fontSize: '12px', color: '#999' }}>
          位置: ({Math.round(initialRect.x)}, {Math.round(initialRect.y)}) | 大小: {Math.round(initialRect.w)}×{Math.round(initialRect.h)}
        </div>
      )}
    </div>
  );
};

ConfigPanel.displayName = 'ConfigPanel';