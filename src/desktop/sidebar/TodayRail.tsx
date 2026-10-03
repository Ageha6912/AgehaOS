import { launchApp } from '@/apps/launch'
import { AppIcon } from '@/apps/app-icon'
import { useTranslation } from '@/core/i18n'
import { useEclosionStore } from '@/store/eclosion-store'

/**
 * 「今日应用」专用列（2026-10-03 用户裁决：左栏往右再加一栏，整列放
 * 「今日」分类的应用）：与系统导航栏（Sidebar）同款玻璃浮岛，**紧贴其
 * 右侧无缝相连**（左缘 = 左栏右缘，去自身左边框与左侧圆角——左栏右框线
 * 即两栏中缝的分隔线；2026-10-03 追加裁决：两栏间不留空隙、毛玻璃连成
 * 一体）。世界就绪（羽化开 + world 摘要在 store 且有应用）才渲染——空栏
 * 即装饰性谎言，拒绝（Sidebar 同款铁律）。瓷贴 = AppIcon 按世界行 hue
 * 着色（§6.4 确定性徽章 + 色相旋转，与启动器「今日」分类同一数据源），
 * 悬停 os-tooltip 显示「应用名 · tagline」，点击 launchApp 触发按需生成
 * （kind=today，§6.4 双击启动器瓦片同路径）。
 * ⚠️ 本栏不得挂 overflow（overflow-y 非 visible 会把 overflow-x 也变
 * auto，向右伸出的 os-tooltip 会被 own 栏裁掉——2026-10-03 实测教训）；
 * 应用数设计上限 10（§6.2），10×44px + 间距纵向天然放得下，不做滚动。
 * <640px 随左栏一起隐藏（§25）。
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
      className="desktop-chrome surface-glass glass-raise fixed left-[calc(var(--ag-rail-left-width)+0.75rem)] top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-r-xl border-y border-r border-border px-2 py-3 shadow-float sm:flex"
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
