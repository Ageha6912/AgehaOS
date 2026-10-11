import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BeforeInstallPromptEvent } from './use-install-prompt'
import { useInstallPrompt } from './use-install-prompt'
import { INSTALL_DISMISS_STORAGE_KEY } from './install-prompt-decision'

import { resetDeviceStore } from '@/store/device-store'

/**
 * useInstallPrompt 契约（M3-3）：beforeinstallprompt 捕获（preventDefault
 * 抑制浏览器条 + 防重复在册）、standalone / isIos 只读 device-store 能力位
 * 的分支门控、dismiss 的 localStorage 版本键持久化、prompt() 交互相位机
 * （pending → accepted 退场 / dismissed 反馈行 / 抛错撤下）。判定纯函数归
 * install-prompt-decision.test.ts，UI 呈现归 MobileInstallBar.test.tsx。
 *
 * device-store 快照用全局桩 + resetDeviceStore 重测喂入（device-store.test.ts
 * 同口径）：jsdom 无 beforeinstallprompt/appinstalled 语义，事件用
 * `new Event(...)` 挂 prompt/userChoice 桩派发。
 */

const ANDROID_UA
  = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

interface ProbeOptions {
  ua?: string
  maxTouchPoints?: number
  displayStandalone?: boolean
  iosNavigatorStandalone?: boolean
}

/** device-store 输入桩：只喂 hook 消费的位（UA / standalone 两路）。 */
function stubProbe(options: ProbeOptions = {}): void {
  const nav: Record<string, unknown> = {
    userAgent: options.ua ?? ANDROID_UA,
    maxTouchPoints: options.maxTouchPoints ?? 5,
  }
  if (options.iosNavigatorStandalone !== undefined) nav.standalone = options.iosNavigatorStandalone
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('innerWidth', 360)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(display-mode: standalone)'
        ? (options.displayStandalone ?? false)
        : query === '(pointer: coarse)' || query === '(hover: hover)'
          ? query === '(pointer: coarse)'
          : false,
  }))
}

/** 派发一枚带 prompt/userChoice 桩的 beforeinstallprompt。 */
function dispatchInstallPrompt(options: {
  prompt?: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
} = {}): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  event.prompt = options.prompt ?? (async () => undefined)
  ;(event as { userChoice?: unknown }).userChoice
    = options.userChoice ?? Promise.resolve({ outcome: 'accepted' })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

/** 可手动落定的 deferred 桩（相位机测试用）。resolve 句柄经容器透出——
 *  Promise executor 在 prompt()/首个 await 时才执行，直接解构会拿到赋值前
 *  的 undefined 快照。 */
function deferredChoice(): {
  event: BeforeInstallPromptEvent
  controls: {
    resolvePrompt: () => void
    resolveChoice: (value: { outcome: 'accepted' | 'dismissed' }) => void
  }
} {
  const controls: {
    resolvePrompt: () => void
    resolveChoice: (value: { outcome: 'accepted' | 'dismissed' }) => void
  } = {
    resolvePrompt: () => undefined,
    resolveChoice: () => undefined,
  }
  const prompt = vi.fn(async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      controls.resolvePrompt = resolve
    })
  })
  const userChoice = new Promise<{ outcome: 'accepted' | 'dismissed' }>((resolve) => {
    controls.resolveChoice = resolve
  })
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  event.prompt = prompt
  ;(event as { userChoice?: unknown }).userChoice = userChoice
  return { event, controls }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDeviceStore()
})

/** 先桩后重测再挂 hook（device-store 的初始快照来自模块加载时的环境）。 */
function setup(options: ProbeOptions = {}) {
  stubProbe(options)
  resetDeviceStore()
  return renderHook(() => useInstallPrompt())
}

describe('beforeinstallprompt 事件捕获', () => {
  it('无事件（Android/桌面 Chromium 未放行安装流）→ hidden：无能力不伪造', () => {
    const { result } = setup()
    expect(result.current.branch).toBe('hidden')
  })

  it('捕获事件 → chromium 分支；preventDefault 已抑制浏览器自带 mini-infobar', () => {
    const { result } = setup()
    const event = dispatchInstallPrompt()
    expect(result.current.branch).toBe('chromium')
    expect(event.defaultPrevented).toBe(true)
  })

  it('防重复：后续事件不顶替在册 prompt（消费的始终是第一枚）', () => {
    const { result } = setup()
    const firstPrompt = vi.fn(async () => undefined)
    const secondPrompt = vi.fn(async () => undefined)
    dispatchInstallPrompt({ prompt: firstPrompt })
    dispatchInstallPrompt({ prompt: secondPrompt })

    act(() => {
      void result.current.promptInstall()
    })
    expect(firstPrompt).toHaveBeenCalledTimes(1)
    expect(secondPrompt).not.toHaveBeenCalled()
  })

  it('appinstalled → 本会话安装落定，分支隐藏（即便事件曾在册）', () => {
    const { result } = setup()
    dispatchInstallPrompt()
    expect(result.current.branch).toBe('chromium')

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current.branch).toBe('hidden')
  })
})

describe('standalone 检测（已安装形态不出任何提示）', () => {
  it('display-mode: standalone → 事件在场也 hidden', () => {
    const { result } = setup({ displayStandalone: true })
    dispatchInstallPrompt()
    expect(result.current.branch).toBe('hidden')
  })

  it('iOS navigator.standalone（主屏 Web App）→ hidden（standalone 与 isIos 同真，standalone 优先）', () => {
    const { result } = setup({ ua: IPHONE_UA, iosNavigatorStandalone: true })
    dispatchInstallPrompt()
    expect(result.current.branch).toBe('hidden')
  })
})

describe('iOS 指引分支（Safari 无 beforeinstallprompt）', () => {
  it('iPhone UA + 非 standalone + 无事件 → ios 分支', () => {
    const { result } = setup({ ua: IPHONE_UA })
    expect(result.current.branch).toBe('ios')
  })

  it('Android UA 无事件 → 仍 hidden（不是 iOS，也不伪造指引）', () => {
    const { result } = setup()
    expect(result.current.branch).toBe('hidden')
  })
})

describe('dismiss 持久化（localStorage 版本键）', () => {
  it('dismiss → 会话内立即隐藏 + 版本键写入 1', () => {
    const { result } = setup()
    dispatchInstallPrompt()
    expect(result.current.branch).toBe('chromium')

    act(() => {
      result.current.dismiss()
    })
    expect(result.current.branch).toBe('hidden')
    expect(localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)).toBe('1')
  })

  it('持久化生效：新 hook 实例（模拟重进）读版本键，事件再派发也不出条', () => {
    const first = setup()
    dispatchInstallPrompt()
    act(() => {
      first.result.current.dismiss()
    })

    // 第二个实例：全新 hook 状态，localStorage 仍在（同 context）。
    const second = setup()
    dispatchInstallPrompt()
    expect(second.result.current.branch).toBe('hidden')
  })

  it('iOS 分支 dismiss 后同样永久静默', () => {
    const { result } = setup({ ua: IPHONE_UA })
    expect(result.current.branch).toBe('ios')
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.branch).toBe('hidden')
    expect(localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)).toBe('1')
  })
})

describe('prompt() 交互相位机', () => {
  it('点击 → pending（等待 userChoice）→ accepted → installed 落定，分支隐藏', async () => {
    const { result } = setup()
    const { event, controls } = deferredChoice()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(result.current.branch).toBe('chromium')

    let installPromise: Promise<void> | null = null
    act(() => {
      installPromise = result.current.promptInstall()
    })
    expect(result.current.phase).toBe('pending')

    await act(async () => {
      controls.resolvePrompt()
      controls.resolveChoice({ outcome: 'accepted' })
      await installPromise
    })
    await waitFor(() => expect(result.current.phase).toBe('accepted'))
    expect(result.current.branch).toBe('hidden')
  })

  it('浏览器对话框取消 → dismissed：分支保持 chromium（UI 呈现反馈行），prompt 已消费', async () => {
    const { result } = setup()
    const { event, controls } = deferredChoice()
    act(() => {
      window.dispatchEvent(event)
    })

    let installPromise: Promise<void> | null = null
    act(() => {
      installPromise = result.current.promptInstall()
    })
    await act(async () => {
      controls.resolvePrompt()
      controls.resolveChoice({ outcome: 'dismissed' })
      await installPromise
    })
    expect(result.current.phase).toBe('dismissed')
    // 分支保持 chromium：条不整体消失，交互归 UI 层换反馈行（无死按钮）。
    expect(result.current.branch).toBe('chromium')

    // pending 期间 / 事件消费后重复调用安全（prompt 不会被二次触发）。
    act(() => {
      void result.current.promptInstall()
    })
    expect(event.prompt).toHaveBeenCalledTimes(1)
  })

  it('prompt() 抛错（重复消费/浏览器拒绝）→ 撤销在册 prompt，分支隐藏（不留必败按钮）', async () => {
    const { result } = setup()
    const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
    event.prompt = vi.fn(async (): Promise<void> => {
      throw new Error('prompt already consumed')
    })
    ;(event as { userChoice?: unknown }).userChoice = Promise.resolve({ outcome: 'accepted' })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(result.current.branch).toBe('chromium')

    await act(async () => {
      await result.current.promptInstall()
    })
    expect(result.current.branch).toBe('hidden')
  })

  it('idle 之外（事件未在册）调用 promptInstall 是安全空操作', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.promptInstall()
    })
    expect(result.current.phase).toBe('idle')
    expect(result.current.branch).toBe('hidden')
  })
})
