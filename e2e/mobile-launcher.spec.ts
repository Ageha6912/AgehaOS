import { expect, test, type Page } from '@playwright/test'

/**
 * M2-1 移动启动器 E2E（结构契约归 src/mobile/launcher/*.test 与
 * MobileAppGrid.test.tsx；真实视口 + 生产构建全链路落本文件）：
 * - 主链路（切片指定）：标题行搜索按钮打开 Bottom Sheet → 实时过滤
 *   （manifest.name 大小写不敏感）→ 点击列表行推进 nav（data-nav 反射 +
 *   M1-6 AppHost 真实启动：windowId 落地、窗口计数 1）；
 * - 关闭路径：backdrop 点击与 Esc 都收起抽屉（退场帧播完卸载）；
 * - desktop context 回归：桌面 Shell 无移动启动器入口。
 *
 * 设备档与 e2e/mobile-shell.spec.ts 同口径（360×800 + iPhone UA；判定不在
 * 测试里复算，只断言用户可见结果）。
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

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('打开 → 过滤 → 点击应用推进 nav：抽屉、过滤与真实启动全链路', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilelauncher')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    // ① 打开：标题行搜索按钮 → Bottom Sheet（dialog）+ 全量注册表 10 条。
    await page.getByTestId('mobile-launcher-open').click()
    const sheet = page.getByTestId('mobile-launcher-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    await expect(page.getByTestId('mobile-launcher-item')).toHaveCount(10)

    // ② 实时过滤：manifest.name 大小写不敏感（'FILES' 只余 Files 一行）。
    const search = page.getByTestId('mobile-launcher-search')
    await search.fill('FILES')
    const items = page.getByTestId('mobile-launcher-item')
    await expect(items).toHaveCount(1)
    await expect(items).toHaveAttribute('data-app-id', 'com.ageha.files')

    // ③ 点击应用推进 nav：M1-6 AppHost 真实启动（windowId 落地、窗口计数 1），
    //    抽屉随 Home 卸载退场。
    await items.click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.files')
    await expect(shell).toHaveAttribute('data-window-count', '1')
    const host = page.getByTestId('mobile-app-host')
    await expect(host).toHaveAttribute('data-state', 'open')
    await expect(host).not.toHaveAttribute('data-window-id', '')
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)
  })

  test('关闭路径：backdrop 点击与 Esc 都收起抽屉', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilelauncherclose')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    const openSheet = async (): Promise<void> => {
      await page.getByTestId('mobile-launcher-open').click()
      await expect(page.getByTestId('mobile-launcher-sheet')).toBeVisible()
    }

    // ① backdrop 点击（视口上部，sheet 之外）→ 退场帧播完卸载。
    await openSheet()
    await page.getByTestId('mobile-launcher-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0, { timeout: 3_000 })
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    // ② Esc → 同路收起，Home 仍在。
    await openSheet()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0, { timeout: 3_000 })
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无移动启动器入口', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilelauncherdesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    // 移动网格与其启动器入口都不在桌面渲染路径上。
    await expect(page.getByTestId('mobile-app-grid')).toHaveCount(0)
    await expect(page.getByTestId('mobile-launcher-open')).toHaveCount(0)
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)
  })
})
