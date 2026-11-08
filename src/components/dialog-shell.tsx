import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { isImeComposing } from './ime-guard'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogShellProps {
  /** 可访问名（role=dialog 的 aria-label）。 */
  title: string
  /** 可选测试锚点。 */
  testId?: string
  /** Esc / 遮罩点击（可空：纯展示态不响应）。 */
  onClose?: () => void
  children: ReactNode
}

/**
 * 共享弹层壳（E3 审查修复）：所有模态对话框统一 **createPortal 到 body**。
 *
 * 为什么必须 portal：`.spatial-window` 恒带 `backdrop-filter`（styles/
 * spatial.css），Chromium 里 backdrop-filter 会成为 position:fixed 后代的
 * 包含块——不 portal 时 `fixed inset-0` 遮罩只盖住**应用窗口**而不是视口，
 * 窗口 overflow-hidden 还会裁剪弹层、z-index 只在窗口层叠上下文内生效
 * （DESIGN §0.4 坑 67；羽化举报框/快捷键面板已手工 portal 是正例）。
 *
 * 可访问性（同批修复）：`role=dialog + aria-modal`、挂载即聚焦
 * `[data-autofocus]`（缺省首个可聚焦元素）、Tab/Shift+Tab 焦点循环、Esc
 * 关闭（IME 组合期交给输入法，不吞选词）、卸载恢复打开前焦点；遮罩点击 =
 * 取消（忙态同样可退出，避免网络悬挂时弹层锁死窗口）。
 */
export function DialogShell({ title, testId, onClose, children }: DialogShellProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = rootRef.current
    const initial =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initial ?? root)?.focus()
    return () => {
      const restore = restoreRef.current
      // 触发元素可能已随窗口卸载：仅在仍连接时回焦。
      if (restore !== null && restore.isConnected) restore.focus()
    }
  }, [])

  useEffect(() => {
    if (onClose === undefined) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 组合期 Esc 属于输入法（取消候选），不得关闭弹层。
      if (isImeComposing(event)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  /** Tab 焦点陷阱：从末尾 Tab 回首个、从首个 Shift+Tab 回末尾。 */
  const trapTab = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const root = rootRef.current
    if (root === null) return
    const focusables = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusables.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    const outside = active === null || !root.contains(active)
    if (event.shiftKey) {
      if (outside || active === first || active === root) {
        event.preventDefault()
        last.focus()
      }
    } else if (outside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      tabIndex={-1}
      className="animate-os-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-scrim-strong p-6 backdrop-blur-sm"
      onKeyDown={trapTab}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
