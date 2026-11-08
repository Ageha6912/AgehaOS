import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from 'react'

import { useLauncherStore } from '@/store/launcher-store'
import { useNotificationStore } from '@/store/notification-store'

/**
 * Workspace Panel 展开状态（Desktop Shell 3.0 STEP 2）：窄 Rail →
 * hover/click → 展开 Workspace Panel 的状态机。
 *
 * 三路触发合并为 `expanded`：
 * - hover：mouseenter 立即展开；mouseleave 240ms 宽限后收起（跨过面板内
 *   间隙/瞬时滑出不闪收）。
 * - 键盘：focusin 进入面板即展开，焦点离开（focusout 的 relatedTarget 在
 *   边界外）即收起——Tab 进出即开合，无障碍可达。
 * - click 固定（pin）：品牌钮切换 pin；pin 期间鼠标离开不收起，由
 *   Esc / 面板外按下 / 打开启动器或通知中心（弹层互斥，§24 同精神）收起。
 *
 * 不用 usePopoverDismiss：面板是常驻 chrome 的展开态而非独占弹层——
 * popover-store 的全局槽 claim 会让顶栏菜单与它互相顶替，语义不符；
 * Esc / 外部按下在此就地实现（边界判定复用 Desktop 的 railsRef）。
 */

/** mouseleave 宽限期（ms）：期间重新进入即取消收起。 */
const LEAVE_GRACE_MS = 240

export interface WorkspacePanelController {
  expanded: boolean
  pinned: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocusCapture: () => void
  onBlurCapture: (event: React.FocusEvent) => void
  togglePin: () => void
  /** Esc / 外部按下后的强制收起（含把焦点交还品牌钮）。 */
  collapse: () => void
}

export function useWorkspacePanel(
  boundaryRef: RefObject<HTMLElement | null>,
  brandButtonTestId = 'sidebar-brand',
): WorkspacePanelController {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const leaveTimer = useRef<number | undefined>(undefined)
  // 指针来源的焦点不参与「聚焦展开」：鼠标点击轨内条目后焦点留在原地，
  // 若计入 focusWithin 会让面板对鼠标用户常开不收。pointerdown 置位抑制、
  // keydown 解除（键盘 Tab/Enter 恢复正常的聚焦展开语义）。
  const pointerFocusSuppressed = useRef(false)
  // 收起动作把焦点交还品牌钮时，这次 focusin 不应再触发「聚焦展开」。
  const suppressNextFocus = useRef(false)

  const launcherOpen = useLauncherStore((s) => s.launcherOpen)
  const notificationOpen = useNotificationStore((s) => s.panelOpen)

  const cancelLeave = useCallback((): void => {
    if (leaveTimer.current !== undefined) {
      window.clearTimeout(leaveTimer.current)
      leaveTimer.current = undefined
    }
  }, [])

  const collapse = useCallback((): void => {
    cancelLeave()
    setHovered(false)
    setPinned(false)
    setFocusWithin(false)
    // 焦点若在面板内，收起后内容 inert、焦点丢到 body——交还品牌钮。
    const owner = document.activeElement
    if (owner instanceof Node && boundaryRef.current?.contains(owner)) {
      const brand = boundaryRef.current.querySelector(
        `[data-testid="${brandButtonTestId}"]`,
      ) as HTMLElement | null
      if (brand && document.activeElement !== brand) {
        suppressNextFocus.current = true
        brand.focus()
      }
    }
  }, [boundaryRef, brandButtonTestId, cancelLeave])

  const onMouseEnter = useCallback((): void => {
    cancelLeave()
    setHovered(true)
  }, [cancelLeave])

  const onMouseLeave = useCallback((): void => {
    cancelLeave()
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = undefined
      setHovered(false)
    }, LEAVE_GRACE_MS)
  }, [cancelLeave])

  const onFocusCapture = useCallback((): void => {
    // 收起引发的回焦（品牌钮在边界内）不能把面板重新展开。
    if (suppressNextFocus.current) {
      suppressNextFocus.current = false
      return
    }
    if (pointerFocusSuppressed.current) return
    cancelLeave()
    setFocusWithin(true)
  }, [cancelLeave])

  const onBlurCapture = useCallback((event: FocusEvent): void => {
    const next = event.relatedTarget
    if (next instanceof Node && boundaryRef.current?.contains(next)) return
    setFocusWithin(false)
  }, [boundaryRef])

  // pin 翻转（StrictMode 安全：updater 内不做副作用，收起动作走渲染镜像）。
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const togglePin = useCallback((): void => {
    if (pinnedRef.current) {
      cancelLeave()
      setHovered(false)
      setFocusWithin(false)
      setPinned(false)
    } else {
      setPinned(true)
    }
  }, [cancelLeave])

  // 弹层互斥：启动器/通知中心打开即收起（否则 300-340px 面板与左锚定
  // 弹层几何重叠；见 AppLauncher 的 rail-left 锚定）。
  useEffect(() => {
    if (launcherOpen || notificationOpen) {
      cancelLeave()
      setHovered(false)
      setPinned(false)
      setFocusWithin(false)
    }
  }, [launcherOpen, notificationOpen, cancelLeave])

  // 焦点来源启发式（document 捕获阶段）：见 pointerFocusSuppressed 注释。
  const expanded = hovered || pinned || focusWithin
  useEffect(() => {
    const onKey = (): void => {
      pointerFocusSuppressed.current = false
    }
    const onPointer = (): void => {
      pointerFocusSuppressed.current = true
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [])

  // 展开态的收起契约（不限于 pin）：Esc / 面板外按下（document 捕获阶段，
  // 边界内豁免）。悬停态物理上不会有面板外按下（指针在外早已收起）——
  // 此监听覆盖 240ms 宽限窗口与测试环境的指针瞬移。
  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') collapse()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && boundaryRef.current?.contains(target)) return
      collapse()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [expanded, boundaryRef, collapse])

  useEffect(() => cancelLeave, [cancelLeave])

  return {
    expanded,
    pinned,
    onMouseEnter,
    onMouseLeave,
    onFocusCapture,
    onBlurCapture,
    togglePin,
    collapse,
  }
}
