import { create } from 'zustand'

import {
  detectDeviceCapabilities,
  type DeviceCapabilities,
} from '@/core/platform/device-capabilities'

/**
 * 设备快照 store（M0-2 Shell Selection）：持有 M0-1 探针（core/platform/
 * device-capabilities，全仓库唯一允许做设备类别判断的集中模块）的结果快照，
 * 并派生本会话的 Shell 选择——`shell: 'desktop' | 'mobile'`。消费方（App、
 * UI）只读本 store，严禁自行散落 innerWidth / UA 判断（架构铁律）。
 *
 * 裁决（2026-10-07）：手机与平板都渲染 MobileShell（平板网格后续自适应），
 * 其余归 Desktop——触屏笔电因 hasHover 成立天然落桌面（M0-1 分类规则）。
 *
 * 响应式：initDeviceStore() 订阅 resize / orientationchange 与相关
 * matchMedia（pointer: coarse / hover: hover / display-mode: standalone）
 * change，任一触发即整份重测（探针是同步纯读取，重测成本可忽略）；快照
 * 与当前值全等时跳过 setState，避免拖拽缩放期间高频空通知。
 */

/** 本会话渲染的 Shell：'mobile' = MobileShell，'desktop' = Desktop。 */
export type ShellKind = 'desktop' | 'mobile'

/** Shell 派生纯函数：手机与平板都归 mobile（裁决见模块注释）。 */
export function shellForCapabilities(capabilities: DeviceCapabilities): ShellKind {
  return capabilities.isMobile || capabilities.isTablet ? 'mobile' : 'desktop'
}

interface DeviceState {
  capabilities: DeviceCapabilities
  shell: ShellKind
}

/** 重测一次探针并组装状态（init 与事件重测共用同一份派生逻辑）。 */
function measure(): DeviceState {
  const capabilities = detectDeviceCapabilities()
  return { capabilities, shell: shellForCapabilities(capabilities) }
}

/** capabilities 逐位浅比较（新对象引用不等于值变化）。 */
function sameCapabilities(a: DeviceCapabilities, b: DeviceCapabilities): boolean {
  return a.isMobile === b.isMobile
    && a.isTablet === b.isTablet
    && a.isDesktop === b.isDesktop
    && a.isTouch === b.isTouch
    && a.hasHover === b.hasHover
    && a.viewportWidth === b.viewportWidth
    && a.viewportHeight === b.viewportHeight
    && a.orientation === b.orientation
    && a.standalone === b.standalone
    && a.isIos === b.isIos
}

export const useDeviceStore = create<DeviceState>()(() => measure())

let disposeListeners: (() => void) | null = null

/**
 * 启动初始化（main.tsx 装配链，仅客户端——store 自身在各环节都有
 * window 缺失守卫，SSR/测试环境安全）：以当前环境重测刷新模块加载时的
 * 初始快照，再挂事件订阅。幂等：重复调用不叠加监听。
 */
export function initDeviceStore(): void {
  if (disposeListeners !== null) return
  useDeviceStore.setState(measure())
  if (typeof window === 'undefined') return

  const remeasure = (): void => {
    const next = measure()
    const prev = useDeviceStore.getState()
    if (prev.shell !== next.shell || !sameCapabilities(prev.capabilities, next.capabilities)) {
      useDeviceStore.setState(next)
    }
  }
  window.addEventListener('resize', remeasure)
  window.addEventListener('orientationchange', remeasure)

  // 相关 matchMedia 位变化（外接鼠标、安装到主屏等）同样重测；API 缺失
  // （旧 Safari 的 addEventListener）或抛错时静默跳过该位——resize/orientation
  // 兜底仍在。matchMedia 整体缺失则一个位都不订。
  const mediaDisposers: Array<() => void> = []
  for (const query of ['(pointer: coarse)', '(hover: hover)', '(display-mode: standalone)']) {
    try {
      if (typeof window.matchMedia !== 'function') break
      const media = window.matchMedia(query)
      if (typeof media.addEventListener !== 'function') continue
      media.addEventListener('change', remeasure)
      mediaDisposers.push(() => media.removeEventListener('change', remeasure))
    } catch {
      /* 该查询位订阅失败：跳过，其余位不受影响 */
    }
  }

  disposeListeners = () => {
    window.removeEventListener('resize', remeasure)
    window.removeEventListener('orientationchange', remeasure)
    for (const dispose of mediaDisposers) dispose()
    disposeListeners = null
  }
}

/** 测试隔离出口：摘除全部监听并回到当前环境的全新快照。 */
export function resetDeviceStore(): void {
  disposeListeners?.()
  disposeListeners = null
  useDeviceStore.setState(measure())
}
