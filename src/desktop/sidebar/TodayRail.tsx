import { launchApp } from '@/apps/launch'
import { AppIcon } from '@/apps/app-icon'
import { useTranslation } from '@/core/i18n'
import { useEclosionStore } from '@/store/eclosion-store'

/**
 * 「今日应用」专用列（2026-10-03 用户裁决：左栏往右再加一栏，整列放
 * 「今日」分类的应用）：与系统导航栏（Sidebar）同款玻璃浮岛，固定在其
 * 右侧、同样垂直居中。世界就绪（羽化开 + world 摘要在 store 且有应用）
 * 才渲染——空栏即装饰性谎言，拒绝（Sidebar 同款铁律）。瓷贴 = AppIcon
 * 按世界行 hue 着色（§6.4 确定性徽章 + 色相旋转，与启动器「今日」分类
 * 同一数据源），悬停 os-tooltip 显示「应用名 · tagline」，点击
 * launchApp 触发按需生成（kind=today，§6.4 双击启动器瓦片同路径）。
 * <640px 随左栏一起隐藏（§25）；应用数设计上限 10（§6.2），超高屏
 * 兜底 max-h + no-scrollbar。
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
      className="desktop-chrome surface-glass glass-raise no-scrollbar fixed left-[calc(var(--ag-rail-left-width)+1.5rem)] top-1/2 z-40 hidden max-h-[calc(100vh-6rem)] -translate-y-1/2 flex-col items-center gap-2 overflow-y-auto rounded-xl border border-border px-2 py-3 shadow-float sm:flex"
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
