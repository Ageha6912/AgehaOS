import { Component, Fragment, type ReactNode } from 'react'

import { systemBus } from '@/core/events'
import { useTranslation } from '@/core/i18n'

interface AppErrorBoundaryProps {
  appId: string
  windowId: string
  children: ReactNode
}

interface AppErrorBoundaryState {
  crashed: boolean
  attempt: number
}

function CrashScreen({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div className="text-3xl" aria-hidden="true">
        ⚠️
      </div>
      <p className="text-sm font-medium text-text">{t('app.crash.title')}</p>
      <p className="text-sm text-text-muted">{t('app.crash.body')}</p>
      <button
        type="button"
        className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:opacity-90"
        onClick={onReload}
      >
        {t('app.crash.reload')}
      </button>
    </div>
  )
}

/**
 * Crash isolation for app content (PRD §25): a throwing app must never take
 * down the desktop. Emits `app.crashed` and offers a recovery UI that
 * remounts the app.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { crashed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { crashed: true }
  }

  componentDidCatch(): void {
    systemBus.emit('app.crashed', {
      appId: this.props.appId,
      windowId: this.props.windowId,
    })
  }

  render() {
    if (this.state.crashed) {
      return (
        <CrashScreen
          onReload={() => {
            this.setState((state) => ({ crashed: false, attempt: state.attempt + 1 }))
          }}
        />
      )
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
