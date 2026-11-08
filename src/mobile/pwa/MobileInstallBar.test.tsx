import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileInstallBar } from './MobileInstallBar'
import { INSTALL_DISMISS_STORAGE_KEY } from './install-prompt-decision'

import { useLocaleStore } from '@/core/i18n'
import { resetDeviceStore } from '@/store/device-store'
import { resetInstallPromptStore } from '@/store/install-prompt-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'

/**
 * MobileInstallBar 呈现契约（M3-3）：hidden 整条缺席（缺席即状态）、
 * chromium 分支的安装钮与取消后的结果反馈行（无死按钮）、iOS 分支的两步
 * 指引（无假安装钮）、dismiss 持久化、文案走 i18n（默认 zh-CN 词典）。
 * 分支裁决与事件采集的语义归 use-install-prompt.test.tsx /
 * install-prompt-decision.test.ts；真实浏览器全链路归
 * e2e/mobile-pwa-install.spec.ts。
 *
 * device-store 输入桩与 hook 测试同口径：全局桩 + resetDeviceStore 重测。
 */

const ANDROID_UA
  = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

interface ProbeOptions {
  ua?: string
  displayStandalone?: boolean
}

function stubProbe(options: ProbeOptions = {}): void {
  vi.stubGlobal('navigator', { userAgent: options.ua ?? ANDROID_UA, maxTouchPoints: 5 })
  vi.stubGlobal('innerWidth', 360)
  vi.stubGlobal('innerHeight', 800)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(display-mode: standalone)'
        ? (options.displayStandalone ?? false)
        : query === '(pointer: coarse)',
  }))
}

function setup(options: ProbeOptions = {}): void {
  stubProbe(options)
  resetDeviceStore()
}

/** 派发一枚 prompt/userChoice 全桩的 beforeinstallprompt。 */
function dispatchInstallPrompt(userChoice: 'accepted' | 'dismissed' = 'accepted'): void {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn(async () => undefined)
  event.userChoice = Promise.resolve({ outcome: userChoice })
  act(() => {
    window.dispatchEvent(event)
  })
}

beforeEach(() => {
  localStorage.clear()
  resetInstallPromptStore()
  resetSettingsStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetDeviceStore()
  // locale 是全局 i18n store（en 词典用例会切到 en），显式复位避免串测。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileInstallBar', () => {
  it('hidden（无事件、非 iOS）→ 整条缺席（缺席即状态，禁止空壳）', () => {
    setup()
    render(<MobileInstallBar />)
    expect(screen.queryByTestId('mobile-pwa-install')).toBeNull()
  })

  it('chromium 分支：事件捕获 → 条在场，标题/描述/安装钮与关闭钮齐备（zh 词典）', () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt()

    const bar = screen.getByTestId('mobile-pwa-install')
    expect(bar).toHaveAttribute('data-branch', 'chromium')
    expect(screen.getByText('安装 AgehaOS')).toBeInTheDocument()
    expect(screen.getByText('添加到主屏幕，以独立全屏应用打开。')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-pwa-install-action')).toHaveTextContent('安装')
    expect(screen.getByTestId('mobile-pwa-install-dismiss')).toHaveAttribute(
      'aria-label',
      '关闭，不再提示',
    )
  })

  it('安装接受：点击安装 → 原生流接管，整条退场', async () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt('accepted')

    fireEvent.click(screen.getByTestId('mobile-pwa-install-action'))
    await waitFor(() => expect(screen.queryByTestId('mobile-pwa-install')).toBeNull())
  })

  it('浏览器对话框取消：安装钮换成结果反馈行（prompt 已消费，不留死按钮），条不消失', async () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt('dismissed')

    fireEvent.click(screen.getByTestId('mobile-pwa-install-action'))
    await waitFor(() => expect(screen.queryByTestId('mobile-pwa-install-action')).toBeNull())
    expect(screen.getByTestId('mobile-pwa-install-outcome')).toHaveTextContent('已在浏览器中取消安装')
    expect(screen.getByTestId('mobile-pwa-install')).toBeInTheDocument()
    // 关闭钮仍可永久 dismiss。
    fireEvent.click(screen.getByTestId('mobile-pwa-install-dismiss'))
    expect(screen.queryByTestId('mobile-pwa-install')).toBeNull()
  })

  it('dismiss 持久化：点击关闭 → 条退场 + localStorage 版本键', () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt()

    fireEvent.click(screen.getByTestId('mobile-pwa-install-dismiss'))
    expect(screen.queryByTestId('mobile-pwa-install')).toBeNull()
    expect(localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)).toBe('1')
  })

  it('iOS 分支：两步指引在场（分享 → 添加到主屏幕），无安装钮（不伪造能力）', () => {
    setup({ ua: IPHONE_UA })
    render(<MobileInstallBar />)

    const bar = screen.getByTestId('mobile-pwa-install')
    expect(bar).toHaveAttribute('data-branch', 'ios')
    expect(screen.getByTestId('mobile-pwa-install-ios-steps')).toHaveTextContent('「分享」按钮')
    expect(screen.getByTestId('mobile-pwa-install-ios-steps')).toHaveTextContent('添加到主屏幕')
    expect(screen.queryByTestId('mobile-pwa-install-action')).toBeNull()
  })

  it('standalone（display-mode 命中）→ 事件在场也整条缺席', () => {
    setup({ displayStandalone: true })
    render(<MobileInstallBar />)
    dispatchInstallPrompt()
    expect(screen.queryByTestId('mobile-pwa-install')).toBeNull()
  })

  it('en 词典：locale 切换后文案同步（zh/en 双词典键位对齐的呈现侧抽查）', () => {
    setup({ ua: IPHONE_UA })
    // 语言走 settings-store（与桌面 Settings/控制中心同一入口）的 setLocale
    // ——core i18n localeStore 切换后 useTranslation 消费方重渲染。
    act(() => {
      useSettingsStore.getState().setLocale('en')
    })
    render(<MobileInstallBar />)
    expect(screen.getByText('Add AgehaOS to your Home Screen')).toBeInTheDocument()
    expect(screen.getByText('1. Tap the Share button in the toolbar at the bottom of the screen')).toBeInTheDocument()
  })

  it('进应用再回 Home（安装条卸载重挂）：deferred prompt 仍在，条继续在场', () => {
    setup()
    const first = render(<MobileInstallBar />)
    dispatchInstallPrompt()
    expect(screen.getByTestId('mobile-pwa-install')).toHaveAttribute('data-branch', 'chromium')

    // Home 卸载（进应用视图）再挂载：采集归常驻 store，deferred prompt 不丢。
    first.unmount()
    render(<MobileInstallBar />)
    expect(screen.getByTestId('mobile-pwa-install')).toHaveAttribute('data-branch', 'chromium')
    expect(screen.getByTestId('mobile-pwa-install-action')).toHaveTextContent('安装')
  })

  it('对话框取消后新事件：反馈行退回安装钮（新一次安装机会可点）', async () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt('dismissed')

    fireEvent.click(screen.getByTestId('mobile-pwa-install-action'))
    await waitFor(() => expect(screen.queryByTestId('mobile-pwa-install-action')).toBeNull())
    expect(screen.getByTestId('mobile-pwa-install-outcome')).toBeInTheDocument()

    // 新一次 beforeinstallprompt：相位复位 idle，安装钮重新出现。
    dispatchInstallPrompt('accepted')
    expect(screen.queryByTestId('mobile-pwa-install-outcome')).toBeNull()
    expect(screen.getByTestId('mobile-pwa-install-action')).toHaveAttribute('data-state', 'idle')
  })
})

describe('结果行读屏可及（F2 审查）', () => {
  it('取消后的结果行带 role=status + aria-live（F2 审查：读屏可及）', async () => {
    setup()
    render(<MobileInstallBar />)
    dispatchInstallPrompt('dismissed')
    fireEvent.click(screen.getByTestId('mobile-pwa-install-action'))
    const outcome = await screen.findByTestId('mobile-pwa-install-outcome')
    expect(outcome).toHaveAttribute('role', 'status')
    expect(outcome).toHaveAttribute('aria-live', 'polite')
  })
})
