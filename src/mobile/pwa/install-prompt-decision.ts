/**
 * PWA 安装提示的判定与持久化纯函数（M3-3，概念展板屏⑩）：安装条在
 * 「隐藏 / Chromium 安装流 / iOS 指引」三档间如何取舍，全部收在这里可单测
 * ——hook（use-install-prompt.ts）只做事件采集与状态持有，UI
 * （MobileInstallBar.tsx）只做呈现。
 *
 * 判定输入全部是「真实能力的读数」：
 * - `standalone` = device-store 能力位（display-mode: standalone 或 iOS
 *   navigator.standalone）——已独立窗口运行即已安装形态，任何提示都不出；
 * - `installed` = 本会话内 appinstalled / prompt 接受后的安装落定；
 * - `dismissed` = 用户对本条的永久关闭（localStorage 版本键）；
 * - `hasDeferredPrompt` = beforeinstallprompt 已捕获（浏览器真实放行的
 *    安装流，能力即分支：Android/桌面 Chromium 走 prompt()）；
 * - `isIos` = device-store 能力位（iOS/iPadOS 家族）——Safari 无
 *   beforeinstallprompt，走「添加到主屏幕」指引分支。
 *
 * 优先序：已安装形态/落定/已关闭 → 隐藏；有 deferred prompt → Chromium
 * （真实事件优先于平台推断——iOS 上该事件永不派发，事件在场即能力在场）；
 * iOS 且无事件 → 指引；其余（桌面 FireFox、已装他人的浏览器等）→ 隐藏。
 */

/** 安装条分支：'hidden' = 不渲染；'chromium' = prompt() 安装流；'ios' = 指引。 */
export type InstallPromptBranch = 'hidden' | 'chromium' | 'ios'

/** resolveInstallPromptBranch 的判定输入（全部真实能力读数，见模块注释）。 */
export interface InstallPromptInputs {
  /** 独立窗口运行中（device-store standalone 能力位）。 */
  standalone: boolean
  /** 本会话内已落定安装（appinstalled / prompt 接受）。 */
  installed: boolean
  /** 用户已永久关闭本条（localStorage 版本键）。 */
  dismissed: boolean
  /** beforeinstallprompt 已捕获（deferred prompt 在册）。 */
  hasDeferredPrompt: boolean
  /** iOS / iPadOS 家族（device-store isIos 能力位）。 */
  isIos: boolean
}

/** 三档分支裁决（纯函数，优先序见模块注释）。 */
export function resolveInstallPromptBranch(inputs: InstallPromptInputs): InstallPromptBranch {
  if (inputs.standalone || inputs.installed || inputs.dismissed) return 'hidden'
  if (inputs.hasDeferredPrompt) return 'chromium'
  if (inputs.isIos) return 'ios'
  return 'hidden'
}

/**
 * dismiss 持久化键（带版本后缀）：用户关闭安装条后写入 `'1'`，此后不再
 * 打扰。改版文案/策略时 bump 版本段（v1 → v2），旧关闭记录自然失效——
 * 用户重新看到新版提示，而不是被一段旧键永久沉默。
 */
export const INSTALL_DISMISS_STORAGE_KEY = 'agehaos.mobile.pwa.installDismissed.v1'

/**
 * 读 dismiss 记录：键值为 `'1'` 视为已关闭。storage 不可用（隐私模式抛
 * 异常 / SSR）一律 false——读不到就不打断用户，绝不因此吞掉安装条。
 */
export function readInstallDismissed(storage: Storage | null | undefined): boolean {
  try {
    return storage?.getItem(INSTALL_DISMISS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 写 dismiss 记录。写入失败（隐私模式配额等）静默吞掉——会话内存态
 * （hook 的 dismissed state）本会话内仍然生效，持久化是尽力而为。
 */
export function writeInstallDismissed(storage: Storage | null | undefined): void {
  try {
    storage?.setItem(INSTALL_DISMISS_STORAGE_KEY, '1')
  } catch {
    /* 持久化不可用：会话内已生效，无需上报 */
  }
}
