import { useDeviceStore } from '@/store/device-store'
import {
  useInstallPromptStore,
  type BeforeInstallPromptEvent,
  type InstallPromptPhase,
} from '@/store/install-prompt-store'

import { resolveInstallPromptBranch, type InstallPromptBranch } from './install-prompt-decision'

/**
 * PWA 安装提示 hook（M3-3，概念展板屏⑩）：把常驻 store（
 * `@/store/install-prompt-store`）的能力采集与相位机接到 device-store 的
 * standalone / isIos 能力位，经 install-prompt-decision 纯函数裁决安装条
 * 分支。**真实能力，不伪造**：无事件的浏览器（Firefox 等）什么都不出；
 * iOS Safari 无此事件 → isIos 能力位走指引分支；已 standalone
 * （display-mode: standalone 或 navigator.standalone，M0-1 探针同一口径）
 * → 任何提示都不出。
 *
 * 与旧实现的差别（F2 审查修复）：beforeinstallprompt / appinstalled 的
 * 捕获与 deferred prompt 记账**不再属于本 hook**，而是模块级 store——本
 * hook 只做「读数 → 分支」的纯映射，随 MobileInstallBar 挂载/卸载不影响
 * 采集。进应用再回 Home、乃至登录前派发的事件都能接住；对话框取消后的
 * 新事件会把相位复位 idle，重新给出安装机会。
 *
 * 平台判定全部只读 device-store（架构铁律：UA/显示模式判断只在
 * core/platform 探针，消费方只读快照）；prompt() 消费、dismiss 持久化与
 * 相位机语义见 store 模块注释。
 */

export type { BeforeInstallPromptEvent, InstallPromptPhase }

export interface UseInstallPromptResult {
  /** 安装条分支（hidden 不渲染）。 */
  branch: InstallPromptBranch
  /** chromium 分支交互相位（见 store 相位机）。 */
  phase: InstallPromptPhase
  /** 调 deferred prompt.prompt() 并等待用户选择（仅 chromium 分支有意义）。 */
  promptInstall: () => Promise<void>
  /** 永久关闭：写 localStorage 版本键 + 会话内立即生效。 */
  dismiss: () => void
}

export function useInstallPrompt(): UseInstallPromptResult {
  // 平台/显示模式判定只读探针快照（device-store），本层零 UA/媒体查询。
  const standalone = useDeviceStore((state) => state.capabilities.standalone)
  const isIos = useDeviceStore((state) => state.capabilities.isIos)
  // 常驻能力采集（模块级 store，见模块注释）：原始类型/稳定动作引用。
  const hasDeferredPrompt = useInstallPromptStore((state) => state.hasPrompt)
  const installed = useInstallPromptStore((state) => state.installed)
  const dismissed = useInstallPromptStore((state) => state.dismissed)
  const phase = useInstallPromptStore((state) => state.phase)
  const promptInstall = useInstallPromptStore((state) => state.promptInstall)
  const dismiss = useInstallPromptStore((state) => state.dismiss)

  return {
    branch: resolveInstallPromptBranch({ standalone, installed, dismissed, hasDeferredPrompt, isIos }),
    phase,
    promptInstall,
    dismiss,
  }
}
