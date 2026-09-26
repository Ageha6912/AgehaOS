import { useCallback, useSyncExternalStore, type RefObject } from 'react'

/**
 * 列表滚动区检测（DESIGN.md §3）：给底部渐隐遮罩/滚动提示提供
 * 「有溢出 且 未到底」的判定。快照是原始字符串（引用稳定），
 * 经 useSyncExternalStore 订阅 scroll / 子树变更 / 元素尺寸，
 * 避免 effect 内 setState。
 */
export type ScrollZone = 'none' | 'bottom' | 'more'

/** 纯谓词：≤1px 视为无溢出/已到底（亚像素与取整容差）。 */
export function scrollZoneKey(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ScrollZone {
  if (scrollHeight - clientHeight <= 1) return 'none'
  return scrollTop + clientHeight >= scrollHeight - 1 ? 'bottom' : 'more'
}

const EMPTY_ZONE: ScrollZone = 'none'

export function useScrollZone(ref: RefObject<HTMLElement | null>): ScrollZone {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const el = ref.current
      if (!el) return () => {}
      el.addEventListener('scroll', onChange, { passive: true })
      // 列表条目增删（如安装/推送）改变 scrollHeight 而不改容器盒尺寸。
      const mutations = new MutationObserver(onChange)
      mutations.observe(el, { childList: true, subtree: true })
      let resize: ResizeObserver | undefined
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(onChange)
        resize.observe(el)
      }
      return () => {
        el.removeEventListener('scroll', onChange)
        mutations.disconnect()
        resize?.disconnect()
      }
    },
    [ref],
  )
  const getSnapshot = useCallback(
    () =>
      ref.current
        ? scrollZoneKey(ref.current.scrollTop, ref.current.scrollHeight, ref.current.clientHeight)
        : EMPTY_ZONE,
    [ref],
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ZONE)
}
