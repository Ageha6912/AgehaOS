import { useEffect } from 'react'

import { useTranslation } from '@/core/i18n'
import { useBootStore } from '@/store/boot-store'
import { useSessionStore } from '@/store/session-store'

const BOOT_STEP_MS = 800

export function BootScreen() {
  const phase = useBootStore((state) => state.phase)
  const advance = useBootStore((state) => state.advance)
  const finishBoot = useBootStore((state) => state.finishBoot)
  const sessionStatus = useSessionStore((state) => state.status)
  const { t } = useTranslation()

  useEffect(() => {
    if (phase !== 'booting' && phase !== 'loading') return
    const timer = window.setTimeout(() => {
      if (phase === 'booting') {
        advance()
        return
      }
      // Session check decides desktop vs login (PRD §24.1).
      finishBoot(sessionStatus === 'authenticated' ? 'ready' : 'login')
    }, BOOT_STEP_MS)
    return () => window.clearTimeout(timer)
  }, [phase, advance, finishBoot, sessionStatus])

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
