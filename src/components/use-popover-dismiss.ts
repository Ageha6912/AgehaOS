import { useEffect, useRef, type RefObject } from 'react'

import { usePopoverStore } from '@/store/popover-store'

export type PopoverDismissReason = 'escape' | 'outside' | 'superseded'

interface PopoverDismissOptions {
  /**
   * 视为「弹层内部」的区域（触发器包装 + 面板；portal 出去的面板要单独传）。
   * 在这些区域内按下不关闭。
   */
  insideRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  /**
   * false = 只参与互斥（弹层自带 Esc/外部点击逻辑，如菜单栏的键盘模型）。
   */
  dismissible?: boolean
}

/**
 * 弹层关闭契约（2026-10-02 UI 评审 P0-2，DESIGN.md §24）：打开期间
 * ① document 捕获阶段 Esc 关闭（焦点停在触发器或 portal 面板外时也生效）；
 * ② 内部区域外按下关闭——带 `data-popover-trigger="<id>"` 的外部触发器
 *    （如左栏通知项）豁免，交给它自己的 toggle；
 * ③ 焦点落进应用 iframe（document 收不到 pointerdown）关闭；
 * ④ 互斥：claim 全局槽，被其他弹层顶替即关闭。
 */
export function usePopoverDismiss(
  id: string,
  open: boolean,
  onClose: (reason: PopoverDismissReason) => void,
  { insideRefs = [], dismissible = true }: PopoverDismissOptions = {},
): void {
  const onCloseRef = useRef(onClose)
  const insideRefsRef = useRef(insideRefs)
  useEffect(() => {
    onCloseRef.current = onClose
    insideRefsRef.current = insideRefs
  })

  useEffect(() => {
    if (!open) return
    usePopoverStore.getState().claim(id)
    const unsubscribe = usePopoverStore.subscribe((state) => {
      if (state.active !== id) onCloseRef.current('superseded')
    })
    if (!dismissible) {
      return () => {
        unsubscribe()
        usePopoverStore.getState().release(id)
      }
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (insideRefsRef.current.some((ref) => ref.current?.contains(target))) return
      if (target instanceof Element && target.closest(`[data-popover-trigger="${id}"]`)) return
      onCloseRef.current('outside')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current('escape')
    }
    // window blur 也会在焦点离开 body 时触发（jsdom 及部分浏览器），切走
    // 浏览器标签页也不该关弹层：只在焦点确实落进 iframe 时才算外部点击。
    let blurTimer: ReturnType<typeof setTimeout> | undefined
    const onBlur = (): void => {
      clearTimeout(blurTimer)
      blurTimer = setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) onCloseRef.current('outside')
      }, 0)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearTimeout(blurTimer)
      unsubscribe()
      usePopoverStore.getState().release(id)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [id, open, dismissible])
}
