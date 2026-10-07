import { expect, test, type Page } from '@playwright/test'

/**
 * M0-2 Shell Selection：ready 分支按 device-store 的 shell 单点切换——
 * 移动 context（手机/平板口径，M0-1 探针 + 2026-10-07 裁决）渲染
 * MobileShell（根元素 data-shell="mobile"），桌面 context 渲染 Desktop
 * （根元素 data-shell="desktop" 且 Taskbar 可见，桌面渲染路径不变）。
 * 判定不在测试里复算（innerWidth/UA 判断集中在 core/platform 探针——架构
 * 铁律），只断言用户可见的 Shell 选择结果。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 注册新账号进入桌面（本地认证模式，每个 context 独立 localStorage）。 */
async function registerAndReachDesktop(page: Page, username: string): Promise<void> {
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

  test('ready 分支渲染 MobileShell：data-shell="mobile" + 品牌字，无桌面 chrome', async ({
    page,
  }) => {
    await registerAndReachDesktop(page, 'e2emobile')

    const mobileShell = page.locator('[data-shell="mobile"]')
    await expect(mobileShell).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-shell-brand')).toHaveText('AgehaOS')

    // 桌面 Shell 不渲染：Taskbar（contentinfo 地标）与桌面根标记均缺席。
    await expect(page.locator('[data-shell="desktop"]')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
  })

  test('移动根声明 safe-area 基础设施：--safe-top 经 getComputedStyle 可读（M0-3）', async ({
    page,
  }) => {
    await registerAndReachDesktop(page, 'e2emobilesafe')

    const mobileShell = page.locator('[data-shell="mobile"]')
    await expect(mobileShell).toBeVisible({ timeout: 15_000 })

    // .mobile-shell 根类声明 --safe-*（env(safe-area-inset-*)）：计算样式
    // 读出自定义属性令牌流非空（无刘海视口下值回退 0px，但声明本身存在）。
    const safeTop = await mobileShell.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--safe-top'),
    )
    expect(safeTop.trim(), '--safe-top declared on the mobile root').not.toBe('')

    // 三段骨架占位（状态栏/内容/Dock）已就位，内容归 M1。
    for (const testId of ['mobile-statusbar-slot', 'mobile-content-slot', 'mobile-dock-slot']) {
      await expect(page.getByTestId(testId)).toHaveCount(1)
    }
  })
})

test.describe('desktop context（1920×1080）', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('ready 分支渲染 Desktop：data-shell="desktop" 且 Taskbar 可见', async ({ page }) => {
    await registerAndReachDesktop(page, 'e2edesktop')

    const desktopShell = page.locator('[data-shell="desktop"]')
    await expect(desktopShell).toBeVisible({ timeout: 15_000 })

    // 桌面渲染路径行为等价：Taskbar 照常可见（revealTaskbar 兼带等开机
    // 覆盖层退场），移动根标记缺席。
    await expect(page.getByRole('contentinfo')).toBeVisible()
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)

    // safe-area 变量仅移动作用域（M0-3）：桌面根上 --safe-top 未声明（空串）。
    const safeTop = await desktopShell.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--safe-top'),
    )
    expect(safeTop.trim(), 'desktop root must not declare --safe-top').toBe('')
  })
})
