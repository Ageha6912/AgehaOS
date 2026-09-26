import { expect, test } from '@playwright/test'

/**
 * 桌面图标层（docs/DESIGN.md §6）：登录后所有内置应用以徽章图标
 * 固定在桌面左上；单击选中、双击启动。
 */
test('desktop icons: select and open apps from the desktop', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('e2e-desktop')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // 桌面图标网格与全部内置应用可见。
  const grid = page.getByRole('navigation', { name: '桌面应用' })
  await expect(grid).toBeVisible()
  for (const name of ['文件', '记事', '终端', '应用商店', '计算器', '动态面板', '设置']) {
    await expect(grid.getByRole('button', { name })).toBeVisible()
  }

  // 单击只选中，不开窗。
  const filesIcon = grid.getByRole('button', { name: '文件' })
  await filesIcon.click()
  await expect(filesIcon).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: '文件' })).toHaveCount(0)

  // 双击启动 Files。
  await filesIcon.dblclick()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()
})
