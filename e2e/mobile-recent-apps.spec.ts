import { expect, test, type Page } from '@playwright/test'

/**
 * M1-3 移动最近使用区（usage-store 单一来源 × getAppManifest 解析，零新增
 * 状态）：预置数据走 addInitScript 写 `agehaos.usage.recent.v1`（usage-store
 * 模块初始化时 loadPersisted 读取，早于应用脚本），断言——
 *
 * - 渲染：前 4 截取（第 5 条起不渲染）、坏条目（解析不到的 appId）跳过且
 *   不回填、标题「最近使用」在场、整格命中区 ≥44×44px（DESIGN.md §35.3）；
 * - 点击：整格 openApp(appId) = mobile-nav-store 导航推进（过渡语义：
 *   M1-6 AppHost 之前不真实开窗），断言口 = MobileShell 根的
 *   data-nav-view / data-nav-app-id 反射（与 e2e/mobile-today-world.spec.ts
 *   同一口径）；
 * - 空态：recent 为空 → 整块（含标题）缺席（禁止空壳）。
 *
 * 设备档与 e2e/mobile-shell.spec.ts / mobile-today-world.spec.ts 同口径
 * （360×800 + iPhone UA；判定不在测试里复算，只断言用户可见结果）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

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

  test('预置 recent：前 4 截取 + 坏条目跳过 + 整格点击推进 nav', async ({ page }) => {
    // 5 条预置（最新在前）：第 2 条是解析不到的坏 appId，第 5 条应被截掉
    // 且不因坏条目回填——期望渲染 = 注入序的 1/3/4 条（Notes / Files /
    // Calculator，均为 boot 注册的内建 manifest）。
    const now = Date.now()
    await page.addInitScript((entries) => {
      window.localStorage.setItem('agehaos.usage.recent.v1', JSON.stringify(entries))
    }, [
      { appId: 'com.ageha.notes', at: now },
      { appId: 'com.ageha.uninstalled.app', at: now - 1 },
      { appId: 'com.ageha.files', at: now - 2 },
      { appId: 'com.ageha.calculator', at: now - 3 },
      { appId: 'com.ageha.terminal', at: now - 4 },
    ])
    await registerAndReachMobile(page, 'e2emobilerecents')

    // 区块在场：标题「最近使用」+ 恰好 3 格（前 4 截取 ∩ 坏条目跳过）。
    const section = page.getByTestId('mobile-recent-apps')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('最近使用')
    const tiles = section.getByTestId('mobile-recent-app')
    await expect(tiles).toHaveCount(3)
    await expect(tiles.nth(0)).toHaveAttribute('data-app-id', 'com.ageha.notes')
    await expect(tiles.nth(1)).toHaveAttribute('data-app-id', 'com.ageha.files')
    await expect(tiles.nth(2)).toHaveAttribute('data-app-id', 'com.ageha.calculator')
    // 坏条目与被截掉的第 5 条都不渲染（文本名同源内建 manifest）。
    await expect(section).toContainText('Notes')
    await expect(section).toContainText('Files')
    await expect(section).toContainText('Calculator')
    await expect(section).not.toContainText('Terminal')

    // 触控纪律（DESIGN.md §35.3）：整格命中区 ≥44×44px。
    const box = (await tiles.nth(0).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)

    // 整格点击 = 导航推进（过渡语义）：根元素反射 app + 注入的注册 appId。
    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await tiles.nth(0).click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.notes')
  })

  test('recent 为空：整块（含标题）缺席（禁止空壳）', async ({ page }) => {
    await registerAndReachMobile(page, 'e2emobilerecentsempty')

    await expect(page.getByTestId('mobile-recent-apps')).toHaveCount(0)
    await expect(page.getByTestId('mobile-recent-app')).toHaveCount(0)
    // Home 其余区块照常（区块缺席即状态，不拖垮 Home）。
    await expect(page.getByTestId('mobile-home-greeting')).toBeVisible()
  })
})
