import { expect, test, type Page } from '@playwright/test'

/**
 * M2-3 移动控制中心 E2E（结构契约归 src/mobile/controlcenter/*.test.tsx 与
 * MobileStatusBar.test.tsx；真实视口 + 生产构建全链路落本文件）：
 *
 * - 切主题：点「深色」chip → documentElement 的 dark 类实时出现（settings
 *   store 既有 applyTheme 消费机制，双 Shell 同源）；点「浅色」实时消失，
 *   chip 选中态 aria-pressed 跟随。
 * - 切语言：点 English chip → 状态栏文案（可访问名：通知铃铛 / 控制中心
 *   入口）即时切英文——词典切换驱动全部 useTranslation 消费方重渲染；面板
 *   自身标题/分区标签同一断言口。（状态栏常显读数——时钟/电量/用户名——
 *   是 API 原始数据不走词典，可访问名是其中 i18n 文案位。）
 * - 登出：点「退出登录」→ 无二次确认（与桌面 UserMenu 行为对齐），App.tsx
 *   的 phase 分支自然回登录界面。
 * - desktop context 回归：桌面 Shell 无移动控制中心入口（桌面 UserMenu/
 *   Settings 零接触，契约不变）。
 *
 * 设备档与 e2e/mobile-notifications.spec.ts 同口径（360×800 + iPhone UA；
 * 判定不在测试里复算，只断言用户可见结果）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

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

/** 等待移动 Shell 在场（注册后的 boot→ready 异步链）。 */
async function awaitMobileShell(page: Page): Promise<void> {
  await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
}

/** 点状态栏调节图标开控制中心 sheet。 */
async function openControlCenter(page: Page): Promise<void> {
  const entry = page.getByTestId('mobile-control-center-entry')
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByTestId('mobile-control-center-sheet')).toBeVisible()
}

/** 按 data-value 定位某组里的一个选项 chip。 */
function optionByValue(page: Page, testId: string, value: string) {
  return page.locator(`[data-testid="${testId}"][data-value="${value}"]`)
}

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('切主题：html.dark 类实时跟随（浅→深→浅），chip 选中态跟随', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilectrl')
    await awaitMobileShell(page)

    // 出厂浅色（§32 参考图明亮基线）：dark 类不在场。
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)

    await openControlCenter(page)
    await expect(optionByValue(page, 'mobile-control-theme-option', 'light')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // 浅→深：dark 类实时出现（settings-store.setTheme → applyTheme）。
    await optionByValue(page, 'mobile-control-theme-option', 'dark').click()
    await expect(html).toHaveClass(/dark/)
    await expect(optionByValue(page, 'mobile-control-theme-option', 'dark')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(optionByValue(page, 'mobile-control-theme-option', 'light')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // 深→浅：dark 类实时退场。
    await optionByValue(page, 'mobile-control-theme-option', 'light').click()
    await expect(html).not.toHaveClass(/dark/)

    // backdrop 关闭：sheet 播完退场帧卸载，Home 照常。
    await page.getByTestId('mobile-control-center-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('mobile-control-center')).toHaveCount(0, { timeout: 3_000 })
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })

  test('切语言：状态栏可访问名与面板文案即时切英文，切回中文恢复', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilectrllang')
    await awaitMobileShell(page)

    // 基线：状态栏 i18n 文案位（可访问名）为中文。
    const bell = page.getByTestId('mobile-notification-bell')
    const entry = page.getByTestId('mobile-control-center-entry')
    await expect(bell).toHaveAttribute('aria-label', '通知中心')

    await openControlCenter(page)
    await expect(page.getByTestId('mobile-control-center-sheet')).toHaveAttribute(
      'aria-label',
      '控制中心',
    )

    // zh-CN → en：状态栏可访问名即时切英文（statusbar 文案变化断言口），
    // 面板自身同步（同一 useTranslation 机制）。
    await optionByValue(page, 'mobile-control-locale-option', 'en').click()
    await expect(bell).toHaveAttribute('aria-label', 'Notification center')
    await expect(entry).toHaveAttribute('aria-label', 'Control center')
    await expect(page.getByTestId('mobile-control-center-sheet')).toHaveAttribute(
      'aria-label',
      'Control center',
    )
    await expect(
      page.getByTestId('mobile-control-center-sheet').getByText('Theme', { exact: true }),
    ).toBeVisible()

    // 切回简体中文：全部恢复。
    await optionByValue(page, 'mobile-control-locale-option', 'zh-CN').click()
    await expect(bell).toHaveAttribute('aria-label', '通知中心')
    await expect(entry).toHaveAttribute('aria-label', '控制中心')
  })

  test('减弱动效：开关翻转 sheet 直切档（windowTilt 既有消费位）', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilectrlmotion')
    await awaitMobileShell(page)

    await openControlCenter(page)
    const motion = page.getByTestId('mobile-control-motion-switch')
    await expect(motion).toHaveAttribute('aria-checked', 'false')

    // 开「减弱动效」：windowTilt=false → 本 sheet 当场直切（所见即所得）。
    await motion.click()
    await expect(motion).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('mobile-control-center')).toHaveClass(/mobile-controlcenter-static/)

    // 关回：恢复转场档。
    await motion.click()
    await expect(motion).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('mobile-control-center')).not.toHaveClass(
      /mobile-controlcenter-static/,
    )
  })

  test('登出：无二次确认直接回登录界面（与桌面 UserMenu 行为对齐）', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilectrlout')
    await awaitMobileShell(page)

    await openControlCenter(page)
    await page.getByTestId('mobile-control-logout').click()

    // App.tsx phase 分支（ready + anonymous → login）：登录表单重新在场，
    // 移动 Shell 连同控制中心一起卸载。
    const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
    await expect(loginForm).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
    await expect(page.getByTestId('mobile-control-center')).toHaveCount(0)
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无移动控制中心入口（桌面 UserMenu/Settings 零接触）', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilectrldesk')

    await expect(page.locator('[data-shell="desktop"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-control-center-entry')).toHaveCount(0)
    await expect(page.getByTestId('mobile-control-center')).toHaveCount(0)
  })
})
