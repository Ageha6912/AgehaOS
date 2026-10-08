import { ArrowRight, Sparkle } from '@phosphor-icons/react'

import { formatMessage, useTranslation } from '@/core/i18n'
import { useEclosionStore } from '@/store/eclosion-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'

/**
 * 「查看世界」的过渡落点：动态面板的注册 appId（src/apps/builtin-manifests.ts）
 * ——M1-2 只推进 mobile-nav-store（导航状态推进，不调 launchApp）；M1-6
 * AppHost 接管后由 nav.appId 升级为真实启动（launchApp 同值直达），故这里
 * 刻意存注册表全量 id 而非缩写。
 */
export const MOBILE_TODAY_WORLD_TARGET_APP_ID = 'com.ageha.dynamic.panel'

/**
 * 移动 Home 的今日世界卡（M1-2，只消费不重建引擎）：数据全部来自
 * eclosion-store 的世界摘要（编排器登录后拉取写入，本组件零新取数）——
 * - 统计行用真实字段：新应用数 = world.apps.length、趋势信号数 =
 *   world.signalCount（与桌面「趋势信号来源」同语汇；headline 是单数主题
 *   无计数语义，不编造「M 个趋势主题」）；
 * - 门控：羽化关或世界未落地（拉取中 / 503 静默降级）整卡不渲染——与桌面
 *   「无数据不建死按钮」同铁律，卡片缺席即状态（Home 其余区块照常）；
 * - 「查看世界」按钮 = openApp(MOBILE_TODAY_WORLD_TARGET_APP_ID)：过渡语义
 *   是导航状态推进（M1-6 前不真实开窗），点击后由 MobileShell 根的
 *   data-nav-view 反射可观测（E2E 断言口）。
 *
 * 视觉（DESIGN.md §35）：本卡在玻璃白名单五处的「Today 卡」位（§35.1），
 * M1-2 沿用 M1-1 状态条先例——实色 --ag-surface-raised + 细边，不引入
 * blur（免动 index.css 玻璃源序段）；「查看世界」命中区 ≥44px（§35.3）；
 * 文案全部走 i18n 双词典（§35.6）。
 */
export function TodayWorldCard() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((state) => state.enabled)
  const world = useEclosionStore((state) => state.world)
  const openApp = useMobileNavStore((state) => state.openApp)

  // 羽化关 / 世界未落地：整卡不渲染（禁止空壳——无数据即无「查看世界」）。
  if (!enabled || world === null) return null

  return (
    <section
      data-testid="mobile-today-world"
      aria-label={t('mobile.today.world.title')}
      className="mx-5 mt-7 rounded-2xl border p-4"
      style={{ backgroundColor: 'var(--ag-surface-raised)', borderColor: 'var(--ag-border-subtle)' }}
    >
      <div className="flex items-center gap-2">
        <Sparkle
          size={16}
          weight="fill"
          aria-hidden="true"
          className="shrink-0"
          style={{ color: 'var(--ag-primary)' }}
        />
        <h2
          className="text-sm font-semibold tracking-tight"
          style={{ color: 'var(--ag-text)' }}
        >
          {t('mobile.today.world.title')}
        </h2>
      </div>
      <p
        data-testid="mobile-today-world-stats"
        className="mt-2 text-xs leading-snug"
        style={{ color: 'var(--ag-text-muted)' }}
      >
        {formatMessage(t('mobile.today.world.apps'), { count: String(world.apps.length) })}
        {' · '}
        {formatMessage(t('mobile.today.world.signals'), { count: String(world.signalCount) })}
      </p>
      <button
        type="button"
        data-testid="mobile-today-world-view"
        onClick={() => openApp(MOBILE_TODAY_WORLD_TARGET_APP_ID)}
        className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1 rounded-xl text-sm font-medium transition-colors active:opacity-80"
        style={{ color: 'var(--ag-primary)' }}
      >
        {t('mobile.today.world.view')}
        <ArrowRight size={14} aria-hidden="true" className="shrink-0" />
      </button>
    </section>
  )
}
