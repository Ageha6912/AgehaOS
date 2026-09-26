import { expect, test } from '@playwright/test'

import { revealTaskbar } from './helpers'

/**
 * 任务栏自动隐藏（docs/DESIGN.md §9）：默认藏于屏幕底缘之外、背景为透明
 * 渐变纱；鼠标触底缓缓滑入，移开后延迟收起；唤出后开始菜单照常可用。
 */
test('taskbar auto-hides and slides in from the bottom edge', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('e2e-taskbar')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const size = page.viewportSize() ?? { width: 1280, height: 720 }
  const bar = page.getByRole('contentinfo')

  // 默认隐藏：整体位于视口之外（translateY(100%)）。
  await expect(bar).toHaveAttribute('data-state', 'hidden')
  await expect.poll(async () => (await bar.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(
    size.height - 1,
  )

  // 鼠标触底 → 缓缓滑入（300ms 过渡）。
  await revealTaskbar(page)
  await expect
    .poll(async () => (await bar.boundingBox())?.y ?? -1)
    .toBeLessThan(size.height - 40)

  // 移开指针 → 400ms 缓冲后滑出。
  await page.mouse.move(size.width / 2, Math.round(size.height / 2))
  await expect(bar).toHaveAttribute('data-state', 'hidden', { timeout: 5_000 })
  await expect.poll(async () => (await bar.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(
    size.height - 1,
  )

  // 唤出后从开始菜单启动应用照常工作。
  await revealTaskbar(page)
  await page.getByRole('button', { name: /开始/ }).click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /记事/ }).click()
  await expect(page.getByRole('region', { name: '记事' })).toBeVisible()
})
