import { useEffect, useRef, useState } from 'react'

import { Trash } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { requestFilesTrash } from '@/apps/app-deep-link'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import { AppLauncher } from './AppLauncher'
import { WindowPreview } from './WindowPreview'
import { PINNED_APP_IDS } from './pinned-apps'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

const HOVER_DELAY_MS = 350

/** 波浪参数（2026-10-05 用户裁决恢复 §13 前的邻位联动）：σ 对齐图标节距
    56px，邻位最大轻浮 8px / scale 1.08——悬停枚的强浮起（-3px / 1.18 +
    光晕）仍由 index.css 的 :hover 规则承担，引擎跳过最近一枚避免叠加。 */
export const DOCK_WAVE_SIGMA_PX = 56
export const DOCK_WAVE_MAX_LIFT_PX = 8
export const DOCK_WAVE_MAX_SCALE = 1.08

/** 高斯邻位波浪：|距离| → inline transform（超出 2σ 返回 null = 回落基态，
    不写样式）。纯函数，jsdom 可测。 */
export function dockWaveTransform(distancePx: number): string | null {
  const t = Math.exp(-(distancePx * distancePx) / (DOCK_WAVE_SIGMA_PX * DOCK_WAVE_SIGMA_PX))
  if (t < 0.02) return null
  const scale = 1 + (DOCK_WAVE_MAX_SCALE - 1) * t
  return `translateY(${(-DOCK_WAVE_MAX_LIFT_PX * t).toFixed(2)}px) scale(${scale.toFixed(4)})`
}

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
  // 悬停强浮起（2026-10-02 用户裁决：被悬浮那枚 -3px/1.18 + 光晕）仍走
  // index.css 的 button:hover > [data-wave-icon] 规则。邻位波浪（2026-10-05
  // 用户裁决恢复 §13 前联动）：高斯衰减轻浮，rAF 节流 + 直写 inline
  // transform——零 React 渲染；引擎跳过距指针最近的一枚（那是 :hover 的
  // 强浮起位，避免 inline 覆盖 CSS）；reduced-motion 不启用；离开 Dock 全清。
  const dockRef = useRef<HTMLDivElement | null>(null)
  const waveFrame = useRef<number | null>(null)
  const waveX = useRef(0)

  const applyWave = (): void => {
    waveFrame.current = null
    const dock = dockRef.current
    if (!dock) return
    const spans = dock.querySelectorAll<HTMLElement>('[data-wave-icon]')
    let nearest: HTMLElement | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    const entries: Array<{ el: HTMLElement; distance: number }> = []
    spans.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const distance = Math.abs(waveX.current - (rect.left + rect.width / 2))
      entries.push({ el, distance })
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = el
      }
    })
    for (const { el, distance } of entries) {
      // 最近一枚交给 CSS :hover（指针在间隙时它只是不动，视觉可接受）。
      el.style.transform = el === nearest ? '' : dockWaveTransform(distance) ?? ''
    }
  }

  const onDockPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    waveX.current = event.clientX
    if (waveFrame.current !== null) return
    waveFrame.current = window.requestAnimationFrame(applyWave)
  }

  const clearWave = (): void => {
    if (waveFrame.current !== null) {
      window.cancelAnimationFrame(waveFrame.current)
      waveFrame.current = null
    }
    dockRef.current?.querySelectorAll<HTMLElement>('[data-wave-icon]').forEach((el) => {
      el.style.transform = ''
    })
  }

  useEffect(() => clearWave, [])
  const dockSheen = useMotionPrefsStore((s) => s.dockSheen)

  const toggleWindow = (id: string, focused: boolean, minimized: boolean) => {
    if (minimized) restore(id)
    else if (focused) minimize(id)
    else focus(id)
  }

  /** 常驻瓷贴可达名：有窗口用窗口标题，无窗口用本地化应用名。 */
  // 可读名称恒为应用名（读屏不随窗口标题漂移）；运行中窗口标题经 title
  // 进入可访问描述。
  const pinnedLabel = (appId: string): string => {
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
    // 换目标悬停：取消上一目标的宽限收卡（A→B 过渡仍即时收 A 卡）。
    cancelEndHover()
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHoveredId(id), HOVER_DELAY_MS)
  }
  const endHover = (): void => {
    cancelEndHover()
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHoveredId(null)
  }
  // 悬停桥（2026-10-02 用户裁决：指针可移入预览）：预览经 createPortal 挂
  // 在 body（坑 13），DOM 上不在瓷贴 wrapper 内——wrapper 的 mouseleave 若
  // 立即 endHover，指针一离开图标预览就消失。改为宽限 240ms：期间进入预览
  // （cancelEndHover）则保持驻留，离开预览再宽限后收卡。
  const endHoverTimer = useRef<number | null>(null)
  const cancelEndHover = (): void => {
    if (endHoverTimer.current !== null) {
      window.clearTimeout(endHoverTimer.current)
      endHoverTimer.current = null
    }
  }
  const scheduleEndHover = (): void => {
    if (endHoverTimer.current !== null) window.clearTimeout(endHoverTimer.current)
    endHoverTimer.current = window.setTimeout(() => {
      endHoverTimer.current = null
      setHoveredId(null)
    }, 240)
  }
  useEffect(
    () => () => {
      if (endHoverTimer.current !== null) window.clearTimeout(endHoverTimer.current)
    },
    [],
  )

  return (
    <>
      <footer
        data-state="revealed"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex h-[calc(var(--ag-dock-height)+var(--ag-dock-gap))] items-end justify-center px-3 pb-[var(--ag-dock-gap)]"
        /* 内联 transform 恒存在：footer 是启动器弹层（fixed）的包含块
           （坑 13），移除会让包含块落到被钳制居中的胶囊上，窄视口溢出。 */
        style={{ transform: 'translateY(0)' }}
      >
        {/* 悬浮 Dock（§20/§32；材质表④ 白22% 胶囊底 + 28px 默认
            surface-glass blur + 强细边 + shadow-dock 专用档；Shell 3.0 STEP 6
            视觉精修：全 pill 退役改 24px 圆角矩形玻璃舱——§33.2 档）：
            启动器 + 常驻瓷贴 + 运行中 + 回收站。自动隐藏/波浪/预览/锚点行为
            契约全部不变（§9/§13/§12）。 */}
        <nav
          ref={dockRef}
          aria-label={t('dock.label')}
          onPointerMove={onDockPointerMove}
          onPointerLeave={clearWave}
          className="desktop-chrome dock-glass surface-glass pointer-events-auto relative flex h-[var(--ag-dock-height)] max-w-[calc(100%-1.5rem)] items-center gap-1 self-end rounded-[var(--ag-dock-radius)] border border-border-strong px-2 shadow-dock"
        >
          {/* Dock 高光滑过（§32.5 修订 10）：低频釉面扫光，覆盖层内裁剪，
              不裁波浪放大的图标；盖在图标上做「玻璃反光」（pointer-events-none）。 */}
          {dockSheen && <div aria-hidden="true" data-testid="dock-sheen" className="dock-sheen is-on" />}
          <AppLauncher />
          <div aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />

          {/* Dock 图标带：瓷贴 + 运行中（悬停浮起的 CSS 作用域，§13）。 */}
          <div className="flex min-w-0 flex-1 items-center self-stretch">
          {/* 常驻瓷贴（§32 参考图 Dock 位；单实例激活语义 + 悬停预览同契约）。
              按钮不画 hover/active 底色（2026-10-01 用户裁决：44px 图标坐在
              48px 按钮里，浅底在玻璃胶囊上显成图标四周的白边）——悬停反馈
              走悬停预览与浮起，激活态只剩指示点。 */}
          <div className="flex shrink-0 items-center gap-2 self-stretch">
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
                  onMouseLeave={scheduleEndHover}
                >
                  <button
                    type="button"
                    data-testid={`dock-pin-${appId}`}
                    aria-label={pinnedLabel(appId)}
                    className="dock-tile group relative flex h-12 w-12 items-center justify-center rounded-xl"
                    onClick={() => activatePinned(appId)}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={appId} size={48} />
                    </span>
                    {active && (
                      // Active 指示条（Shell 3.0 STEP 6）：底部 2px×16px 细条
                      // （原 4px 点）——primary 配额 = Active/Selected 语义。
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                    {/* 名称气泡（2026-10-02 裁决：dock 气泡与左栏同款玻璃芯片，
                        位于图标上方；原生 title 太简陋）。有运行中窗口的瓷贴
                        让位给悬停预览（预览头部已含应用名，避免双层重叠）。 */}
                    {appWindows.length === 0 && (
                      <span aria-hidden="true" className="os-tooltip os-tooltip--dock">
                        {pinnedLabel(appId)}
                      </span>
                    )}
                  </button>

                  {latest && hoveredId === latest.id && (
                    <WindowPreview
                      win={latest}
                      anchorLeft={anchorLeft}
                      onMouseEnter={cancelEndHover}
                      onMouseLeave={scheduleEndHover}
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

          {/* 运行中窗口（非常驻瓷贴的应用）：预览/悬停浮起契约区。no-scrollbar：
              悬停浮起的 scale 变换边界会撑出滚动区域，滚动条不得随悬停闪现
              （修订 11），多窗口仍可滚轮横滚。 */}
          {windows.some(
            (win) => !PINNED_APP_IDS.includes(win.appId as (typeof PINNED_APP_IDS)[number]),
          ) && <div aria-hidden="true" className="mx-0.5 h-8 w-px shrink-0 bg-border" />}
          <div
            data-testid="dock-running-row"
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 self-stretch overflow-x-auto"
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
                  onMouseLeave={scheduleEndHover}
                >
                  <button
                    type="button"
                    aria-label={win.title}
                    data-testid={`taskbar-item-${win.id}`}
                    className={`dock-tile relative flex h-12 w-12 items-center justify-center rounded-xl text-sm ${
                      active
                        ? 'text-text'
                        : win.state === 'minimized'
                          ? 'text-text-muted/70 hover:text-text'
                          : 'text-text-muted hover:text-text'
                    }`}
                    onClick={() => toggleWindow(win.id, win.focused, win.state === 'minimized')}
                  >
                    <span aria-hidden="true" data-wave-icon className="flex">
                      <AppIcon appId={win.appId} size={48} />
                    </span>
                    {active && (
                      // Active 指示条（Shell 3.0 STEP 6）：底部 2px×16px 细条。
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>

                  {hoveredId === win.id && (
                    <WindowPreview
                      win={win}
                      anchorLeft={anchorLeft}
                      onMouseEnter={cancelEndHover}
                      onMouseLeave={scheduleEndHover}
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
            className="dock-tile group relative flex h-12 w-12 items-center justify-center rounded-xl"
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
            <span aria-hidden="true" className="os-tooltip os-tooltip--dock">
              {t('dock.trashHint')}
            </span>
          </button>
        </nav>
      </footer>
    </>
  )
}
