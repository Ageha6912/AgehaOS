import { useEffect, useRef, useSyncExternalStore } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { useTranslation } from '@/core/i18n'
import { useWindowStore } from '@/store/window-store'

import {
  cancelFromLiveHandler,
  windowsChangedFromLiveHandler,
  windowSwitcher,
} from './use-switcher'

/**
 * Window Switcher 面板（Window Management 2.0 W6，审计 .tmp/spaces-audit.md
 * §9；**W11 真机反馈改版 §13 A——用户裁决，覆盖「松开提交」**）：Alt+W keydown
 * 开**常驻面板**（松开 W 不再提交收起），W 循环选中，**Enter/点击条目提交**，
 * Esc / backdrop 点击 / window blur 取消。
 *
 * - 视觉：`.glass-popover`（既有钉扎档，src/index.css.test.ts）+ 软影
 *   `shadow-popover` + AppIcon（与 Taskbar/搜索同源）+ 标题；选中态
 *   `--ag-capsule-active` 族（Sidebar 同款「primary 配额=Active/Selected」）；
 *   z-50 档（与搜索面板同层，popover 互斥保证不并存）。
 * - 互斥 + backdrop 取消（W11）：`usePopoverDismiss`（dismissible:true +
 *   insideRefs=面板）claim `'window-switcher'`；「outside」=面板外 pointerdown
 *   （backdrop 点击）与「焦点落进应用 iframe」→ cancel 关闭**不提交**；
 *   「superseded」=被其他弹层顶替 → 同样取消不提交（minimized 选中不被还原）。
 * - Esc 取消走 registry 既有条目（use-global-shortcuts「window.switcher.
 *   escape」，注册序在搜索 Esc 之前）；dismiss 钩子自带的 Esc 监听与之幂等
 *   （cancel 对已关面板零作用），分层纪律不变。
 * - window blur 取消（W11 从「提交兜底」改判）：面板已常驻、无 keyup 可丢失，
 *   切走标签页/OS 抢焦点时直接取消，不留悬挂面板。
 * - 点击选择（W11 新增交互）：条目为真 button（hover 反馈 + 原生键盘激活）；
 *   面板盒 pointer-events-auto、外层容器保持 pointer-events-none（面板外指针
 *   穿透桌面，同时 dismiss 钩子的 document pointerdown 判定 backdrop）。
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

  // 弹层互斥 + backdrop 取消（W11 审计 §13 A 决定 4）：开面板 claim、被顶替
  // （superseded）/面板外按下（outside）/焦点落进 iframe（outside）→ cancel
  // 关闭不提交；dismissible:true + insideRefs 让面板内 pointerdown 不误判。
  usePopoverDismiss(
    'window-switcher',
    open,
    (reason) => {
      if (reason === 'outside' || reason === 'superseded') windowSwitcher.cancel()
    },
    { dismissible: true, insideRefs: [panelRef] },
  )

  // window blur 取消（W11 改判，不得悬挂）：切走标签页/OS 抢焦点 → 取消不提交。
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
              >
                {/* 点击选择=提交该条目（W11 审计 §13 A 决定 3）；choose 内部
                    与 Enter 共享同一提交流（关窗竞态顺延 + minimized 组合）。 */}
                <button
                  type="button"
                  onClick={() => windowSwitcher.chooseFromLive(win.id)}
                  className={`flex w-28 cursor-pointer flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 ${
                    selected
                      ? '[background:var(--ag-capsule-active)] text-primary-contrast'
                      : 'text-text-muted hover:bg-surface-raised'
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
                </button>
              </li>
            )
          })}
        </ul>
        <footer
          data-testid="window-switcher-footer"
          className="flex items-center gap-4 border-t border-border-subtle px-4 py-2 text-[11px] text-text-muted"
        >
          <span className="flex items-center gap-1">
            <SwitcherKbd>enter</SwitcherKbd>
            {t('window.switcher.hint.commit')}
          </span>
          <span className="flex items-center gap-1">
            <SwitcherKbd>esc</SwitcherKbd>
            {t('window.switcher.hint.cancel')}
          </span>
          <span className="flex items-center gap-1">
            {t('window.switcher.hint.click')}
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
