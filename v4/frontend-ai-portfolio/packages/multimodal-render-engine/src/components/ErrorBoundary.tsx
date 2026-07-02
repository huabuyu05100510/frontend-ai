/**
 * 错误边界组件
 *
 * 捕获子组件渲染错误，显示降级 UI。
 * 支持 onError 注入上报、onRetry 重试。
 * 连续 3 次同类型错误触发持久错误状态。
 *
 * @module components/ErrorBoundary
 */

import React from 'react';

interface ErrorBoundaryProps {
  /** 自定义降级 UI */
  fallback?: React.ReactNode;
  /** 错误上报回调 */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** 重试回调（不传则显示默认的刷新页面按钮） */
  onRetry?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** 连续错误计数（同类型错误 10s 内） */
  consecutiveErrors: number;
  lastErrorTime: number;
  /** 是否持久错误（连续 3 次同类型） */
  isPersistent: boolean;
}

/** 默认 fallback UI */
function DefaultFallback({
  error,
  isPersistent,
  onRetry,
}: {
  error: Error | null;
  isPersistent: boolean;
  onRetry: (() => void) | undefined;
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      color: '#666',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚠️</div>
      <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
        {isPersistent ? '反复出现错误' : '渲染异常'}
      </div>
      <div style={{ fontSize: '14px', color: '#999', marginBottom: '20px', maxWidth: '400px', textAlign: 'center' }}>
        {isPersistent
          ? '该模块反复出现错误，请刷新页面后重试。'
          : error?.message || '抱歉，该模块加载失败。'
        }
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        {isPersistent ? (
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 24px',
              borderRadius: '6px',
              border: '1px solid #d9d9d9',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            刷新页面
          </button>
        ) : (
          <>
            {onRetry && (
              <button
                onClick={onRetry}
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
                重试
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 24px',
                borderRadius: '6px',
                border: '1px solid #d9d9d9',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              刷新页面
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 错误边界组件
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   onError={(error, info) => sentry.captureException(error)}
 *   onRetry={() => retryLoad()}
 * >
 *   <MyScene />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      consecutiveErrors: 0,
      lastErrorTime: 0,
      isPersistent: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);

    const now = Date.now();
    const isSameType = this.state.error?.constructor === error.constructor;
    const isWithinWindow = now - this.state.lastErrorTime < 10_000;

    const consecutive = (isSameType && isWithinWindow)
      ? this.state.consecutiveErrors + 1
      : 1;

    this.setState({
      consecutiveErrors: consecutive,
      lastErrorTime: now,
      isPersistent: consecutive >= 3,
    });
  }

  componentWillUnmount(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
  }

  /** 重置错误状态（外部可调用） */
  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      consecutiveErrors: 0,
      lastErrorTime: 0,
      isPersistent: false,
    });
  };

  handleRetry = (): void => {
    this.reset();
    // 延迟 10s 后重置连续错误计数
    this.resetTimer = setTimeout(() => {
      this.setState({ consecutiveErrors: 0 });
    }, 10_000);
    this.props.onRetry?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <DefaultFallback
          error={this.state.error}
          isPersistent={this.state.isPersistent}
          onRetry={this.props.onRetry ? this.handleRetry : undefined}
        />
      );
    }

    return this.props.children;
  }
}