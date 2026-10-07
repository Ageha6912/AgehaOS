import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeviceCapabilities } from '@/core/platform/device-capabilities'

import {
  initDeviceStore,
  resetDeviceStore,
  shellForCapabilities,
  useDeviceStore,
} from './device-store'

/**
 * 探针输入桩（与 device-capabilities.test.ts 同口径）：一切浏览器 API
 * 读取均由这里注入；matchMedia 额外携带可变的 matches 与监听注册表，
 * 供 matchMedia change 事件的流转测试触发。
 */

/** 桌面 Chrome UA：无移动令牌。 */
const DESKTOP_UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** Android 手机 UA：带移动令牌。 */
const MOBILE_UA
  = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

interface ProbeStub {
  viewport: [number, number]
  userAgent?: string
  maxTouchPoints?: number
  coarsePointer?: boolean
  hoverHover?: boolean
  displayStandalone?: boolean
}

const mediaState = {
  coarse: false,
  hover: false,
  standalone: false,
}
const mediaListeners = new Map<string, Set<() => void>>()

/** 触发一次 matchMedia change（测试用：模拟外接鼠标等能力位变化）。 */
function fireMediaChange(query: string): void {
  for (const listener of mediaListeners.get(query) ?? []) listener()
}

function stubProbe(stub: ProbeStub): void {
  vi.stubGlobal('navigator', {
    userAgent: stub.userAgent ?? DESKTOP_UA,
    maxTouchPoints: stub.maxTouchPoints ?? 0,
  })
  vi.stubGlobal('innerWidth', stub.viewport[0])
  vi.stubGlobal('innerHeight', stub.viewport[1])
  mediaState.coarse = stub.coarsePointer ?? false
  mediaState.hover = stub.hoverHover ?? false
  mediaState.standalone = stub.displayStandalone ?? false
  vi.stubGlobal('matchMedia', (query: string) => {
    const matches = query === '(pointer: coarse)'
      ? mediaState.coarse
      : query === '(hover: hover)'
        ? mediaState.hover
        : query === '(display-mode: standalone)'
          ? mediaState.standalone
          : false
    return {
      matches,
      addEventListener: (type: string, listener: () => void): void => {
        if (type !== 'change') return
        if (!mediaListeners.has(query)) mediaListeners.set(query, new Set())
        mediaListeners.get(query)!.add(listener)
      },
      removeEventListener: (_type: string, listener: () => void): void => {
        mediaListeners.get(query)?.delete(listener)
      },
    }
  })
}

/** DeviceCapabilities 夹具工厂：shellForCapabilities 纯映射测试用。 */
function caps(overrides: Partial<DeviceCapabilities>): DeviceCapabilities {
  return {
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isTouch: false,
    hasHover: true,
    viewportWidth: 1920,
    viewportHeight: 1080,
    orientation: 'landscape',
    standalone: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetDeviceStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
  mediaListeners.clear()
})

describe('shellForCapabilities（Shell 派生纯函数）', () => {
  it('手机 → mobile', () => {
    expect(shellForCapabilities(caps({ isMobile: true, isDesktop: false }))).toBe('mobile')
  })

  it('平板 → mobile（2026-10-07 裁决：tablet 也渲染 MobileShell，网格后续自适应）', () => {
    expect(
      shellForCapabilities(
        caps({ isTablet: true, isDesktop: false, isTouch: true, hasHover: false }),
      ),
    ).toBe('mobile')
  })

  it('桌面 → desktop', () => {
    expect(shellForCapabilities(caps({}))).toBe('desktop')
  })
})

describe('initDeviceStore：阈值边界（手机 / 平板 / 桌面分界）', () => {
  it('短边 360（360×800 手机）→ shell mobile', () => {
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')
    expect(useDeviceStore.getState().capabilities.isMobile).toBe(true)
  })

  it('短边 767（767×1024 触屏无悬停）→ isMobile → shell mobile', () => {
    stubProbe({ viewport: [767, 1024], maxTouchPoints: 5, coarsePointer: true, hoverHover: false })
    initDeviceStore()
    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.isMobile).toBe(true)
    expect(shell).toBe('mobile')
  })

  it('短边 768（768×1024 触屏无悬停）→ isTablet → shell mobile（平板同壳）', () => {
    stubProbe({ viewport: [768, 1024], maxTouchPoints: 5, coarsePointer: true, hoverHover: false })
    initDeviceStore()
    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.isTablet).toBe(true)
    expect(capabilities.isMobile).toBe(false)
    expect(shell).toBe('mobile')
  })

  it('短边 1023（1023×1366 触屏无悬停）→ isTablet → shell mobile', () => {
    stubProbe({ viewport: [1023, 1366], maxTouchPoints: 5, coarsePointer: true, hoverHover: false })
    initDeviceStore()
    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.isTablet).toBe(true)
    expect(shell).toBe('mobile')
  })

  it('短边 1024（1024×768 悬停）→ isDesktop → shell desktop', () => {
    stubProbe({ viewport: [1024, 768], hoverHover: true })
    initDeviceStore()
    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.isDesktop).toBe(true)
    expect(shell).toBe('desktop')
  })

  it('initDeviceStore 以当前环境重测（模块加载时的初始快照可能已陈旧）', () => {
    // 模块导入发生在 jsdom 默认环境（桌面档）；桩成手机后 init 必须翻到 mobile。
    expect(useDeviceStore.getState().shell).toBe('desktop')
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')
  })
})

describe('initDeviceStore：状态流转（resize / orientationchange / matchMedia change）', () => {
  it('resize：手机视口改为桌面视口 → shell 翻转 desktop，快照同步更新', () => {
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')

    stubProbe({ viewport: [1920, 1080], hoverHover: true })
    window.dispatchEvent(new Event('resize'))

    const { capabilities, shell } = useDeviceStore.getState()
    expect(shell).toBe('desktop')
    expect(capabilities.viewportWidth).toBe(1920)
    expect(capabilities.viewportHeight).toBe(1080)
    expect(capabilities.isDesktop).toBe(true)
  })

  it('orientationchange：360×800 竖屏转 800×360 横屏 → orientation 翻转，UA 手机恒 mobile', () => {
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    expect(useDeviceStore.getState().capabilities.orientation).toBe('portrait')

    stubProbe({ viewport: [800, 360], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    window.dispatchEvent(new Event('orientationchange'))

    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.orientation).toBe('landscape')
    expect(capabilities.viewportWidth).toBe(800)
    expect(shell).toBe('mobile')
  })

  it('matchMedia change：悬停位出现（外接鼠标）→ 平板档翻桌面档', () => {
    stubProbe({ viewport: [834, 1194], maxTouchPoints: 5, coarsePointer: true, hoverHover: false })
    initDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')

    mediaState.hover = true
    fireMediaChange('(hover: hover)')

    const { capabilities, shell } = useDeviceStore.getState()
    expect(capabilities.hasHover).toBe(true)
    expect(shell).toBe('desktop')
  })

  it('快照未变化的高频 resize 不触发订阅者（拖拽缩放零空通知）', () => {
    stubProbe({ viewport: [1280, 720], hoverHover: true })
    initDeviceStore()
    let notifications = 0
    const unsubscribe = useDeviceStore.subscribe(() => {
      notifications += 1
    })
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    unsubscribe()
    expect(notifications).toBe(0)
  })
})

describe('initDeviceStore：幂等与 resetDeviceStore 隔离', () => {
  it('重复 init 不叠加监听：单次 reset 后 resize 不再驱动状态', () => {
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    initDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')

    resetDeviceStore()
    stubProbe({ viewport: [1920, 1080], hoverHover: true })
    window.dispatchEvent(new Event('resize'))

    expect(useDeviceStore.getState().shell).toBe('mobile')
  })

  it('resetDeviceStore 回到当前环境快照并恢复可再次 init', () => {
    stubProbe({ viewport: [360, 800], userAgent: MOBILE_UA, maxTouchPoints: 5, coarsePointer: true })
    initDeviceStore()
    resetDeviceStore()
    expect(useDeviceStore.getState().shell).toBe('mobile')

    initDeviceStore()
    stubProbe({ viewport: [1920, 1080], hoverHover: true })
    window.dispatchEvent(new Event('resize'))
    expect(useDeviceStore.getState().shell).toBe('desktop')
  })
})
