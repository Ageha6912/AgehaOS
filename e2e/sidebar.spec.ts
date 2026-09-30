import { expect, test } from '@playwright/test'

/**
 * 左侧系统导航栏（docs/DESIGN.md §26）：真实动作轨——启动应用、共享通知面板。
 */
test('sidebar: launches apps and opens the shared notification center', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('sidebar-e2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })

  // 侧栏启动文件管理器（与 Dock/启动器正交的快捷入口）。
  await page.getByTestId('sidebar-files').click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()

  // 通知项唤起与顶栏铃铛共享的面板（store 化开合）。
  await page.getByTestId('sidebar-notifications').click()
  await expect(page.getByTestId('notification-panel')).toBeVisible()
  await page.getByTestId('sidebar-notifications').click()
  await expect(page.getByTestId('notification-panel')).toBeHidden()

  // 本地模式（E2E 净构建无后端）：云同步禁用。
  await expect(page.getByTestId('sidebar-sync')).toBeDisabled()
})
