import { useTranslation } from '@/core/i18n'

export interface AppHostProps {
  windowId: string
}

/**
 * Temporary body for system apps before Milestone 4 delivers the real ones.
 */
export function PlaceholderApp({ windowId }: AppHostProps) {
  const { t } = useTranslation()

  return (
    <div
      data-window-id={windowId}
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="text-sm text-text-muted">{t('app.placeholder.body')}</p>
    </div>
  )
}

export function MissingApp({ windowId }: AppHostProps) {
  const { t } = useTranslation()

  return (
    <div data-window-id={windowId} className="flex h-full items-center justify-center p-6">
      <p className="text-sm text-text-muted">{t('app.missing.body')}</p>
    </div>
  )
}
