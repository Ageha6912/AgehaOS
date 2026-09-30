import { expect, test } from '@playwright/test'

/**
 * 顶部菜单栏（docs/DESIGN.md §19）：窗口菜单管理窗口、视图菜单切主题、
 * 通知铃自任务栏迁移至顶栏后照常展开通知中心。
 */
test('menu bar: manages windows, switches theme, opens notification center', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('menubar-e2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // 顶栏常驻：品牌 + 菜单 + 迁移后的系统状态（用户/时钟）。
  const bar = page.getByTestId('menu-bar')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('menu-bar-clock')).toBeVisible()
  await expect(page.getByRole('button', { name: /menubar-e2e/ })).toBeVisible()

  // 窗口菜单：动态面板自动打开 → 条目存在 → 最小化全部。
  const dynamicPanel = page.getByRole('region', { name: '动态面板' })
  await expect(dynamicPanel).toBeVisible()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '最小化全部窗口' })).toBeEnabled()
  await menu.getByRole('menuitem', { name: '最小化全部窗口' }).click()
  await expect(dynamicPanel).toBeHidden()

  // 视图菜单：切浅色再切回深色（html.dark 契约）。
  await page.getByRole('button', { name: '视图', exact: true }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: '浅色' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.getByRole('button', { name: '视图', exact: true }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: '深色' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  // 通知铃（现挂顶栏，无需唤出任务栏）：面板展开。
  await page.getByTestId('notification-bell').click()
  await expect(page.getByTestId('notification-panel')).toBeVisible()
})
