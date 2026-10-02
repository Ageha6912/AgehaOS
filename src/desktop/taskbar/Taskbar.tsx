import { useRef, useState } from 'react'

import { Trash } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { requestFilesTrash } from '@/apps/app-deep-link'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { WindowPreview } from './WindowPreview'
import { useDockWave } from './use-dock-wave'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

const HOVER_DELAY_MS = 350

/** 常驻瓷贴（§32 参考图 Dock 位；全部真实应用）。 */
const PINNED_APP_IDS = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.calculator',
  'com.ageha.terminal',
  'com.ageha.store',
  'com.ageha.settings',
] as const

/**
 * 常驻 Dock（docs/DESIGN.md §9/§20 + §32 修订 8，2026-10-01 用户裁决）：
 * **常驻显示**——自动隐藏机制随本裁决移除（此前默认藏于底缘、指针触底
 * 唤出、离开 400ms 收起的行为全部退役），Dock 恒为可见状态。内容 = 启动器
 * + 常驻瓷贴（files/notes/calculator/terminal/store/settings，单实例激活
 * 语义）+ 运行中窗口（波浪/悬停预览契约不变 §13/§12）+ 回收站（Files 深链）。
 */
export function Taskbar() {
  const { t } = useTranslation()
  const windows = useWindowStore((s) => s.windows)
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const restore = useWindowStore((s) => s.restore)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [anchorLeft, setAnchorLeft] = useState(0)
  const hoverTimer = useRef<number | null>(null)
  // 任务栏波浪（DESIGN.md §13）：高斯距离衰减放大，只写 data-wave-icon 的
  // transform，不碰按钮与 reveal/hide 的 pointerenter/leave 链。范围 = 瓷贴
  // + 运行中整段图标带（2026-10-01 用户报告「波浪没有了」——瓷贴此前不在
  // 波浪域，§32 后 Dock 主体恰是瓷贴）。
  const waveRowRef = useRef<HTMLDivElement | null>(null)
  useDockWave(waveRowRef)
  const dockSheen = useMotionPrefsStore((s) => s.dockSheen)

  const toggleWindow = (id: string, focused: boolean, minimized: boolean) => {
    if (minimized) restore(id)
    else if (focused) minimize(id)
    else focus(id)
  }

  /** 常驻瓷贴可达名：有窗口用窗口标题，无窗口用本地化应用名。 */
  const pinnedLabel = (appId: string): string => {
    const appWindows = windows.filter((win) => win.appId === appId)
    const latest = appWindows[appWindows.length - 1]
    if (latest) return latest.title
    const meta = componentFor(appId)
    return meta ? t(meta.titleKey) : appId
  }

  /** 常驻瓷贴激活语义：无窗口启动；有窗口恢复/聚焦/再点最小化。 */
  const activatePinned = (appId: string): void => {
    const appWindows = windows.filter((win) => win.appId === appId)
    if (appWindows.length === 0) {
      launchApp(appId)
      return
    }
    const target = appWindows[appWindows.length - 1]
    toggleWindow(target.id, target.focused, target.state === 'minimized')
  }

  const startHover = (id: string): void => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHoveredId(id), HOVER_DELAY_MS)
  }
  const endHover = (): void => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHoveredId(null)
  }

  return (
    <>
      <footer
        data-state="revealed"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex h-[calc(var(--ag-dock-height)+0.75rem)] items-end justify-center px-3 pb-3"
        /* 内联 transform 恒存在：footer 是启动器弹层（fixed）的包含块
           （坑 13），移除会让包含块落到被钳制居中的胶囊上，窄视口溢出。 */
        style={{ transform: 'translateY(0)' }}
      >
        {/* 悬浮胶囊 Dock（§20/§32）：启动器 + 常驻瓷贴 + 运行中 + 回收站。
            自动隐藏/波浪/预览/锚点行为契约全部不变（§9/§13/§12）。 */}
        <div className="desktop-chrome surface-glass pointer-events-auto relative flex h-16 max-w-[calc(100%-1.5rem)] items-center gap-1 self-end rounded-full border border-border px-2 shadow-popover">
          {/* Dock 高光滑过（§32.5 修订 10）：低频釉面扫光，覆盖层内裁剪，
              不裁波浪放大的图标；盖在图标上做「玻璃反光」（pointer-events-none）。 */}
          {dockSheen && <div aria-hidden="true" data-testid="dock-sheen" className="dock-sheen is-on" />}
          <AppLauncher />
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />

          {/* 波浪域：瓷贴 + 运行中共享一个引擎容器（§13）。 */}
          <div ref={waveRowRef} className="flex min-w-0 flex-1 items-center self-stretch">
          {/* 常驻瓷贴（§32 参考图 Dock 位；单实例激活语义 + 悬停预览同契约）。
              按钮不画 hover/active 底色（2026-10-01 用户裁决：44px 图标坐在
              48px 按钮里，浅底在玻璃胶囊上显成图标四周的白边）——悬停反馈
              走悬停预览与波浪，激活态只剩指示点。 */}
          <div className="flex shrink-0 items-center gap-1 self-stretch">
            {PINNED_APP_IDS.map((appId) => {
              const appWindows = windows.filter((win) => win.appId === appId)
              const latest = appWindows[appWindows.length - 1]
              const active = latest?.focused && latest.state !== 'minimized'
              return (
                <div
                  key={appId}
                  className="relative"
                  onMouseEnter={
                    latest
                      ? (event) => {
                          setAnchorLeft(event.currentTarget.getBoundingClientRect().left)
                          startHover(latest.id)
                        }
                      : undefined
                  }
                  onMouseLeave={endHover}
                >
                  <button
                    type="button"
                    data-testid={`dock-pin-${appId}`}
                    aria-label={pinnedLabel(appId)}
                    title={pinnedLabel(appId)}
                    className="relative flex h-12 w-12 items-center justify-center rounded-xl"
                    onClick={() => activatePinned(appId)}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={appId} size={44} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>

                  {latest && hoveredId === latest.id && (
                    <WindowPreview
                      win={latest}
                      anchorLeft={anchorLeft}
                      onSwitch={() =>
                        toggleWindow(latest.id, latest.focused, latest.state === 'minimized')
                      }
                      onClose={() => {
                        useWindowStore.getState().close(latest.id)
                        endHover()
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* 运行中窗口（非常驻瓷贴的应用）：波浪/预览契约区。no-scrollbar：
              波浪 1.5× 变换边界会撑出滚动区域，滚动条不得随悬停闪现（修订 11），
              多窗口仍可滚轮横滚。 */}
          {windows.some(
            (win) => !PINNED_APP_IDS.includes(win.appId as (typeof PINNED_APP_IDS)[number]),
          ) && <div aria-hidden="true" className="mx-0.5 h-8 w-px shrink-0 bg-border" />}
          <div
            data-testid="dock-running-row"
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-x-auto"
          >
            {windows.map((win) => {
              if (PINNED_APP_IDS.includes(win.appId as (typeof PINNED_APP_IDS)[number])) return null
              const active = win.focused && win.state !== 'minimized'
              return (
                <div
                  key={win.id}
                  className="relative"
                  onMouseEnter={(event) => {
                    setAnchorLeft(event.currentTarget.getBoundingClientRect().left)
                    startHover(win.id)
                  }}
                  onMouseLeave={endHover}
                >
                  <button
                    type="button"
                    aria-label={win.title}
                    data-testid={`taskbar-item-${win.id}`}
                    className={`relative flex h-12 w-12 items-center justify-center rounded-xl text-sm ${
                      active
                        ? 'text-text'
                        : win.state === 'minimized'
                          ? 'text-text-muted/70 hover:text-text'
                          : 'text-text-muted hover:text-text'
                    }`}
                    onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={win.appId} size={44} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>

                  {hoveredId === win.id && (
                    <WindowPreview
                      win={win}
                      anchorLeft={anchorLeft}
                      onSwitch={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                      onClose={() => {
                        useWindowStore.getState().close(win.id)
                        endHover()
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          </div>

          {/* 回收站（§32 参考图 Dock 末位）：Files 回收站视图深链。 */}
          <div aria-hidden="true" className="mx-0.5 h-8 w-px shrink-0 bg-border" />
          <button
            type="button"
            data-testid="dock-trash"
            aria-label={t('dock.trash')}
            title={t('dock.trashHint')}
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            onClick={() => {
              requestFilesTrash()
              launchApp('com.ageha.files')
            }}
          >
            {/* 半透明白瓷贴（参考图回收站位）。 */}
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-[24%] bg-gradient-to-br from-[#f2f6ff]/85 to-[#c7d6f5]/85 shadow-[0_1px_2px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/50"
            >
              <Trash size={20} weight="fill" color="#5a6b82" />
            </span>
          </button>
        </div>
      </footer>
    </>
  )
}
