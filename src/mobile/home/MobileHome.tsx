import { useTranslation } from '@/core/i18n'
import { useSessionStore } from '@/store/session-store'

import { BrandLogo } from '@/components/brand-logo'

import { greetingJoinKey, greetingPhaseKey, mobileGreetingPhase } from './greeting'

/**
 * 移动 Home 视图（M1-1，挂 `mobile-content-scroll`）：品牌头 + 时段问候。
 * 轻量环境感——一行品牌头（BrandLogo + 名称 + 标语）加一句问候，不是
 * Landing 页式的大居中 Hero（M0 中央占位字随本切片退役，`mobile-shell-brand`
 * 标记位随迁，M0 E2E 断言不断）。问候分档是纯函数（./greeting，单测钉
 * 边界），用户名取 session-store 真实会话（displayName 缺省回退 username，
 * 与桌面 UserMenu 同口径）；文案全部走 i18n 双词典（DESIGN.md §35.6）。
 *
 * 本切片 Home 只有品牌头与问候，无可点目标（应用网格归 M1-5）；今日卡/
 * 最近/网格等后续切片继续在本容器顶部向下追加（滚动容器 min-h-full 已备）。
 */
export function MobileHome({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation()
  const user = useSessionStore((state) => state.user)
  const displayName = user ? (user.displayName ?? user.username) : null
  const phase = mobileGreetingPhase(now.getHours())

  return (
    <section data-testid="mobile-home" aria-label={t('mobile.shell.heading')}>
      <h1 className="sr-only">{t('mobile.shell.heading')}</h1>
      <header
        data-testid="mobile-home-header"
        className="flex items-center gap-3 px-5 pt-8"
      >
        <BrandLogo size={44} label={t('mobile.shell.brand')} className="shrink-0" />
        <div className="min-w-0">
          <p
            data-testid="mobile-shell-brand"
            className="truncate text-xl font-semibold tracking-tight"
            style={{ color: 'var(--ag-text)' }}
          >
            {t('mobile.shell.brand')}
          </p>
          <p
            data-testid="mobile-home-tagline"
            className="mt-0.5 truncate text-xs"
            style={{ color: 'var(--ag-text-muted)' }}
          >
            {t('mobile.home.tagline')}
          </p>
        </div>
      </header>
      <p
        data-testid="mobile-home-greeting"
        className="px-5 pt-7 text-[15px]"
        style={{ color: 'var(--ag-text)' }}
      >
        {t(greetingPhaseKey(phase))}
        {displayName !== null && (
          <span style={{ color: 'var(--ag-text-muted)' }}>
            {t(greetingJoinKey())}
            {displayName}
          </span>
        )}
      </p>
    </section>
  )
}
