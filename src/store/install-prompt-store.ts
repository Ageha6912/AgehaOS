import { create } from 'zustand'

import { readInstallDismissed, writeInstallDismissed } from '@/mobile/pwa/install-prompt-decision'

/**
 * PWA 安装提示的**常驻**能力采集与交互相位（M3-3，概念展板屏⑩）。
 *
 * 为什么是模块级 store 而不是组件内 hook state（F2 审查修复）：浏览器
 * `beforeinstallprompt` 每页通常只派发一次——登录/开机阶段可能已经触发，
 * 也可能在用户停留于应用视图时触发。事件采集若只存在于 MobileInstallBar
 * （只在 Home 的 MobileHome 内挂载），进任意应用再回 Home 时监听被拆、
 * deferred prompt 随 hook 实例销毁，安装条整轮会话不再出现。采集移到本
 * store（模块加载即挂载，覆盖登录前窗口 + Home 卸载期），安装条只做呈现。
 *
 * 相位机（与 hook 的公开 API 同源）：
 * - `idle`：chromium 分支有可消费的 deferred prompt；
 * - `pending`：prompt() 已调、等待 userChoice（按钮禁用防重复消费）；
 * - `accepted`：用户接受 → installed 落定，分支隐藏；
 * - `dismissed`：浏览器对话框取消 → prompt 已消费、UI 换反馈行；此后若
 *   浏览器再派发新 beforeinstallprompt（新一次安装机会），相位复位 `idle`
 *   并重新在册（原实现不复位，新事件永远没有可点安装钮）。
 *
 * 事件语义沿用原 hook：preventDefault 抑制 Chromium 自带 mini-infobar；
 * 首个未消费事件在册后，后续事件不顶替（防止重放/多重挂载产生第二份安
 * 装流）；prompt() 抛错（事件已消费/浏览器拒绝）视为能力不可用，撤销在册
 * 并隐藏分支，绝不留下永远失败的按钮；appinstalled 落定后同样隐藏。
 */
export interface BeforeInstallPromptEvent extends Event {
  /** 唤起浏览器安装流（每事件至多一次，重复调用抛错）。 */
  prompt: () => Promise<void>
  /** 用户在浏览器对话框的选择（prompt() 之后才落定）。 */
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** chromium 分支的交互相位（ios/hidden 分支不消费）。 */
export type InstallPromptPhase = 'idle' | 'pending' | 'accepted' | 'dismissed'

interface InstallPromptState {
  /** 至少捕获过一枚安装事件（分支裁决输入；对话框取消后保持 true）。 */
  hasPrompt: boolean
  /** 未消费的 deferred prompt（消费后置 null，等待下一次事件）。 */
  deferredPrompt: BeforeInstallPromptEvent | null
  /** 本会话内已安装（appinstalled 或用户接受）。 */
  installed: boolean
  /** 用户永久关闭安装条（localStorage 版本键 + 会话内立即生效）。 */
  dismissed: boolean
  phase: InstallPromptPhase
  promptInstall: () => Promise<void>
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

export const useInstallPromptStore = create<InstallPromptState>()((set, get) => ({
  hasPrompt: false,
  deferredPrompt: null,
  installed: false,
  dismissed: readInstallDismissed(defaultStorage()),
  phase: 'idle',
  promptInstall: async (): Promise<void> => {
    const { deferredPrompt, phase } = get()
    if (deferredPrompt === null || phase !== 'idle') return
    set({ phase: 'pending' })
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        set({ hasPrompt: false, deferredPrompt: null, installed: true, phase: 'accepted' })
      } else {
        // 浏览器对话框被取消：prompt 已消费（同事件不能再弹），在册撤销；
        // hasPrompt 保持 true —— 分支仍是 chromium，UI 换成结果反馈行。
        set({ deferredPrompt: null, phase: 'dismissed' })
      }
    } catch {
      // prompt() 失败（重复调用/浏览器拒绝）：能力实际不可用——撤销在册
      // prompt，分支重新裁决，不留永远失败的按钮。
      set({ hasPrompt: false, deferredPrompt: null, phase: 'idle' })
    }
  },
  dismiss: () => {
    writeInstallDismissed(defaultStorage())
    set({ dismissed: true })
  },
}))

let captureAttached = false

/**
 * 挂载全局安装事件采集（幂等；模块加载即调用，覆盖登录前与 Home 卸载期）。
 * 监听永不拆——store 生命周期 = 页面会话，比任何视图都长。
 */
export function ensureInstallPromptCapture(): void {
  if (captureAttached || typeof window === 'undefined') return
  captureAttached = true
  window.addEventListener('beforeinstallprompt', (event) => {
    // 抑制 Chromium 自带 mini-infobar——安装条接管这条能力的呈现。
    event.preventDefault()
    const state = useInstallPromptStore.getState()
    // 防重复：已有未消费的 deferred prompt 在册，后续事件不顶替。
    if (state.deferredPrompt !== null) return
    useInstallPromptStore.setState((prev) => ({
      hasPrompt: true,
      deferredPrompt: event as BeforeInstallPromptEvent,
      // 浏览器对话框取消后的新事件 = 新一次安装机会：相位复位 idle，
      // 安装钮重新可点；pending/accepted 等其它相位原样保留。
      phase: prev.phase === 'dismissed' ? 'idle' : prev.phase,
    }))
  })
  window.addEventListener('appinstalled', () => {
    useInstallPromptStore.setState({ hasPrompt: false, deferredPrompt: null, installed: true })
  })
}

// 模块加载即挂载（见 ensureInstallPromptCapture 文档；hook 消费方通常在
// 登录后才挂载，登录前派发的事件也必须接住）。
ensureInstallPromptCapture()

/** 测试隔离出口：回到「本页刚加载」的初始态（dismiss 记录仍从 storage 读）。 */
export function resetInstallPromptStore(): void {
  useInstallPromptStore.setState({
    hasPrompt: false,
    deferredPrompt: null,
    installed: false,
    phase: 'idle',
    dismissed: readInstallDismissed(defaultStorage()),
  })
}
