import { useCallback, useEffect, useRef, useState } from 'react'

import { useDeviceStore } from '@/store/device-store'

import {
  readInstallDismissed,
  resolveInstallPromptBranch,
  writeInstallDismissed,
  type InstallPromptBranch,
} from './install-prompt-decision'

/**
 * PWA 安装提示 hook（M3-3，概念展板屏⑩）：捕获 beforeinstallprompt 存
 * deferred prompt（防重复：首个未消费的事件唯一在册，后续事件不顶替），
 * 连同 device-store 的 standalone / isIos 能力位与 dismiss 持久化记录，
 * 经 install-prompt-decision 纯函数裁决安装条分支。**真实能力，不伪造**：
 * 无事件的浏览器（Firefox 等）什么都不出；iOS Safari 无此事件 → isIos
 * 能力位走指引分支；已 standalone（display-mode: standalone 或
 * navigator.standalone，M0-1 探针同一口径）→ 任何提示都不出。
 *
 * 平台判定全部只读 device-store（架构铁律：UA/显示模式判断只在
 * core/platform 探针，消费方只读快照）；本 hook 只做三件浏览器事件层的事
 * ——事件捕获（preventDefault 抑制浏览器自带 mini-infobar，由安装条接管）、
 * appinstalled 落定、prompt() 消费。相位机：
 * - `idle`：chromium 分支在册可点；
 * - `pending`：prompt() 已调、等待 userChoice（按钮禁用防重复消费）；
 * - `accepted`：用户接受 → installed 落定（appinstalled 亦会派发），分支
 *   裁决隐藏，原生安装 UI 接管；
 * - `dismissed`：用户在浏览器对话框取消 → deferred prompt 已被消费（同
 *   事件不能再弹），分支保持 chromium 但 UI 换反馈行（按钮退场，无死钮），
 *   关闭钮仍可永久dismiss。
 *
 * prompt() 抛错（事件已消费/浏览器拒绝）视为能力实际不可用：撤销在册
 * prompt，分支随之重新裁决（非 iOS 直接隐藏），绝不留下永远失败的按钮。
 */

/** beforeinstallprompt 事件的最小形状（Chromium 扩展事件）。 */
export interface BeforeInstallPromptEvent extends Event {
  /** 唤起浏览器安装流（每事件至多一次，重复调用抛错）。 */
  prompt: () => Promise<void>
  /** 用户在浏览器对话框的选择（prompt() 之后才落定）。 */
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** chromium 分支的交互相位（ios/hidden 分支不消费）。 */
export type InstallPromptPhase = 'idle' | 'pending' | 'accepted' | 'dismissed'

export interface UseInstallPromptResult {
  /** 安装条分支（hidden 不渲染）。 */
  branch: InstallPromptBranch
  /** chromium 分支交互相位（见模块注释相位机）。 */
  phase: InstallPromptPhase
  /** 调 deferred prompt.prompt() 并等待用户选择（仅 chromium 分支有意义）。 */
  promptInstall: () => Promise<void>
  /** 永久关闭：写 localStorage 版本键 + 会话内立即生效。 */
  dismiss: () => void
}

/** localStorage 取样（异常环境回 null——持久化降级为会话内态，绝不抛错）。 */
function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function useInstallPrompt(): UseInstallPromptResult {
  // 平台/显示模式判定只读探针快照（device-store），本层零 UA/媒体查询。
  const standalone = useDeviceStore((state) => state.capabilities.standalone)
  const isIos = useDeviceStore((state) => state.capabilities.isIos)

  const [hasDeferredPrompt, setHasDeferredPrompt] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [phase, setPhase] = useState<InstallPromptPhase>('idle')
  // dismiss 初始化读一次 localStorage（版本键）；其后以会话内存态为准。
  const [dismissed, setDismissed] = useState<boolean>(() => readInstallDismissed(defaultStorage()))
  /** 在册的 deferred prompt（未消费；消费后置 null）。 */
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)

  // ── 事件捕获：beforeinstallprompt（抑制浏览器自带条 + 防重复在册）与
  //    appinstalled（真实安装落定，条随之退场）。挂载一次，卸载全拆。 ────
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event): void => {
      // 抑制 Chromium 自带 mini-infobar——安装条接管这条能力的呈现。
      event.preventDefault()
      // 防重复：已有未消费的 deferred prompt 在册，后续事件不顶替
      // （多重挂载/重放事件不产生第二份安装流）。
      if (deferredRef.current !== null) return
      deferredRef.current = event as BeforeInstallPromptEvent
      setHasDeferredPrompt(true)
    }
    const onInstalled = (): void => {
      deferredRef.current = null
      setHasDeferredPrompt(false)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<void> => {
    const event = deferredRef.current
    if (event === null || phase !== 'idle') return
    setPhase('pending')
    try {
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'accepted') {
        deferredRef.current = null
        setHasDeferredPrompt(false)
        setInstalled(true)
        setPhase('accepted')
      } else {
        // 浏览器对话框被取消：prompt 已消费（同事件不能再弹），在册撤销，
        // 分支保持 chromium 由 UI 呈现反馈行（不再渲染可点的安装钮）。
        deferredRef.current = null
        setPhase('dismissed')
      }
    } catch {
      // prompt() 失败（重复调用/浏览器拒绝）：能力实际不可用——撤销在册
      // prompt，分支重新裁决，不留永远失败的按钮。
      deferredRef.current = null
      setHasDeferredPrompt(false)
      setPhase('idle')
    }
  }, [phase])

  const dismiss = useCallback((): void => {
    writeInstallDismissed(defaultStorage())
    setDismissed(true)
  }, [])

  return {
    branch: resolveInstallPromptBranch({ standalone, installed, dismissed, hasDeferredPrompt, isIos }),
    phase,
    promptInstall,
    dismiss,
  }
}
