import { expect, test, type Page } from '@playwright/test'

/**
 * M3-3 PWA 安装提示 E2E（判定纯函数与 hook/UI 相位机归 src/mobile/pwa/
 * *.test.ts[x]；真实生产构建全链路落本文件）。e2e 环境无 service worker
 * 注册，Chromium 不会派发真实 beforeinstallprompt——按切片口径用
 * page.evaluate 派发 mock 事件（带 prompt/userChoice 桩），断言的是用户
 * 可见结果（安装条出现/退场 + prompt() 恰被调用一次），不在测试里复算
 * 判定逻辑。主链路：
 * - Android 档：默认无安装条（无能力不伪造）→ mock 事件 → 条出现
 *   （chromium 分支）→ 点安装 → prompt 恰一次 + 接受后整条退场；
 * - dismiss 记 localStorage 版本键：关闭 → 键写入 → 重载后 mock 事件再
 *   派发也不再打扰；
 * - iPhone 档（Safari 无该事件）：指引分支常驻（两步文案、无安装钮）；
 * - desktop 回归：桌面 Shell 无安装条（mock 事件派发了也不出——条只存在
 *   于 MobileShell 内）。
 */

const ANDROID_UA
  = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** dismiss 持久化版本键（与 install-prompt-decision.ts 同字面量）。 */
const DISMISS_KEY = 'agehaos.mobile.pwa.installDismissed.v1'

/** 注册新账号进入 Shell（本地认证模式，每个 context 独立 localStorage）。 */
async function registerAndReachShell(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
}

/**
 * 派发一枚 mock beforeinstallprompt（prompt 计数挂 window 供断言）。
 * userChoice 由 outcome 参数预落定（真实浏览器是 prompt() 之后的用户选择，
 * mock 里顺序等价：点击安装 → prompt 调用 → 选择回读）。
 */
async function dispatchMockInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed'): Promise<void> {
  await page.evaluate((resolved) => {
    const host = window as typeof window & { __installPromptCalls?: number }
    host.__installPromptCalls = 0
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
    }
    event.prompt = async () => {
      host.__installPromptCalls = (host.__installPromptCalls ?? 0) + 1
    }
    event.userChoice = Promise.resolve({ outcome: resolved })
    window.dispatchEvent(event)
  }, outcome)
}

test.describe('mobile context（360×800 Android UA，chromium 分支）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID_UA,
  })

  test('默认无条 → mock 事件出条 → 安装接受退场，prompt() 恰一次', async ({ page }) => {
    await registerAndReachShell(page, 'e2epwainstall')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-home')).toBeVisible()

    // ⓪ 默认（无 beforeinstallprompt、非 iOS）：整条缺席，无伪造能力。
    await expect(page.getByTestId('mobile-pwa-install')).toHaveCount(0)

    // ① mock 事件 → 安装条出现，chromium 分支在常。
    await dispatchMockInstallPrompt(page, 'accepted')
    const bar = page.getByTestId('mobile-pwa-install')
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute('data-branch', 'chromium')

    // ② 点安装：prompt() 恰一次；接受 → 整条退场（原生安装 UI 接管）。
    await page.getByTestId('mobile-pwa-install-action').click()
    await expect(bar).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => (window as typeof window & { __installPromptCalls?: number }).__installPromptCalls))
      .toBe(1)
  })

  test('浏览器对话框取消：安装钮换结果反馈行，条保持；dismiss 后键写入', async ({ page }) => {
    await registerAndReachShell(page, 'e2epwadismiss')
    await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })

    await dispatchMockInstallPrompt(page, 'dismissed')
    const bar = page.getByTestId('mobile-pwa-install')
    await expect(bar).toBeVisible()

    // 取消 → 安装钮退场（prompt 已消费，同事件不能再弹——死按钮禁令），
    // 结果反馈行在常，条不整体消失。
    await page.getByTestId('mobile-pwa-install-action').click()
    await expect(page.getByTestId('mobile-pwa-install-action')).toHaveCount(0)
    await expect(page.getByTestId('mobile-pwa-install-outcome')).toBeVisible()
    await expect(bar).toBeVisible()

    // 关闭钮仍可永久 dismiss：条退场 + 版本键写入。
    await page.getByTestId('mobile-pwa-install-dismiss').click()
    await expect(bar).toHaveCount(0)
    expect(await page.evaluate((key) => window.localStorage.getItem(key), DISMISS_KEY)).toBe('1')
  })

  test('dismiss 持久化跨重载：重载后 mock 事件再派发也不打扰', async ({ page }) => {
    await registerAndReachShell(page, 'e2epwadismissreload')
    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    await dispatchMockInstallPrompt(page, 'accepted')
    await expect(page.getByTestId('mobile-pwa-install')).toBeVisible()
    await page.getByTestId('mobile-pwa-install-dismiss').click()
    await expect(page.getByTestId('mobile-pwa-install')).toHaveCount(0)

    // 重载（会话经 localStorage 恢复回 Shell）→ 再派发 mock 事件 → 无条。
    await page.reload()
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await dispatchMockInstallPrompt(page, 'accepted')
    await expect(page.getByTestId('mobile-pwa-install')).toHaveCount(0)
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })
})

test.describe('mobile context（iPhone UA，iOS 指引分支）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('Safari 无 beforeinstallprompt：指引分支常驻（两步文案、无安装钮），可永久关闭', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2epwaios')
    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    const bar = page.getByTestId('mobile-pwa-install')
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute('data-branch', 'ios')
    // 指引即能力本身：两步文案 + 无安装钮（不摆假按钮）。
    await expect(page.getByTestId('mobile-pwa-install-ios-steps')).toContainText('分享')
    await expect(page.getByTestId('mobile-pwa-install-ios-steps')).toContainText('添加到主屏幕')
    await expect(page.getByTestId('mobile-pwa-install-action')).toHaveCount(0)

    // dismiss 后不再打扰（指引分支同享版本键持久化）。
    await page.getByTestId('mobile-pwa-install-dismiss').click()
    await expect(bar).toHaveCount(0)
    expect(await page.evaluate((key) => window.localStorage.getItem(key), DISMISS_KEY)).toBe('1')
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无安装条（mock 事件派发也不出——条只存在于 MobileShell 内）', async ({ page }) => {
    await registerAndReachShell(page, 'e2epwadesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)

    await dispatchMockInstallPrompt(page, 'accepted')
    await expect(page.getByTestId('mobile-pwa-install')).toHaveCount(0)
    expect(await page.evaluate((key) => window.localStorage.getItem(key), DISMISS_KEY)).toBeNull()
  })
})
