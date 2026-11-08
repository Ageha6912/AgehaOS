/**
 * 设备能力探针（框架无关，core 纯 TS）：全仓库**唯一**允许做设备类别
 * 判断（UA / 触点 / 视口几何 → 手机 / 平板 / 桌面）的集中模块——store 与
 * UI 层严禁散落 innerWidth / UA 正则判断（架构铁律），消费方只读本探针
 * 的结果快照。
 *
 * 同步读取：matchMedia (pointer: coarse) / (hover: hover) /
 * (display-mode: standalone)、navigator.maxTouchPoints、iOS 私有的
 * navigator.standalone、innerWidth/innerHeight。UA-CH 高熵位
 * （getHighEntropyValues）是异步接口，无法进同步探针——同步路径用 UA
 * 正则兜底（见 looksLikeMobileUa），异步权威位另见 detectUaChMobile，
 * 供后续 store 切片做精化。
 *
 * 一切能力不可用走安全 fallback（matchMedia 缺失 = false、视口缺失 =
 * 1024×768 桌面档），绝不抛错；只做浏览器 API 读取，禁止任何 DOM 操作。
 */

/** 设备能力快照：detectDeviceCapabilities 的同步结果。 */
export interface DeviceCapabilities {
  /** 手机：UA 判明移动端，或触屏 + 无悬停 + 短边 < 768。 */
  isMobile: boolean
  /** 平板：非手机 + 触屏 + 无悬停 + 768 ≤ 短边 < 1024。 */
  isTablet: boolean
  /** 桌面：其余（触屏笔电因 hasHover 成立归此类）。 */
  isDesktop: boolean
  /** 触屏：primary pointer 为 coarse，或 maxTouchPoints > 0。 */
  isTouch: boolean
  /** 悬停能力：matchMedia (hover: hover) 命中。 */
  hasHover: boolean
  viewportWidth: number
  viewportHeight: number
  /** 宽 ≥ 高 = landscape，否则 portrait。 */
  orientation: 'portrait' | 'landscape'
  /** 独立窗口模式（PWA display-mode: standalone 或 iOS 主屏 Web App）。 */
  standalone: boolean
  /**
   * iOS / iPadOS 家族（iPhone/iPad/iPod UA 令牌，或 iPadOS 13+ 的
   * 「Macintosh UA + 触点 > 0」识别——与 uaMobile 同一线索）。消费方：
   * PWA 安装提示的 iOS 指引分支（Safari 无 beforeinstallprompt）。
   */
  isIos: boolean
}

/**
 * 手机 / 平板分界：短边 < 768 归手机。依据：主流手机竖屏宽 360–430、
 * 横屏短边 ≤ 448，而 iPad 全系竖屏短边从 768 起（768×1024 起）；768 同时
 * 是 CSS 生态通行的 md 断点，作为「手机 / 平板」分界最稳。
 */
const TABLET_MIN_SIDE_PX = 768

/**
 * 平板 / 桌面分界：短边 ≥ 1024 归桌面。依据：iPad 横屏短边 = 768、竖屏
 * 短边 = 768/810/820/834 均落在平板带内；1024（iPad Pro 12.9 竖屏宽、CSS
 * lg 断点）起桌面多栏布局可用，作为「平板 / 桌面」分界。
 */
const DESKTOP_MIN_SIDE_PX = 1024

/**
 * 视口缺失兜底档：1024×768 = 经典桌面档（与 jsdom 默认一致），保证
 * 「探测不出视口」的宿主恒落桌面分类而不是误判手机。
 */
const FALLBACK_VIEWPORT_WIDTH = 1024
const FALLBACK_VIEWPORT_HEIGHT = 768

/**
 * UA 正则兜底（UA-CH 缺失时判 uaMobile）：Android / iPhone / Mobile Safari。
 * 依据：Android 手机与 iOS UA 恒含 Android 或 iPhone；Chrome Android 恒带
 * 「Mobile Safari/537.36」令牌，桌面与 Android 平板 UA 均不带 Mobile 令牌。
 */
const MOBILE_UA_PATTERN = /Android|iPhone|Mobile Safari/i

/**
 * iPadOS 13+ 桌面级 UA 自报 Macintosh，UA 正则认不出——唯一可靠线索是
 * 「Macintosh UA + 触点 > 0」（真 Mac 无触屏，maxTouchPoints 恒 0）。
 */
const MACINTOSH_UA_PATTERN = /Macintosh/i

/**
 * iOS / iPadOS UA 家族令牌（iPhone/iPad/iPod）。与 MOBILE_UA_PATTERN 并列
 * 的平台族判定（不是设备类别判断），供需要按 OS 分支的能力（PWA 安装指引
 * 等）只读探针结果使用；iPadOS 13+ 桌面级 UA 归入 MACINTOSH+触点线索。
 */
const IOS_UA_PATTERN = /iPhone|iPad|iPod/i

/** matchMedia 安全读取：API 缺失或抛错一律 false，绝不抛出。 */
function mediaQueryMatches(query: string): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches === true
  } catch {
    return false
  }
}

/** 视口安全读取：innerWidth/innerHeight 缺失或非正数（0×0 隐藏 iframe、
 *  异常宿主，B1 审查）落 1024×768 兜底档。 */
function readViewportSize(): { width: number; height: number } {
  const rawWidth = typeof window !== 'undefined' ? window.innerWidth : undefined
  const rawHeight = typeof window !== 'undefined' ? window.innerHeight : undefined
  const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
    ? rawWidth
    : FALLBACK_VIEWPORT_WIDTH
  const height = typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
    ? rawHeight
    : FALLBACK_VIEWPORT_HEIGHT
  return { width, height }
}

/** 触点数安全读取：navigator/maxTouchPoints 缺失一律 0。 */
function readMaxTouchPoints(): number {
  try {
    if (typeof navigator === 'undefined') return 0
    const points = navigator.maxTouchPoints
    if (typeof points !== 'number' || !Number.isFinite(points)) return 0
    return Math.max(0, Math.floor(points))
  } catch {
    return 0
  }
}

/** iOS 私有 navigator.standalone 安全读取（主屏 Web App 老式探测位）。 */
function readIosNavigatorStandalone(): boolean {
  try {
    if (typeof navigator === 'undefined') return false
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** UA-CH 同步低熵位 + UA 正则兜底：同步路径的 uaMobile 判定。 */
function looksLikeMobileUa(maxTouchPoints: number): boolean {
  try {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
    // UA-CH 低熵位（Chromium 同步可得，与高熵 getHighEntropyValues('mobile') 同值）优先。
    if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : ''
    if (MOBILE_UA_PATTERN.test(ua)) return true
    return MACINTOSH_UA_PATTERN.test(ua) && maxTouchPoints > 0
  } catch {
    return false
  }
}

/** iOS / iPadOS 家族判定：UA 令牌，或 iPadOS 13+ 的「Macintosh + 触点」线索。 */
function looksLikeIosUa(maxTouchPoints: number): boolean {
  try {
    if (typeof navigator === 'undefined') return false
    const ua = typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
    if (IOS_UA_PATTERN.test(ua)) return true
    return MACINTOSH_UA_PATTERN.test(ua) && maxTouchPoints > 0
  } catch {
    return false
  }
}

/** 纯分类：输入各路探测结果，产出互斥三档 + 能力位快照。 */
function classifyCapabilities(input: {
  uaMobile: boolean
  isIos: boolean
  isTouch: boolean
  hasHover: boolean
  width: number
  height: number
}): DeviceCapabilities {
  const minSide = Math.min(input.width, input.height)
  // 分类规则（阈值依据见常量注释）：
  // - isMobile：UA 判明移动端，或「触屏 + 无悬停 + 短边 < 768」（触屏笔电
  //   因 hasHover 成立被排除，归桌面）。
  // - isTablet：非手机 + 触屏 + 无悬停 + 768 ≤ 短边 < 1024。
  // - isDesktop：其余。
  const isMobile = input.uaMobile || (input.isTouch && !input.hasHover && minSide < TABLET_MIN_SIDE_PX)
  const isTablet = !isMobile && input.isTouch && !input.hasHover
    && minSide >= TABLET_MIN_SIDE_PX && minSide < DESKTOP_MIN_SIDE_PX
  return {
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    isTouch: input.isTouch,
    hasHover: input.hasHover,
    viewportWidth: input.width,
    viewportHeight: input.height,
    orientation: input.width >= input.height ? 'landscape' : 'portrait',
    standalone: mediaQueryMatches('(display-mode: standalone)') || readIosNavigatorStandalone(),
    isIos: input.isIos,
  }
}

/**
 * 同步探测设备能力。启动路径可直接调用；结果是一次性快照，旋转 /
 * 改变窗口大小后需重新调用（响应式订阅归后续 store 切片）。
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  const { width, height } = readViewportSize()
  const maxTouchPoints = readMaxTouchPoints()
  const isTouch = mediaQueryMatches('(pointer: coarse)') || maxTouchPoints > 0
  const hasHover = mediaQueryMatches('(hover: hover)')
  return classifyCapabilities({
    uaMobile: looksLikeMobileUa(maxTouchPoints),
    isIos: looksLikeIosUa(maxTouchPoints),
    isTouch,
    hasHover,
    width,
    height,
  })
}

/**
 * UA-CH 高熵位异步尽力而为读取（`getHighEntropyValues(['mobile'])`）：
 * 读到即为权威 uaMobile 位，与同步探针的 UA 正则兜底互补。UA-CH 不可用
 * （Safari / Firefox / 非安全上下文）、hints 缺 mobile 位或读取失败一律
 * 返回 null，绝不抛错；同步消费方直接用 detectDeviceCapabilities()。
 */
export async function detectUaChMobile(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined') return null
    const nav = navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ mobile?: unknown }> }
    }
    const uaData = nav.userAgentData
    // WebIDL 品牌检查：解构后裸调用会因 this 缺失抛 Illegal invocation（B1 审查）。
    if (typeof uaData?.getHighEntropyValues !== 'function') return null
    const hints = await uaData.getHighEntropyValues(['mobile'])
    const mobile = hints?.mobile
    return typeof mobile === 'boolean' ? mobile : null
  } catch {
    return null
  }
}
