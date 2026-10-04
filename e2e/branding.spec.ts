import { expect, test, type Page } from '@playwright/test'

import { taskbarStartButton } from './helpers'

/**
 * 中央品牌状态化（Desktop Shell 3.0 STEP 5，Desktop Environment Branding）：
 * opacity 由桌面状态分四档驱动（branding-visibility.ts）——空闲 100% /
 * 单可见窗 40%（30-50% 带内）/ 多可见窗 15%（0-20% 带内）/ 任一 chrome 弹层
 * （启动器/全局搜索/通知中心）0% 隐藏。验收契约：各档用 computed opacity
 * 探针实测（getComputedStyle，轮询至 300ms 过渡落定），类名断言不作数；
 * 关闭弹层/最小化窗口后档位精确回归（含「弹层隐藏压过窗口档、关闭后回
 * 窗口档而非满档」）。
 */
test.describe.configure({ retries: 2 })

async function registerDesktop(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
}

/** computed opacity 探针（expect.poll 轮询，等过渡动画落定后的终值）。 */
async function expectBrandOpacity(page: Page, value: string): Promise<void> {
  await expect
    .poll(
      () =>
        page
          .getByTestId('desktop-branding')
          .evaluate((el) => getComputedStyle(el).opacity),
      { timeout: 3_000 },
    )
    .toBe(value)
}

test('品牌 opacity 随窗口档阶梯：空闲 1 → 单窗 0.4 → 多窗 0.15 → 最小化逐级回归', async ({
  page,
}) => {
  await registerDesktop(page, `brand-tier-${Date.now().toString(36)}`)

  // ① 空闲：满档 100%。
  await expectBrandOpacity(page, '1')

  // ② 单可见窗：40%。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  const notes = page.getByRole('region', { name: '记事' })
  await expect(notes).toBeVisible()
  await expectBrandOpacity(page, '0.4')

  // ③ 多可见窗：15%。
  await page.getByTestId('dock-pin-com.ageha.calculator').click()
  const calculator = page.getByRole('region', { name: '计算器' })
  await expect(calculator).toBeVisible()
  await expectBrandOpacity(page, '0.15')

  // ④ 最小化其一：回单窗档；再最小化另一枚：回空闲满档。
  await calculator.getByRole('button', { name: '最小化窗口' }).click()
  await expectBrandOpacity(page, '0.4')
  await notes.getByRole('button', { name: '最小化窗口' }).click()
  await expectBrandOpacity(page, '1')
})

test('chrome 弹层打开即 0% 隐藏，关闭精确回归（启动器/搜索/通知中心）', async ({ page }) => {
  await registerDesktop(page, `brand-overlay-${Date.now().toString(36)}`)

  // 基线：先开一枚窗口（单窗档 40%），弹层关闭后应回到 40% 而非 1——
  // 隐藏档只在弹层存续期间生效。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  await expect(page.getByRole('region', { name: '记事' })).toBeVisible()
  await expectBrandOpacity(page, '0.4')

  // ① 启动器（Dock 触发器）。
  await taskbarStartButton(page).click()
  await expect(page.getByTestId('launcher-grid')).toBeVisible()
  await expectBrandOpacity(page, '0')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('launcher-grid')).toBeHidden()
  await expectBrandOpacity(page, '0.4')

  // ② 全局搜索（Ctrl+K）。
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('search-palette')).toBeVisible()
  await expectBrandOpacity(page, '0')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('search-palette')).toBeHidden()
  await expectBrandOpacity(page, '0.4')

  // ③ 通知中心（顶栏铃铛）。
  await page.getByTestId('notification-bell').click()
  await expect(page.getByTestId('notification-panel')).toBeVisible()
  await expectBrandOpacity(page, '0')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('notification-panel')).toBeHidden()
  await expectBrandOpacity(page, '0.4')
})
