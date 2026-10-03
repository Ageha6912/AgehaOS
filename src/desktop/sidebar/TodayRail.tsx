import { launchApp } from '@/apps/launch'
import { AppIcon } from '@/apps/app-icon'
import { useTranslation } from '@/core/i18n'
import { useEclosionStore } from '@/store/eclosion-store'

/**
 * 「今日应用」专用列（2026-10-03 用户裁决：左栏往右再加一栏，整列放
 * 「今日」分类的应用）。与 Sidebar 同住 Desktop 的 system-rails 单一玻璃
 * 面板——**两列之间无边框无分隔线**（2026-10-03 三次裁决：连 border-l 分
 * 隔线也清除，整块玻璃完全连续）；本列不在场时面板即纯左栏，外观不变。
 * 世界就绪（羽化开 + world 摘要在 store 且有应用）才渲染——空栏即装饰性
 * 谎言，拒绝（Sidebar 同款铁律）。瓷贴 = AppIcon 按世界行 hue 着色（§6.4
 * 确定性徽章 + 色相旋转，与启动器「今日」分类同一数据源），悬停 os-tooltip
 * 显示「应用名 · tagline」，点击 launchApp 触发按需生成（kind=today）。
 * ⚠️ 本列与组容器都不得挂 overflow（overflow-y 非 visible 会把 overflow-x
 * 也变 auto，向右伸出的 os-tooltip 会被裁掉——2026-10-03 实测教训）；应用
 * 数设计上限 10（§6.2），纵向天然放得下，不做滚动。
 */
export function TodayRail() {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const world = useEclosionStore((s) => s.world)

  if (!enabled || world === null || world.apps.length === 0) return null

  return (
    <nav
      aria-label={t('sidebar.todayRail')}
      data-testid="today-rail"
      className="flex w-[calc(var(--ag-rail-left-width)-0.5rem)] flex-col items-center gap-2 px-2 py-3"
    >
      {world.apps.map((app) => {
        const appId = `com.ageha.eclosion.${app.slug}`
        return (
          <button
            key={app.slug}
            type="button"
            data-testid={`today-rail-app-${app.slug}`}
            aria-label={app.name}
            onClick={() => launchApp(appId)}
            className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text hover:bg-surface-raised"
          >
            <AppIcon appId={appId} size={32} hue={app.hue} label={app.name} />
            {/* 自绘气泡 tooltip（同 SidebarItem 双轨；气泡不进可达树）。 */}
            <span aria-hidden="true" className="os-tooltip">
              {`${app.name} · ${app.tagline}`}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
