/**
 * 空状态占位组件
 *
 * 用于 OCR 未上传图片、智检无错误等场景。
 *
 * @module components/EmptyState
 */

import React from 'react';

interface EmptyStateProps {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title: string;
  /** 描述 */
  description?: string;
  /** 操作按钮 */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/** 默认空文件夹图标 */
function DefaultIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d9d9d9" strokeWidth="1.5">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

/**
 * 空状态组件
 *
 * @example
 * ```tsx
 * <EmptyState
 *   title="请上传图片"
 *   description="支持 JPG/PNG/PDF 格式"
 *   action={{ label: '上传图片', onClick: () => inputRef.current?.click() }}
 * />
 * ```
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        color: '#999',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        {icon ?? <DefaultIcon />}
      </div>
      <div style={{
        fontSize: '16px',
        fontWeight: 500,
        color: '#666',
        marginBottom: '8px',
      }}>
        {title}
      </div>
      {description && (
        <div style={{
          fontSize: '14px',
          color: '#999',
          marginBottom: '20px',
          maxWidth: '300px',
          textAlign: 'center',
        }}>
          {description}
        </div>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: '8px 24px',
            borderRadius: '6px',
            border: 'none',
            background: '#1890ff',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

EmptyState.displayName = 'EmptyState';