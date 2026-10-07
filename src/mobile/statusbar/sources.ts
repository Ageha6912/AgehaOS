/**
 * 移动状态栏真实数据源的纯探测函数（M1-1）：能力可用性判定与取值拆成
 * 接收 navigator 的纯函数——jsdom 单测可直接喂伪造 navigator 验证
 * 「能力不可用即隐藏」（DESIGN.md §0.5 真实性铁律：读不到的数据不渲染、
 * 绝不伪造）。设备类别判断仍只在 core/platform（架构铁律），这里只做
 * 浏览器 API 存在性探测，与桌面 MenuBar 的内联 getBattery 探测同口径。
 */

/** Battery Status API 的最小形状（Chromium 可用；其余环境整体隐藏）。 */
export interface BatterySource {
  level: number
  addEventListener(type: 'levelchange', listener: () => void): void
  removeEventListener(type: 'levelchange', listener: () => void): void
}

/**
 * 纯探测：`navigator.getBattery` 存在则返回「取电池」入口，不存在返回
 * null（null = 整体隐藏，禁止显示假电量）。包一层箭头函数让调用侧不必
 * 处理 this 绑定与类型收窄。
 */
export function batterySourceOf(nav: Navigator): (() => Promise<BatterySource>) | null {
  const getBattery = (nav as Navigator & { getBattery?: () => Promise<BatterySource> })
    .getBattery
  return typeof getBattery === 'function' ? () => getBattery() : null
}

/** 网络状态读数：onLine + connection.effectiveType（Network Information API）。 */
export interface NetworkSource {
  online: boolean
  effectiveType: string
}

/**
 * 纯探测：`navigator.connection.effectiveType` 可读则返回网络读数，
 * 否则返回 null（整体隐藏——Web 读不到的网络细节绝不画）。offline 布尔
 * 独立成值：connection 存在但掉线时仍渲染（切到 i18n「离线」文案），
 * 数据是真的，只是读数不同。
 */
export function networkSourceOf(nav: Navigator): NetworkSource | null {
  const connection = (nav as Navigator & { connection?: { effectiveType?: unknown } })
    .connection
  if (
    !connection
    || typeof connection.effectiveType !== 'string'
    || connection.effectiveType === ''
  ) {
    return null
  }
  return { online: nav.onLine, effectiveType: connection.effectiveType }
}
