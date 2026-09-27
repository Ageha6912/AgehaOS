import { useEffect, useState } from 'react'

/**
 * 弹层进出场动效原语（motion-lab/menu-toast → 产品归档，docs/DESIGN.md §14）。
 *
 * 双层分离的产品化表达：进场沿用既有 `animate-os-pop-in` 关键帧（200ms
 * `--ag-motion-base`），退场用 transition（120ms `--ag-motion-fast` + ease-in，
 * 关闭恒不长于打开）；`useExitPhase` 让节点在退场过渡期间保持挂载，再次打开
 * 会取消退场（CSS transition 天然从当前呈现值续动，SPEC §3.6 可中断）。
 */

export const POPOVER_EXIT_MS = 120
export const TOAST_EXIT_MS = 120

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 无 WAAPI 的环境（jsdom/老浏览器）没有可播的 CSS transition，退场停留是
 * 死时间，还会让 fake-timer 测试里的退场元素永远挂着——按窗口动效同一契约
 * （WAAPI 缺失 → 瞬时终态）回退为即时卸载。
 */
export function hasMotionRuntime(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
}

/** 降级（reduced / 无动效运行时）时过渡瞬时完成（菜单退场等待归零）。 */
export function motionMs(ms: number): number {
  return prefersReducedMotion() || !hasMotionRuntime() ? 0 : ms
}

/** 菜单类浮层的动效类名：进场走关键帧，退场走 transition 到隐藏初态。 */
export function popoverMotionClass(exiting: boolean): string {
  return `transition-[opacity,transform] duration-[120ms] ease-[cubic-bezier(0.55,0,1,0.45)] ${
    exiting ? 'opacity-0 -translate-y-1' : 'animate-os-pop-in opacity-100 translate-y-0'
  }`
}

/** 通知卡片的动效类名：右侧滑入/滑出（translateX 24px 过冲 + 淡入淡出）。 */
export function toastMotionClass(exiting: boolean): string {
  return `transition-[opacity,transform] duration-[120ms] ease-[cubic-bezier(0.55,0,1,0.45)] ${
    exiting ? 'opacity-0 translate-x-6' : 'animate-os-toast-in opacity-100 translate-x-0'
  }`
}

/**
 * 退场相位：open 翻 false 后节点多存活 ms 毫秒（exiting=true 渲染关闭态类名），
 * 到点真正卸载；期间 open 翻回 true 立即恢复（计时器清理 + 关闭态清除）。
 */
export function useExitPhase(
  open: boolean,
  ms = POPOVER_EXIT_MS,
): { render: boolean; exiting: boolean } {
  const [render, setRender] = useState(open)
  // 渲染期派生重置（React 官方模式，坑 4）：open 翻转时同步更新挂载/退出态；
  // 无动效运行时保持旧的即时卸载语义（没有可播的过渡，停留是死时间）。
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    setRender(open || motionMs(ms) > 0)
  }
  const exiting = !open && render

  useEffect(() => {
    if (open || !render) return
    const timer = window.setTimeout(() => setRender(false), motionMs(ms))
    return () => window.clearTimeout(timer)
  }, [open, render, ms])

  return { render, exiting }
}
