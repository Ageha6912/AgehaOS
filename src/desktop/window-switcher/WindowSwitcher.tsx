import { useEffect, useRef, useSyncExternalStore } from 'react'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { WindowCardFace } from '@/desktop/window-card-face'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import {
  cancelFromLiveHandler,
  windowsChangedFromLiveHandler,
  windowSwitcher,
} from './use-switcher'

/**
 * Window Switcher 面板（Window Management 2.0 W6，审计 .tmp/spaces-audit.md
 * §9；**W12 Windows Alt+Tab 同款语义 §14——用户裁决，覆盖 W11 常驻面板**）：
 * 按住 Alt+W 开面板（Alt 按住期间驻留），W/→ 正向循环、Shift+W/← 反向循环，
 * **松开 Alt=提交选中**（registry onKeyUp 条目承载，见 use-global-shortcuts
 * 「window.switcher.alt-commit」）；Enter/点击条目为保留的补充提交手势；
 * Esc / backdrop 点击 / window blur 取消。
 *
 * - 视觉：`.glass-popover`（既有钉扎档，src/index.css.test.ts）+ 软影
 *   `shadow-popover`；**条目=与 Mission Control 窗口卡同款同尺寸的卡片脸**
 *   （真机反馈第三轮用户裁决「向任务视图的窗口对齐」：共享 WindowCardFace
 *   单一来源——224×152 拟态窗脸 AppIcon+标题+红黄绿控点+占位条，横向排布、
 *   超宽自动换行 flex-wrap justify-center，面板盒自适应）；选中态=主色描边/
 *   光晕（`--ag-capsule-active` 族既有 primary token：border-primary +
 *   ring-primary + shadow-float，MC Space 拖拽落点 ring 同款配额），非选中
 *   卡微降透明度（opacity-80，hover 提回）；❌ 关闭钮是 MC 专属，**不进**
 *   切换器；minimized=窗脸降透明度（共享脸同款语义）+「已最小化」浮层徽章
 *   （绝对定位不占布局，卡尺寸与 MC 卡严格一致）；z-50 档（与搜索面板同
 *   层，popover 互斥保证不并存）。
 * - 互斥 + backdrop 取消（W11 改判、W12 目标 4 沿用）：`usePopoverDismiss`
 *   （dismissible:true + insideRefs=面板）claim `'window-switcher'`；
 *   「outside」=面板外 pointerdown（backdrop 点击——Alt 按住期间点不到
 *   backdrop，松开后语义取消防误切）与「焦点落进应用 iframe」→ cancel 关闭
 *   **不提交**；「superseded」=被其他弹层顶替 → 同样取消不提交（minimized
 *   选中不被还原）。
 * - Esc 取消走 registry 既有条目（use-global-shortcuts「window.switcher.
 *   escape」，注册序在搜索 Esc 之前）；dismiss 钩子自带的 Esc 监听与之幂等
 *   （cancel 对已关面板零作用），分层纪律不变。
 * - window blur 取消（W11 改判、W12 沿用）：切走标签页/OS 抢焦点时直接取消，
 *   不留悬挂面板（面板驻留语义下 blur 无 keyup 可等）。
 * - 点击条目=直接提交（choose）：条目为真 button（hover 反馈 + 原生键盘激
 *   活）；面板盒 pointer-events-auto、外层容器保持 pointer-events-none（面板
 *   外指针穿透桌面，同时 dismiss 钩子的 document pointerdown 判定 backdrop）。
 * - 关窗竞态（任务书 §23）：面板开启期间订阅 live store，窗口关闭经
 *   windowsChanged 派生——选中失效自动顺延、<2 窗自动收面板。
 */
export function WindowSwitcher() {
  const { t } = useTranslation()
  const { open, selectedId, windows } = useSyncExternalStore(
    windowSwitcher.subscribe,
    windowSwitcher.getState,
  )
  const phase = useExitPhase(open)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Roving TabIndex（无障碍）：选中条目 tabIndex 0、其余 -1；箭头键走既有
  // cycle 语义（与 W/Shift+W 同流），DOM 焦点跟随选中——Tab 进面板即落在
  // 当前选中卡。
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  // 弹层互斥 + backdrop 取消（W12 沿用 W11 改判，审计 §14 目标 4）：开面板
  // claim、被顶替（superseded）/面板外按下（outside）/焦点落进 iframe（outside）
  // → cancel 关闭不提交；dismissible:true + insideRefs 让面板内 pointerdown
  // 不误判。
  usePopoverDismiss(
    'window-switcher',
    open,
    (reason) => {
      if (reason === 'outside' || reason === 'superseded') windowSwitcher.cancel()
    },
    { dismissible: true, insideRefs: [panelRef] },
  )

  // window blur 取消（W12 沿用 W11 改判，不得悬挂）：切走标签页/OS 抢焦点 →
  // 取消不提交。
  useEffect(() => {
    if (!open) return
    window.addEventListener('blur', cancelFromLiveHandler)
    return () => window.removeEventListener('blur', cancelFromLiveHandler)
  }, [open])

  // 面板开启期间窗口被关闭 → windowsChanged 从 live store 派生（选中顺延）。
  useEffect(() => {
    if (!open) return
    return useWindowStore.subscribe(windowsChangedFromLiveHandler)
  }, [open])

  if (!phase.render || windows.length === 0) return null

  return (
    // 外层容器保持 pointer-events-none（W6 语义）：面板外的指针穿透桌面；
    // 面板盒自身 pointer-events-auto——条目可点击选择（W11），面板外按下由
    // dismiss 钩子判为 backdrop 取消。
    <div
      data-testid="window-switcher-layer"
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('window.switcher.title')}
        data-testid="window-switcher"
        data-window-switcher-panel=""
        className={`surface-glass glass-popover pointer-events-auto max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border shadow-popover ${popoverMotionClass(phase.exiting)}`}
      >
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <span className="text-xs font-medium text-text-muted">{t('window.switcher.title')}</span>
        </header>
        {/* 条目=MC 任务视图同款卡片脸（真机反馈第三轮）：li 定宽 w-56(224px)
            与 WindowCard 定位容器同档，按钮=卡片脸本体（p-3 + gap-2 + h-24
            窗脸 → 224×152 与 MC 卡严格同尺寸）；flex-wrap + justify-center：
            窗多超宽自动换行且行内居中，面板盒随内容自适应（max-w 兜底不溢
            出视口）。选中=主色描边/光晕（--ag-capsule-active 族既有 primary
            token），非选中微降透明度；❌ 关闭钮不进切换器（MC 专属）。 */}
        <ul
          className="flex w-full flex-wrap items-stretch justify-center gap-3 overflow-hidden px-3 py-3"
          onKeyDown={(event) => {
            const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
            const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            if (!forward && !backward) return
            event.preventDefault()
            windowSwitcher.cycleFromLive(forward ? 1 : -1)
            const nextId = windowSwitcher.getState().selectedId
            if (nextId !== null) itemButtonRefs.current.get(nextId)?.focus()
          }}
        >
          {windows.map((win) => {
            const selected = win.id === selectedId
            return (
              <li
                key={win.id}
                data-testid="window-switcher-item"
                data-window-id={win.id}
                data-selected={selected || undefined}
                aria-current={selected ? 'true' : undefined}
                className="relative w-56 shrink-0"
              >
                {/* 点击条目=直接提交该窗（W12 §14 目标 5 保留手势）；choose
                    内部与 Enter/Alt keyup 共享同一提交流（关窗竞态顺延 +
                    minimized 组合）。 */}
                <button
                  type="button"
                  ref={(el) => {
                    if (el) itemButtonRefs.current.set(win.id, el)
                    else itemButtonRefs.current.delete(win.id)
                  }}
                  tabIndex={selected ? 0 : -1}
                  data-minimized={win.state === 'minimized' || undefined}
                  onClick={() => windowSwitcher.chooseFromLive(win.id)}
                  className={`surface-glass flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-left transition-shadow select-none ${
                    selected
                      ? 'border-primary opacity-100 shadow-float ring-2 ring-primary'
                      : 'border-border-subtle opacity-80 shadow-soft hover:opacity-100 hover:shadow-float'
                  }`}
                >
                  <WindowCardFace
                    appId={win.appId}
                    title={win.title}
                    minimized={win.state === 'minimized'}
                  />
                </button>
                {/* minimized 徽章（绝对定位浮层，不占布局——卡尺寸不因徽章
                    偏离 MC 卡的 224×152）；pointer-events-none 让点击穿透到
                    卡片按钮，交互语义与 MC 卡一致。 */}
                {win.state === 'minimized' && (
                  <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border-subtle bg-surface-soft px-1.5 py-0.5 text-[10px] leading-none text-text-muted shadow-soft">
                    {t('window.switcher.minimized')}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <footer
          data-testid="window-switcher-footer"
          className="flex items-center gap-4 border-t border-border-subtle px-4 py-2 text-[11px] text-text-muted"
        >
          {/* W12 §14 目标 6：提示改「松开 Alt 提交 · W 循环 · Shift+W 反向 ·
              Esc 取消」（zh/en 双词典同步）；Enter/点击条目的提交手势保留，
              但主路径已是松开 Alt，不再占提示位。 */}
          <span className="flex items-center gap-1">
            <SwitcherKbd>alt</SwitcherKbd>
            {t('window.switcher.hint.release')}
          </span>
          <span className="flex items-center gap-1">
            <SwitcherKbd>w</SwitcherKbd>
            {t('window.switcher.hint.cycle')}
          </span>
          <span className="flex items-center gap-1">
            <SwitcherKbd>shift+w</SwitcherKbd>
            {t('window.switcher.hint.backward')}
          </span>
          <span className="flex items-center gap-1">
            <SwitcherKbd>esc</SwitcherKbd>
            {t('window.switcher.hint.cancel')}
          </span>
        </footer>
      </div>
    </div>
  )
}

/** 按键芯片（SearchPalette 底部提示条同款；纯装饰，10px 徽章豁免档）。 */
function SwitcherKbd({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border-subtle bg-surface-soft px-1 text-[11px] font-medium leading-none text-text-muted"
    >
      {children}
    </kbd>
  )
}
