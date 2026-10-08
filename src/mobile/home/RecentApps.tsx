import { AppIcon } from '@/apps/app-icon'
import { useTranslation } from '@/core/i18n'
import { getAppManifest, useAppStore } from '@/store/app-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useUsageStore } from '@/store/usage-store'

import { resolveRecentApps } from './recent-apps'

/**
 * 移动 Home 的最近使用区（M1-3，零新增状态）：只消费既有 store——
 * - 数据 = usage-store 的 `recent`（最近启动单一来源，设备本地不进云同步）
 *   截前 4 条，经 `getAppManifest` 解析出应用名（解析在 `./recent-apps`
 *   纯函数，切片口径「先截取、后解析」，坏条目跳过不回填）；
 * - 动作 = 整格点击 `mobile-nav-store.openApp(appId)`：与今日世界卡同一
 *   过渡语义（M1-6 AppHost 之前只推进导航状态机，不真实开窗），点击后由
 *   MobileShell 根的 data-nav-view / data-nav-app-id 反射可观测；
 * - 空态 = `recent` 为空或前 4 条全部解析失败时整块（含标题）不渲染
 *   （禁止空壳——无数据不建可点元素，与今日世界卡同铁律）。
 *
 * 视觉（DESIGN.md §35）：最近使用不在玻璃白名单五处内（§35.1），故不做
 * 卡片容器、不引入 blur——标题 + 横向一行四格的轻区块；每格命中区
 * ≥44×44px（§35.3，AppIcon 徽章 44px 即命中区主体）；文案只有标题走
 * i18n 双词典（§35.6），应用名是 manifest 数据（与桌面启动器同源）。
 */
export function RecentApps() {
  const { t } = useTranslation()
  const recent = useUsageStore((state) => state.recent)
  // 注册表版本订阅：apps 数组引用随每次 commit 更新，安装/卸载/运行时
  // 注销即刻重渲染重跑解析；解析本体按切片口径走 getAppManifest（同一
  // 注册表，两路同源）。
  useAppStore((state) => state.apps)
  const openApp = useMobileNavStore((state) => state.openApp)

  const items = resolveRecentApps(recent, getAppManifest)

  // 空态：整块连标题一起缺席（禁止空壳）。
  if (items.length === 0) return null

  return (
    <section
      data-testid="mobile-recent-apps"
      aria-label={t('mobile.home.recents.title')}
      className="mt-7 px-5"
    >
      <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ag-text)' }}>
        {t('mobile.home.recents.title')}
      </h2>
      <ul className="mt-2 flex items-stretch" data-testid="mobile-recent-apps-list">
        {items.map((item) => (
          <li key={item.appId} className="min-w-0 flex-1">
            <button
              type="button"
              data-testid="mobile-recent-app"
              data-app-id={item.appId}
              onClick={() => openApp(item.appId)}
              className="flex min-h-[44px] min-w-[44px] w-full flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 transition-opacity active:opacity-80"
            >
              {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由下方
                  应用名文本承担——与桌面启动器瓦片同口径（AppLauncher
                  LauncherTile：AppIcon 44 + 文本标签）。 */}
              <AppIcon appId={item.appId} size={44} />
              <span className="w-full truncate text-center text-xs" style={{ color: 'var(--ag-text)' }}>
                {item.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
