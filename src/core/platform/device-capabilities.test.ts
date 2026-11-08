import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectDeviceCapabilities, detectUaChMobile, type DeviceCapabilities } from './device-capabilities'

/** 桌面 Chrome UA：无任何移动令牌，作各几何档的「非移动 UA」基线。 */
const DESKTOP_UA
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 探针输入桩：一切浏览器 API 读取均由这里注入。 */
interface ProbeStub {
  /** [innerWidth, innerHeight]；null = 视口缺失（走 1024×768 兜底档）。 */
  viewport: [number, number] | null
  /** 缺省 = 桌面 UA；'' = UA 缺失。 */
  userAgent?: string
  /** UA-CH 同步低熵位（userAgentData.mobile）。 */
  uaDataMobile?: boolean
  /** UA-CH 高熵位 getHighEntropyValues 的解析值；'reject' = 读取失败。 */
  uaCh?: { mobile?: boolean } | 'reject'
  maxTouchPoints?: number
  coarsePointer?: boolean
  hoverHover?: boolean
  /** matchMedia (display-mode: standalone) 的命中。 */
  displayStandalone?: boolean
  /** iOS 私有 navigator.standalone。 */
  iosNavigatorStandalone?: boolean
  /** matchMedia 整体缺失。 */
  omitMatchMedia?: boolean
  /** navigator 整体缺失。 */
  omitNavigator?: boolean
}

function stubProbe(stub: ProbeStub): void {
  if (stub.omitNavigator) {
    vi.stubGlobal('navigator', undefined)
  } else {
    const nav: Record<string, unknown> = {
      userAgent: stub.userAgent ?? DESKTOP_UA,
      maxTouchPoints: stub.maxTouchPoints ?? 0,
    }
    if (stub.uaDataMobile !== undefined || stub.uaCh !== undefined) {
      const userAgentData: Record<string, unknown> = {}
      if (stub.uaDataMobile !== undefined) userAgentData.mobile = stub.uaDataMobile
      if (stub.uaCh !== undefined) {
        userAgentData.getHighEntropyValues = async () => {
          if (stub.uaCh === 'reject') throw new Error('ua-ch unavailable')
          return stub.uaCh
        }
      }
      nav.userAgentData = userAgentData
    }
    if (stub.iosNavigatorStandalone !== undefined) nav.standalone = stub.iosNavigatorStandalone
    vi.stubGlobal('navigator', nav)
  }
  if (stub.viewport === null) {
    vi.stubGlobal('innerWidth', undefined)
    vi.stubGlobal('innerHeight', undefined)
  } else {
    vi.stubGlobal('innerWidth', stub.viewport[0])
    vi.stubGlobal('innerHeight', stub.viewport[1])
  }
  if (stub.omitMatchMedia) {
    vi.stubGlobal('matchMedia', undefined)
  } else {
    vi.stubGlobal('matchMedia', (query: string) => {
      if (query === '(pointer: coarse)') return { matches: stub.coarsePointer ?? false }
      if (query === '(hover: hover)') return { matches: stub.hoverHover ?? false }
      if (query === '(display-mode: standalone)') return { matches: stub.displayStandalone ?? false }
      return { matches: false }
    })
  }
}

/** 互斥三档不变量：isMobile / isTablet / isDesktop 恰一个为真。 */
function expectExactlyOneClass(caps: DeviceCapabilities): void {
  const flags = [caps.isMobile, caps.isTablet, caps.isDesktop]
  expect(flags.filter(Boolean)).toHaveLength(1)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectDeviceCapabilities：七档几何', () => {
  it('360×800 Android 手机 → mobile / portrait', () => {
    stubProbe({
      viewport: [360, 800],
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isMobile).toBe(true)
    expect(caps.isTouch).toBe(true)
    expect(caps.hasHover).toBe(false)
    expect(caps.orientation).toBe('portrait')
    expect(caps.viewportWidth).toBe(360)
    expect(caps.viewportHeight).toBe(800)
    expect(caps.standalone).toBe(false)
  })

  it('390×844 iPhone → mobile / portrait，iOS navigator.standalone 兜底 standalone', () => {
    stubProbe({
      viewport: [390, 844],
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
      iosNavigatorStandalone: true,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isMobile).toBe(true)
    expect(caps.orientation).toBe('portrait')
    expect(caps.standalone).toBe(true)
  })

  it('412×915 Android 经 UA-CH 同步位判明 → mobile / portrait', () => {
    stubProbe({
      viewport: [412, 915],
      // UA 故意不带移动令牌：钉死「UA-CH 低熵位优先于 UA 正则」的次序。
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      uaDataMobile: true,
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isMobile).toBe(true)
    expect(caps.orientation).toBe('portrait')
  })

  it('768×1024 旧版 iPad UA（无移动令牌）→ tablet / portrait', () => {
    stubProbe({
      viewport: [768, 1024],
      // iPadOS 12 时代 UA：含 iPad / Mobile/<build> Safari，但不含
      // Android/iPhone/Mobile Safari 三个兜底令牌 → 交给触屏 + 几何分类。
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isTablet).toBe(true)
    expect(caps.isMobile).toBe(false)
    expect(caps.isTouch).toBe(true)
    expect(caps.orientation).toBe('portrait')
  })

  it('1024×768 桌面 → desktop / landscape', () => {
    stubProbe({ viewport: [1024, 768], hoverHover: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isDesktop).toBe(true)
    expect(caps.isTouch).toBe(false)
    expect(caps.hasHover).toBe(true)
    expect(caps.orientation).toBe('landscape')
  })

  it('1280×720 桌面 → desktop / landscape', () => {
    stubProbe({ viewport: [1280, 720], hoverHover: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isDesktop).toBe(true)
    expect(caps.orientation).toBe('landscape')
  })

  it('1920×1080 桌面 → desktop / landscape', () => {
    stubProbe({ viewport: [1920, 1080], hoverHover: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isDesktop).toBe(true)
    expect(caps.orientation).toBe('landscape')
  })
})

describe('detectDeviceCapabilities：特殊形态', () => {
  it('触屏笔电（1920×1080 + maxTouchPoints + hover）因 hasHover 成立归桌面', () => {
    stubProbe({
      viewport: [1920, 1080],
      maxTouchPoints: 5,
      coarsePointer: false,
      hoverHover: true,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isTouch).toBe(true)
    expect(caps.hasHover).toBe(true)
    expect(caps.isDesktop).toBe(true)
    expect(caps.isMobile).toBe(false)
    expect(caps.isTablet).toBe(false)
  })

  it('iPadOS 13+ 自报 Macintosh：Macintosh UA + 触点 > 0 判 uaMobile', () => {
    stubProbe({
      viewport: [820, 1180],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isMobile).toBe(true)
    expect(caps.isTablet).toBe(false)
  })

  it('真 Mac（Macintosh UA + 零触点）不受 iPadOS 规则误伤，归桌面', () => {
    stubProbe({
      viewport: [1440, 900],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
      maxTouchPoints: 0,
      hoverHover: true,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isDesktop).toBe(true)
    expect(caps.isMobile).toBe(false)
  })

  it('UA 缺失（空字符串）：正则兜底安全走几何/触屏路径，不抛错', () => {
    stubProbe({
      viewport: [1280, 720],
      userAgent: '',
      hoverHover: true,
    })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isDesktop).toBe(true)

    // 同样 UA 缺失，靠「触屏 + 无悬停 + 短边 < 768」几何路径判手机。
    stubProbe({
      viewport: [360, 800],
      userAgent: '',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    const byGeometry = detectDeviceCapabilities()
    expectExactlyOneClass(byGeometry)
    expect(byGeometry.isMobile).toBe(true)
  })

  it('standalone 两态：display-mode standalone 命中为真、不命中为假', () => {
    stubProbe({ viewport: [1280, 720], hoverHover: true, displayStandalone: true })
    expect(detectDeviceCapabilities().standalone).toBe(true)

    stubProbe({ viewport: [1280, 720], hoverHover: true, displayStandalone: false, iosNavigatorStandalone: false })
    expect(detectDeviceCapabilities().standalone).toBe(false)
  })
})

describe('detectDeviceCapabilities：isIos 能力位（M3-3 PWA 安装指引）', () => {
  it('iPhone UA → isIos；桌面 UA → 非 iOS', () => {
    stubProbe({
      viewport: [390, 844],
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverHover: false,
    })
    expect(detectDeviceCapabilities().isIos).toBe(true)

    stubProbe({ viewport: [1280, 720], hoverHover: true })
    expect(detectDeviceCapabilities().isIos).toBe(false)
  })

  it('iPadOS 13+ 桌面级 UA（Macintosh + 触点 > 0）→ isIos；真 Mac（零触点）不受误伤', () => {
    const MACINTOSH_UA
      = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
    stubProbe({ viewport: [1024, 1366], userAgent: MACINTOSH_UA, maxTouchPoints: 5, coarsePointer: true })
    expect(detectDeviceCapabilities().isIos).toBe(true)

    stubProbe({ viewport: [1280, 720], userAgent: MACINTOSH_UA, maxTouchPoints: 0, hoverHover: true })
    expect(detectDeviceCapabilities().isIos).toBe(false)
  })

  it('UA 缺失 / navigator 缺失：isIos 安全归 false，不抛错', () => {
    stubProbe({ viewport: [390, 844], userAgent: '', maxTouchPoints: 5, coarsePointer: true })
    expect(detectDeviceCapabilities().isIos).toBe(false)

    stubProbe({ viewport: [390, 844], omitNavigator: true })
    expect(detectDeviceCapabilities().isIos).toBe(false)
  })
})

describe('detectDeviceCapabilities：能力缺失安全兜底', () => {
  it('matchMedia 缺失：coarse/hover/standalone 一律 false，不抛错', () => {
    stubProbe({ viewport: [1024, 768], omitMatchMedia: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isTouch).toBe(false)
    expect(caps.hasHover).toBe(false)
    expect(caps.standalone).toBe(false)
    expect(caps.isDesktop).toBe(true)
  })

  it('innerWidth/innerHeight 缺失：落 1024×768 兜底档（桌面 / landscape）', () => {
    stubProbe({ viewport: null, omitMatchMedia: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.viewportWidth).toBe(1024)
    expect(caps.viewportHeight).toBe(768)
    expect(caps.orientation).toBe('landscape')
    expect(caps.isDesktop).toBe(true)
  })

  it('navigator 整体缺失：触点/UA 读取安全归零，不抛错', () => {
    stubProbe({ viewport: [1280, 720], omitNavigator: true, hoverHover: true })
    const caps = detectDeviceCapabilities()
    expectExactlyOneClass(caps)
    expect(caps.isTouch).toBe(false)
    expect(caps.standalone).toBe(false)
    expect(caps.isDesktop).toBe(true)
  })
})

describe('detectUaChMobile：高熵位异步尽力而为', () => {
  it('getHighEntropyValues 读到 mobile 位时原样返回', async () => {
    stubProbe({ viewport: [1280, 720], uaCh: { mobile: true } })
    await expect(detectUaChMobile()).resolves.toBe(true)

    stubProbe({ viewport: [1280, 720], uaCh: { mobile: false } })
    await expect(detectUaChMobile()).resolves.toBe(false)
  })

  it('hints 缺 mobile 位返回 null', async () => {
    stubProbe({ viewport: [1280, 720], uaCh: {} })
    await expect(detectUaChMobile()).resolves.toBeNull()
  })

  it('读取失败返回 null，绝不抛错', async () => {
    stubProbe({ viewport: [1280, 720], uaCh: 'reject' })
    await expect(detectUaChMobile()).resolves.toBeNull()
  })

  it('UA-CH 不可用（无 userAgentData / navigator 缺失）返回 null', async () => {
    stubProbe({ viewport: [1280, 720] })
    await expect(detectUaChMobile()).resolves.toBeNull()

    stubProbe({ viewport: [1280, 720], omitNavigator: true })
    await expect(detectUaChMobile()).resolves.toBeNull()
  })
})

describe('探针边界收紧（B1 审查）', () => {
  it('0×0 视口（隐藏 iframe）按 1024×768 兜底，不再判成移动端', () => {
    const caps = detectDeviceCapabilities()
    expect(caps.isMobile).toBe(false)
    expect(caps.viewportWidth).toBe(1024)
    expect(caps.viewportHeight).toBe(768)
  })

  it('UA-CH 以方法调用（this 绑定 userAgentData；解构裸调用在真浏览器抛 Illegal invocation）', async () => {
    const userAgentData = {
      getHighEntropyValues(this: unknown): Promise<{ mobile?: boolean }> {
        if (this === null || typeof this !== 'object' || !('getHighEntropyValues' in this)) {
          return Promise.reject(new TypeError('Illegal invocation'))
        }
        return Promise.resolve({ mobile: true })
      },
    }
    vi.stubGlobal('navigator', { userAgent: DESKTOP_UA, userAgentData })
    await expect(detectUaChMobile()).resolves.toBe(true)
  })
})
