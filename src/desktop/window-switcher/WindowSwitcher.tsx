import { useEffect, useSyncExternalStore } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import { commitFromLiveHandler, windowsChangedFromLiveHandler, windowSwitcher } from './use-switcher'

/**
 * Window Switcher 面板（Window Management 2.0 W6，审计 .tmp/spaces-audit.md
 * §9）：Alt+W 按住呼出、松开提交、Esc 取消——纯键盘驱动的窗口切换器。
 *
 * - 视觉：`.glass-popover`（既有钉扎档，src/index.css.test.ts）+ 软影
 *   `shadow-popover` + AppIcon（与 Taskbar/搜索同源）+ 标题；选中态
 *   `--ag-capsule-active` 族（Sidebar 同款「primary 配额=Active/Selected」）；
 *   z-50 档（与搜索面板同层，popover 互斥保证不并存）。
 * - 互斥：开面板经 `usePopoverDismiss`（dismissible:false 只参与互斥）claim
 *   `'window-switcher'`；被其他弹层顶替（active 变他值）→ cancel 关闭**不提交**。
 * - keyup 丢失兜底（审计 §9 风险条）：面板开启期间 window blur → 按「提交
 *   当前选中」处理，不得悬挂。
 * - 关窗竞态（任务书 §23）：面板开启期间订阅 live store，窗口关闭经
 *   windowsChanged 派生——选中失效自动顺延、<2 窗自动收面板。
 * - 键盘驱动 MVP（审计 §9 明确不做）：鼠标点击面板项选择不做；面板容器
 *   pointer-events-none（指针穿透，交互全部在键盘模型内）。
 */
export function WindowSwitcher() {
  const { t } = useTranslation()
  const { open, selectedId, windows } = useSyncExternalStore(
    windowSwitcher.subscribe,
    windowSwitcher.getState,
  )
  const phase = useExitPhase(open)

  // 弹层互斥（审计 §9）：开面板 claim、被顶替 release 并关闭不提交；
  // dismissible:false——Esc/外部点击关闭由快捷键状态机自理（search 同款）。
  usePopoverDismiss(
    'window-switcher',
    open,
    (reason) => {
      if (reason === 'superseded') windowSwitcher.cancel()
    },
    { dismissible: false },
  )

  // keyup 丢失兜底：window blur（切走标签页/OS 抢焦点）→ 提交当前选中。
  useEffect(() => {
    if (!open) return
    window.addEventListener('blur', commitFromLiveHandler)
    return () => window.removeEventListener('blur', commitFromLiveHandler)
  }, [open])

  // 面板开启期间窗口被关闭 → windowsChanged 从 live store 派生（选中顺延）。
  useEffect(() => {
    if (!open) return
    return useWindowStore.subscribe(windowsChangedFromLiveHandler)
  }, [open])

  if (!phase.render || windows.length === 0) return null

  return (
    // 容器 pointer-events-none：面板是 Hold 期瞬态（≈一次 Alt+W 按住的寿命），
    // 指针穿透桌面，交互全部在键盘模型内（审计 §9 键盘驱动 MVP）。
    <div
      data-testid="window-switcher-layer"
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
    >
      <div
        role="dialog"
        aria-label={t('window.switcher.title')}
        data-testid="window-switcher"
        className={`surface-glass glass-popover max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border shadow-popover ${popoverMotionClass(phase.exiting)}`}
      >
        <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <span className="text-xs font-medium text-text-muted">
            {t('window.switcher.title')}
          </span>
        </header>
        <ul className="flex max-w-full items-stretch gap-1.5 overflow-hidden px-3 py-3">
          {windows.map((win) => {
            const selected = win.id === selectedId
            return (
              <li
                key={win.id}
                data-testid="window-switcher-item"
                data-window-id={win.id}
                data-selected={selected || undefined}
                aria-current={selected ? 'true' : undefined}
                className={`flex w-28 shrink-0 flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 ${
                  selected
                    ? '[background:var(--ag-capsule-active)] text-primary-contrast'
                    : 'text-text-muted'
                }`}
              >
                <AppIcon appId={win.appId} size={32} />
                <span className="w-full truncate text-center text-[11px] leading-tight">
                  {win.title}
                </span>
                {win.state === 'minimized' && (
                  <span
                    className={`text-[10px] leading-none ${selected ? 'text-primary-contrast/80' : 'text-text-tertiary'}`}
                  >
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
          <span className="flex items-center gap-1">
            <SwitcherKbd>Alt</SwitcherKbd>
            <SwitcherKbd>W</SwitcherKbd>
            {t('window.switcher.hint.release')}
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
