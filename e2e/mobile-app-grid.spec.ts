import { expect, test, type Page } from '@playwright/test'

/**
 * M1-4 移动应用网格（app-store 注册表全量 × 常量优先序，零新增状态）：
 * 新注册账号进入移动 Shell 后断言——
 *
 * - 渲染：全量注册表 boot = 7 内置 + 羽化 L1 三件套 = 10 格，断言 ≥7 格
 *   （切片口径）且前 7 格恰为 MOBILE_APP_ORDER 优先序（dynamic.panel →
 *   files → notes → settings → calculator → store → terminal），羽化 L1
 *   排后（数量 10 全量渲染，不分页）；
 * - 标题「全部应用」在场（i18n zh）；
 * - 触控纪律（DESIGN.md §35.3）：整格命中区 ≥44×44px；
 * - 点击：整格 openApp(appId) = mobile-nav-store 导航推进（过渡语义：
 *   M1-6 AppHost 之前不真实开窗），断言口 = MobileShell 根的
 *   data-nav-view / data-nav-app-id 反射（与 e2e/mobile-recent-apps.spec.ts
 *   同一口径）。
 *
 * 设备档与 e2e/mobile-shell.spec.ts / mobile-recent-apps.spec.ts 同口径
 * （360×800 + iPhone UA；判定不在测试里复算，只断言用户可见结果）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 常量优先序（与 src/mobile/shared/mobile-app-order.ts 同一字面量；此处钉 E2E 可见结果）。 */
const PRIORITY_ORDER = [
  'com.ageha.dynamic.panel',
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.settings',
  'com.ageha.calculator',
  'com.ageha.store',
  'com.ageha.terminal',
  'com.ageha.browser',
]

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  /** 注册新账号进入移动 Shell（本地认证模式，每个 context 独立 localStorage）。 */
  async function registerAndReachMobile(page: Page, username: string): Promise<void> {
    await page.goto('/')
    const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
    await expect(loginForm).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '没有账户？创建一个' }).click()
    await page.getByLabel('用户名').fill(username)
    await page.getByLabel('密码').fill('secret123')
    await page.getByRole('button', { name: '注册' }).click()
    await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
  }

  test('应用网格：≥8 格、前 8 格优先序、羽化 L1 排后、命中区 ≥44px', async ({ page }) => {
    await registerAndReachMobile(page, 'e2emobileappgrid')

    const grid = page.getByTestId('mobile-app-grid')
    await expect(grid).toBeVisible()
    await expect(grid.getByRole('heading', { level: 2 })).toHaveText('全部应用')

    // 全量渲染：boot 注册表 = 8 内置（含浏览器）+ 羽化 L1 三件套 = 11 格。
    const tiles = grid.getByTestId('mobile-app-tile')
    await expect(tiles).toHaveCount(11)

    // 前 8 格 = 常量优先序（注册表 boot 序无关，网格排序生效）。
    for (const [index, appId] of PRIORITY_ORDER.entries()) {
      await expect(tiles.nth(index)).toHaveAttribute('data-app-id', appId)
    }
    // 未列入组排后：羽化 L1 三件套收尾（按 zh 展示名码元序 时→计→记）。
    await expect(tiles.nth(8)).toHaveAttribute('data-app-id', 'com.ageha.eclosion.clock')
    await expect(tiles.nth(9)).toHaveAttribute('data-app-id', 'com.ageha.eclosion.calculator')
    await expect(tiles.nth(10)).toHaveAttribute('data-app-id', 'com.ageha.eclosion.notes')

    // 触控纪律（DESIGN.md §35.3）：整格命中区 ≥44×44px。
    const box = (await tiles.nth(0).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  })

  test('整格点击 = openApp 导航推进（过渡语义：data-nav 反射）', async ({ page }) => {
    await registerAndReachMobile(page, 'e2emobileappgridclick')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    const grid = page.getByTestId('mobile-app-grid')
    const tiles = grid.getByTestId('mobile-app-tile')
    // 首格 = 常量优先序第一位（动态面板，与今日世界卡落点同 appId）。
    await tiles.nth(0).click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.dynamic.panel')
  })
})
