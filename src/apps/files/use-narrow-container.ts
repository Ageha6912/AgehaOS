import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * 窄容器判定（M2-5 Files 窄容器适配）：ResizeObserver 观测应用根元素的
 * 内容盒宽度，`width < breakpoint` 时 narrow=true。按容器宽度分支、不读
 * 视口（HANDOFF M2-5 硬约束：禁止视口 media query，共享组件同时服务桌面
 * 窗口与移动 host）。
 *
 * 为什么是 ResizeObserver hook 而不是 Tailwind 4 container query（切片要求
 * 二选一）：
 * 1. 窄分支不止是样式——触屏交互语义也要分支（主列表「首击选中、再击
 *    打开」，见 FileManager 网格 onClick；触屏 dblclick 派发不可靠），
 *    CSS 容器查询给不了 JS 侧的分支依据，两套机制并存徒增状态分裂；
 * 2. container-type: inline-size 自带 layout containment——根元素会变成
 *    fixed 后代的包含块并自成堆叠上下文；FileManager 的 PromptDialog 与
 *    文件预览遮罩都是内联 `fixed inset-0`（无 portal），挂上 container-type
 *    桌面端弹层覆盖范围会从整个视口缩进窗口，桌面行为不再等价；
 * 3. 条件渲染（而非 CSS 隐藏）让桌面宽容器的 DOM 与改前字面等价。
 *
 * 无 ResizeObserver 的环境（vitest jsdom）降级为恒 narrow=false——桌面宽
 * 容器行为兜底，既有测试零改动；窄分支用例 stub ResizeObserver 显式喂宽
 * （FileManager.test.tsx 窄容器组），真实几何归 e2e/mobile-files.spec.ts。
 * ResizeObserver 回调每帧至多一次且 setState 在布尔值不变时 bail out：
 * 窗口拖拽缩放不产生高频重渲染（无 touchmove/pointermove 参与，rAF 节流
 * 铁律不适用本路径）。
 */

/** 窄容器断点：应用根内容盒宽 <560px 视为窄容器（M2-5 切片定档 ≈560px）。 */
export const FILES_NARROW_BREAKPOINT = 560

export interface NarrowContainer {
  /** 挂到应用根元素上——被观测的「容器」。 */
  ref: RefObject<HTMLDivElement | null>
  narrow: boolean
}

export function useNarrowContainer(
  breakpoint: number = FILES_NARROW_BREAKPOINT,
): NarrowContainer {
  const ref = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? el.clientWidth
      setNarrow((prev) => {
        const next = width < breakpoint
        return prev === next ? prev : next
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [breakpoint])

  return { ref, narrow }
}
