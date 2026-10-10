import { useRef } from 'react'

import { MagnifyingGlass } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { appDisplayName } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useAppStore } from '@/store/app-store'
import { useMobileLauncherStore } from '@/store/mobile-launcher-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'

import { MobileLauncher } from '../launcher/MobileLauncher'
import { orderAppsForMobileGrid } from '../shared/mobile-app-order'

/**
 * 移动 Home 的应用网格（M1-4，零新增状态）：只消费既有 store 与共享解析——
 * - 数据 = `useAppStore(s => s.apps)` 全量已安装应用（当前规模 = 7 内置 +
 *   羽化 L1 注册，直接全量渲染不分页；启动器归 M2）；排序走
 *   `orderAppsForMobileGrid` 纯函数（./shared/mobile-app-order：常量优先序
 *   在前、未列入按展示名排后）；
 * - 名称 = `appDisplayName`（src/apps/launch.ts）：本地化展示名与桌面启动器
 *   同一来源（内置走 titleKey、羽化走规格表、其余回落 manifest.name），
 *   不做第二套解析；
 * - 动作 = 整格点击 `mobile-nav-store.openApp(appId)`：与最近使用/今日世界
 *   卡同一过渡语义（M1-6 AppHost 之前只推进导航状态机，不真实开窗），点击
 *   后由 MobileShell 根的 data-nav-view / data-nav-app-id 反射可观测；
 * - 空态 = 注册表为空时整块（含标题）不渲染（禁止空壳——内置注册在 boot
 *   之前，实践中不出现，防御位与最近使用同口径）。
 *
 * 视觉（DESIGN.md §35）：应用网格不在玻璃白名单五处内（§35.1），实色轻区块
 * 不引入 blur；4 列 grid，徽章 56px（切片口径 52–64px 带）+ 标签 12px
 * （text-xs），整格命中区 ≥44×44px（§35.3，徽章本身已过线）；文案只有标题
 * 走 i18n 双词典（§35.6），应用名是数据。
 *
 * M2-1 启动器入口：标题行右侧搜索图标按钮（Phosphor MagnifyingGlass，
 * 44×44 命中区 §35.3）打开 Bottom Sheet 应用抽屉（./launcher/MobileLauncher
 * ——全部应用 + 实时搜索）。M3-1 起开合归 mobile-launcher-store：底缘上滑
 * 手势（MobileShell 的 mobile-dock-zone）是第二个入口，与按钮共享同一
 * 开合（桌面 launcher-store 多入口共享面板的同一模式），渲染位仍在网格
 * （抽屉是网格标题行的直接延伸）；按钮路径关闭（backdrop/Esc/选中）回焦
 * 触发器（桌面弹层关闭契约 §0.4 的移动口径）。
 */
export function MobileAppGrid() {
  const { t } = useTranslation()
  const apps = useAppStore((state) => state.apps)
  const openApp = useMobileNavStore((state) => state.openApp)
  const launcherOpen = useMobileLauncherStore((state) => state.open)
  const openLauncher = useMobileLauncherStore((state) => state.openLauncher)
  const closeLauncher = useMobileLauncherStore((state) => state.closeLauncher)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeLauncherAndRefocus = (): void => {
    closeLauncher()
    triggerRef.current?.focus()
  }

  // 每次渲染重排（不 memo）：注册表 commit 换引用即重排；locale 切换经
  // useTranslation 重渲染后重取本地化展示名（memo 按 apps 记忆会漏 locale）。
  const items = orderAppsForMobileGrid(apps, appDisplayName)

  // 空态：整块连标题一起缺席（禁止空壳）——启动器入口随网格同退。
  if (items.length === 0) return null

  return (
    <>
      <section
        data-testid="mobile-app-grid"
        aria-label={t('mobile.home.apps.title')}
        className="mt-7 px-5 pb-2"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ag-text)' }}>
            {t('mobile.home.apps.title')}
          </h2>
          {/* M2-1 启动器入口：搜索图标按钮，命中区 44×44（§35.3），可访问名
              走 i18n；字形是装饰位（aria-hidden）。M3-1 起动作写 store（与
              上滑手势同一出口）。 */}
          <button
            type="button"
            ref={triggerRef}
            data-testid="mobile-launcher-open"
            aria-label={t('mobile.launcher.open')}
            aria-expanded={launcherOpen}
            onClick={openLauncher}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity active:opacity-80"
          >
            <MagnifyingGlass
              size={20}
              weight="bold"
              aria-hidden="true"
              style={{ color: 'var(--ag-text)' }}
            />
          </button>
        </header>
        <ul className="mt-2 grid grid-cols-4" data-testid="mobile-app-grid-list">
          {items.map((app) => (
            <li key={app.id} className="min-w-0">
              <button
                type="button"
                data-testid="mobile-app-tile"
                data-app-id={app.id}
                onClick={() => openApp(app.id)}
                className="flex min-h-[44px] min-w-[44px] w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-opacity active:opacity-80"
              >
                {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由下方
                    应用名文本承担——与最近使用区/桌面启动器瓦片同口径。 */}
                <AppIcon appId={app.id} size={56} />
                <span
                  className="w-full truncate text-center text-xs"
                  style={{ color: 'var(--ag-text)' }}
                >
                  {appDisplayName(app.id)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {/* M2-1 应用抽屉：开合归 mobile-launcher-store（M3-1 起与上滑手势
          共享），按钮路径关闭回焦入口按钮。 */}
      <MobileLauncher open={launcherOpen} onClose={closeLauncherAndRefocus} />
    </>
  )
}
