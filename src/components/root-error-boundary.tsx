import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 根级错误边界（C2 审查：每个窗口/移动应用有 AppErrorBoundary，但 shell 层
 * ——Desktop/MenuBar/BootScreen 或 store 选择器——抛错时整屏空白无恢复入口）。
 * 最小恢复面：报告 + 重新加载；不做任何 store 触碰（出错面很可能就是 store）。
 */
interface RootErrorBoundaryProps {
  children: ReactNode
}

interface RootErrorBoundaryState {
  error: Error | null
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AgehaOS] shell crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--ageha-bg, #0f172a)',
            color: 'var(--ageha-text, #e2e8f0)',
            font: '14px/1.6 system-ui, sans-serif',
          }}
        >
          <main style={{ maxWidth: '26rem', textAlign: 'center', padding: '2rem' }}>
            <h1 style={{ fontSize: '1rem', margin: '0 0 .5rem' }}>界面遇到问题</h1>
            <p style={{ margin: '0 0 1rem', opacity: 0.8 }}>Shell 层崩溃；重新加载通常可以恢复。</p>
            <button
              type="button"
              onClick={() => location.reload()}
              style={{
                padding: '.5rem 1.25rem',
                borderRadius: '.5rem',
                border: '1px solid rgba(148,163,184,.4)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              重新加载
            </button>
          </main>
        </div>
      )
    }
    return this.props.children
  }
}
