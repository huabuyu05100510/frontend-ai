// AppShell — 顶层错误边界 + a11y skip link
// 模型：claude-sonnet-4-6
// 颜色迁移至 semantic.ts (Phase 2.A)
import React from 'react'

interface State { hasError: boolean; error: Error | null }

export class AppShell extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppShell] uncaught error:', error, info)
  }

  reset = () => this.setState({ hasError: false, error: null })

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, fontFamily: 'system-ui', maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontSize: 24, color: 'var(--color-danger)', marginBottom: 16 }}>
            页面出错了
          </h1>
          <pre style={{ background: 'var(--color-bg-canvas)', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error?.stack || this.state.error?.message || 'Unknown error'}
          </pre>
          <button
            onClick={this.reset}
            style={{
              marginTop: 16, padding: '8px 16px', background: 'var(--color-primary)', color: 'var(--color-text-inverse)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return <>{this.props.children}</>
  }
}