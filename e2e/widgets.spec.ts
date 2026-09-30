import { expect, test } from '@playwright/test'

/**
 * 右侧小组件栏（docs/DESIGN.md §27）：≥1280px 显示四卡（真实数据源）；
 * 自动打开的动态面板让位不重叠。
 */
test('widgets: rail shows real-data cards and the panel avoids it (§27)', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('widgets-e2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const rail = page.getByTestId('widget-rail')
  await expect(rail).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('widgets-clock')).toBeVisible()
  await expect(page.getByTestId('widgets-calendar')).toBeVisible()
  await expect(page.getByTestId('widgets-system')).toBeVisible()
  await expect(page.getByTestId('widgets-wallpaper')).toBeVisible()

  // 今日壁纸卡：壁纸默认开启 → 构图名可见（非关闭态文案）。
  const wallpaperCard = await page.getByTestId('widgets-wallpaper').textContent()
  expect(wallpaperCard).not.toContain('壁纸已关闭')

  // 动态面板自动打开后完整处于小组件栏左侧（E2E 视口 1280 = xl 恰好启用）。
  const panel = page.getByRole('region', { name: '动态面板' })
  await expect(panel).toBeVisible()
  const panelBox = await panel.boundingBox()
  const railBox = await rail.boundingBox()
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(railBox!.x + 1)
})
