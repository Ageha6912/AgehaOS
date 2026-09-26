import { useEffect } from 'react'

import { BrandLogo } from '@/components/brand-logo'
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
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden bg-bg">
      {/* 主题感知的品牌氛围：顶部一抹极淡的强调色辉光（双主题安全）。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_srgb,var(--ag-primary)_10%,transparent),transparent)]"
      />
      <div className="relative select-none" aria-hidden="true">
        <BrandLogo size={72} />
      </div>
      <h1 className="relative text-3xl font-semibold tracking-wide text-text">AgehaOS</h1>
      <p className="relative text-sm text-text-muted" role="status">
        {t(`boot.${phase}`)}
      </p>
      <div
        aria-hidden="true"
        className="relative h-0.5 w-24 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="animate-os-fade-in h-full w-1/2 rounded-full bg-primary/70" />
      </div>
    </div>
  )
}
