import { expect, test } from '@playwright/test'

import { taskbarStartButton } from './helpers'

/**
 * 底部 Dock（docs/DESIGN.md §9/§20 + §32 修订 8，2026-10-01 用户裁决）：
 * **常驻显示**——自动隐藏机制已移除（唤出区/收起定时器退役），Dock 恒为
 * 可见状态；开始菜单/常驻瓷贴/回收站直接可用，无需任何唤出动作。
 */
test('taskbar 常驻：默认可见、不自动隐藏、开始菜单与瓷贴直达', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`dock-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  const bar = page.getByRole('contentinfo')
  // 常驻：无任何交互即为可见状态。
  await expect(bar).toHaveAttribute('data-state', 'revealed')

  // 指针移开（等待超过原收起缓冲 400ms）仍常驻。
  await page.mouse.move(640, 200)
  await page.waitForTimeout(700)
  await expect(bar).toHaveAttribute('data-state', 'revealed')

  // 直接点开始（无需唤出）打开启动器，Esc 关闭。
  await taskbarStartButton(page).click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // 常驻瓷贴直达：点击文件管理瓷贴启动应用。
  await page.getByTestId('dock-pin-com.ageha.files').click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()
})
