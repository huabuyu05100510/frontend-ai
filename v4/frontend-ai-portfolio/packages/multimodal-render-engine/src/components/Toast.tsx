/**
 * Toast 全局提示组件
 *
 * 支持 4 种类型：success / error / warning / info
 * 位置：页面顶部居中，入场/出场动画
 * 最多同时显示 3 条，自动消失 3s
 *
 * @module components/Toast
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  exiting?: boolean;
}

interface ToastManagerState {
  toasts: ToastItem[];
}

const MAX_TOASTS = 3;
let toastId = 0;
// 全局订阅者
const listeners = new Set<() => void>();
let globalState: ToastItem[] = [];

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function addToast(toast: Omit<ToastItem, 'id' | 'exiting'>): void {
  globalState = [...globalState, { ...toast, id: ++toastId }];
  // 最多 3 条
  while (globalState.length > MAX_TOASTS) {
    globalState.shift();
  }
  notifyListeners();
}

function removeToast(id: number): void {
  // 先标记 exiting 触发出场动画
  globalState = globalState.map(t => t.id === id ? { ...t, exiting: true } : t);
  notifyListeners();
  // 200ms 后实际移除
  setTimeout(() => {
    globalState = globalState.filter(t => t.id !== id);
    notifyListeners();
  }, 200);
}

/** Toast 类型配置 */
const TYPE_CONFIG: Record<ToastType, { bg: string; color: string; icon: string }> = {
  success: { bg: '#f6ffed', color: '#52c41a', icon: '✓' },
  error: { bg: '#fff2f0', color: '#ff4d4f', icon: '✕' },
  warning: { bg: '#fffbe6', color: '#fa8c16', icon: '⚠' },
  info: { bg: '#e6f7ff', color: '#1890ff', icon: 'ℹ' },
};

/**
 * Toast API — 命令式调用
 *
 * @example
 * ```ts
 * import { toast } from './Toast';
 * toast.success('复制成功');
 * toast.error('识别失败', { action: { label: '重试', onClick: retry } });
 * ```
 */
export const toast = {
  success(message: string, opts?: { action?: ToastItem['action']; duration?: number }): void {
    addToast({ type: 'success', message, duration: opts?.duration ?? 3000, action: opts?.action });
  },
  error(message: string, opts?: { action?: ToastItem['action']; duration?: number }): void {
    addToast({ type: 'error', message, duration: opts?.duration ?? 3000, action: opts?.action });
  },
  warning(message: string, opts?: { action?: ToastItem['action']; duration?: number }): void {
    addToast({ type: 'warning', message, duration: opts?.duration ?? 3000, action: opts?.action });
  },
  info(message: string, opts?: { action?: ToastItem['action']; duration?: number }): void {
    addToast({ type: 'info', message, duration: opts?.duration ?? 3000, action: opts?.action });
  },
};

/**
 * Toast 容器组件
 *
 * 挂载在 App 根组件中。
 */
export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = () => setToasts([...globalState]);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map(item => {
        const config = TYPE_CONFIG[item.type];
        return (
          <ToastItemView
            key={item.id}
            item={item}
            config={config}
            onRemove={() => removeToast(item.id)}
          />
        );
      })}
    </div>
  );
};

ToastContainer.displayName = 'ToastContainer';

/** 单个 Toast 项 */
const ToastItemView: React.FC<{
  item: ToastItem;
  config: typeof TYPE_CONFIG[ToastType];
  onRemove: () => void;
}> = ({ item, config, onRemove }) => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (item.duration > 0) {
      timerRef.current = setTimeout(onRemove, item.duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [item.duration, onRemove]);

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        borderRadius: '8px',
        background: config.bg,
        border: `1px solid ${config.color}`,
        color: '#333',
        fontSize: '14px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        pointerEvents: 'auto',
        animation: item.exiting
          ? 'toast-exit 200ms ease-in forwards'
          : 'toast-enter 200ms ease-out',
        opacity: item.exiting ? 0 : 1,
        transform: item.exiting ? 'translateY(-10px)' : 'translateY(0)',
      }}
    >
      <span style={{ color: config.color, fontWeight: 700 }}>{config.icon}</span>
      <span style={{ flex: 1 }}>{item.message}</span>
      {item.action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            item.action?.onClick();
            onRemove();
          }}
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            border: 'none',
            background: 'transparent',
            color: config.color,
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  );
};