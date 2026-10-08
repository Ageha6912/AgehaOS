import { expect, test, type Page } from '@playwright/test'

/**
 * M1-5 移动 Dock E2E（结构契约归 src/mobile/dock/MobileDock.test.tsx 与
 * MobileShell.test.tsx；几何语义 jsdom 算不了，落本文件）：
 * - 动作分发：点 Files 位推进 nav（data-nav-view / data-nav-app-id 反射，
 *   M1-6 AppHost 前过渡语义 = mobile-nav-store 纯状态机推进），点 Home 位
 *   复位回 home；
 * - safe-area 不被遮挡：Dock 本体完整坐在 `mobile-dock-slot` 安全区预留带
 *   上方——基线（模拟器无刘海，env 零回退 12px 保底）与 CDP
 *   `Emulation.setSafeAreaInsetsOverride` 注入 iPhone 15 Pro 档 inset
 *   （top 59 / bottom 34 / 左右 47）各跑一轮：带随 env 长高后 Dock 底边
 *   仍不越过带顶边，内容区不被 Dock 覆盖，无横向溢出。
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

/** 一次 evaluate 收齐 Dock 几何探针所需的全部读数（DOMRect 先摊平）。 */
interface DockGeometry {
  innerWidth: number
  innerHeight: number
  scrollWidth: number
  contentBottom: number
  dockTop: number
  dockBottom: number
  dockHeight: number
  bandTop: number
  bandBottom: number
  bandHeight: number
}

async function readDockGeometry(page: Page): Promise<DockGeometry> {
  return page.evaluate(() => {
    const box = (testId: string): DOMRect => {
      const el = document.querySelector(`[data-testid="${testId}"]`)
      if (!el) throw new Error(`missing [data-testid="${testId}"]`)
      return el.getBoundingClientRect()
    }
    const dock = box('mobile-dock')
    const band = box('mobile-dock-slot')
    const content = box('mobile-content-slot')
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.scrollingElement?.scrollWidth
        ?? document.documentElement.scrollWidth,
      contentBottom: content.bottom,
      dockTop: dock.top,
      dockBottom: dock.bottom,
      dockHeight: dock.height,
      bandTop: band.top,
      bandBottom: band.bottom,
      bandHeight: band.height,
    }
  })
}

/**
 * 断言 Dock 与安全区的几何关系：Dock 本体坐在预留带上方（safe-area 不被
 * 遮挡）、内容区不被 Dock 覆盖、无横向溢出、预留带 max() 保底成立。
 * bandMin = 该档预留带高度下限（基线 env 零回退 12px / 注入档随 env 34px）。
 */
async function assertDockClearOfSafeArea(page: Page, bandMin: number): Promise<void> {
  const geo = await readDockGeometry(page)

  // 无横向溢出：Dock 与预留带不得撑出横向滚动。
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.innerWidth)

  // Dock 底边不越过预留带顶边（safe-area 不被 Dock 遮挡），带完整落在视口内。
  expect(geo.dockBottom).toBeLessThanOrEqual(geo.bandTop + 0.5)
  expect(geo.bandBottom).toBeLessThanOrEqual(geo.innerHeight + 0.5)

  // 预留带 max() 保底仍成立（M0-4 契约不因 M1-5 改变）。
  expect(geo.bandHeight).toBeGreaterThanOrEqual(bandMin)

  // 内容区不被 Dock 覆盖：内容区底边不越过 Dock 顶边。
  expect(geo.contentBottom).toBeLessThanOrEqual(geo.dockTop + 0.5)

  // 触控目标（§35.3）：Dock 本体高度 ≥ 44px。
  expect(geo.dockHeight).toBeGreaterThanOrEqual(44)
}

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('Dock 固定 5 位：点 Files 推进 nav、点 Home 复位、safe-area 不被遮挡', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobiledock')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    // 固定 5 位可见：Home 位 + Files/Notes/今日世界/Settings 四应用位。
    const dock = page.getByTestId('mobile-dock')
    await expect(dock).toBeVisible()
    await expect(page.getByTestId('mobile-dock-home')).toBeVisible()
    await expect(page.getByTestId('mobile-dock-app')).toHaveCount(4)

    // viewport-fit=cover（index.html）：CDP inset 注入生效的前提（M0-4）。
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    )

    // ① 基线：模拟器无刘海，env 零回退——预留带 12px 保底，Dock 不遮挡。
    await assertDockClearOfSafeArea(page, 12)

    // 点 Files 位推进 nav（M1-6 前过渡语义 = 纯状态机推进，反射口断言）。
    await page
      .locator('[data-testid="mobile-dock-app"][data-app-id="com.ageha.files"]')
      .click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.files')

    // 点 Home 位复位：view 回 home、appId 反射消失。
    await page.getByTestId('mobile-dock-home').click()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).not.toHaveAttribute('data-nav-app-id')

    // ② 注入 iPhone 15 Pro 档 inset（top 59 / bottom 34 / 左右 47）：预留带
    //    随 env 长高，Dock 仍完整坐在带上方（safe-area 不被 Dock 遮挡）。
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 59, bottom: 34, left: 47, right: 47 },
    })
    await assertDockClearOfSafeArea(page, 34)
  })
})
