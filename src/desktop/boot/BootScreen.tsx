import { useEffect } from 'react'

import { useTranslation } from '@/core/i18n'
import { useBootStore } from '@/store/boot-store'

const BOOT_STEP_MS = 800

export function BootScreen() {
  const phase = useBootStore((state) => state.phase)
  const advance = useBootStore((state) => state.advance)
  const { t } = useTranslation()

  useEffect(() => {
    if (phase === 'ready') return
    const timer = window.setTimeout(advance, BOOT_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [phase, advance])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-6xl select-none" aria-hidden="true">
        🦋
      </div>
      <h1 className="text-3xl font-semibold tracking-wide text-text">AgehaOS</h1>
      <p className="text-sm text-text-muted" role="status">
        {t(`boot.${phase}`)}
      </p>
    </div>
  )
}
