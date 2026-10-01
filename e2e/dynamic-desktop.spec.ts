import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * AI 动态桌面验收（设计文档 §11.2-A ⑨⑩ + 2026-09-26 默认开启裁决 +
 * 2026-09-27 生成域切换）：gradient-field 壁纸出厂即开（canvas 绘制的
 * macOS 风分层色场，AI 徽标按裁决不显示）；主开关关闭后退回纯色渐变桌面
 * （opt-out 语义）。
 */
test('dynamic desktop: generated wallpaper on by default, opt-out restores the plain desktop', async ({
  page,
}) => {
  await page.goto('/')

  // 注册并进入桌面（自动登录）。
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('dynamice2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // 默认开启：生成流程完成后壁纸层出现。2026-09-27：gradient-field 生成域——
  // canvas 绘制的分层色场（照片面已退役）+ AI 徽标不显示（用户裁决）。
  const layer = page.getByTestId('wallpaper-layer')
  await expect(layer).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('wallpaper-surface-canvas')).toBeVisible()
  await expect(page.getByTestId('wallpaper-surface-photo')).toHaveCount(0)
  await expect(page.getByTestId('ai-badge')).toHaveCount(0)

  // 右键菜单「更换壁纸」：seed 变化驱动 canvas 重绘（同款构图或新构图都合法）。
  // §30 横版面板占 344-1024×52-472，(400,400) 已落进面板窗口——
  // 移到面板左侧稳定空白区（左栏 0-80；契约不变：空白画布右键出菜单）。
  await page.mouse.click(200, 400, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await page.getByTestId('context-menu-renew-wallpaper').click()
  await expect(menu).toBeHidden()
  await expect(page.getByTestId('wallpaper-surface-canvas')).toBeVisible()

  // 设置 → 动态桌面：开关处于开启位。
  const startButton = taskbarStartButton(page)
  await revealTaskbar(page)
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /设置/ }).click()
  await page.getByRole('button', { name: '动态桌面' }).click()
  const toggle = page.getByTestId('dynamic-desktop-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // 关闭：主开关退化为 opt-out，回到纯色渐变桌面。
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('wallpaper-layer')).toHaveCount(0)
})
