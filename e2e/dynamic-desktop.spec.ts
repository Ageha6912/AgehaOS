import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * AI 动态桌面验收（设计文档 §11.2-A ⑨⑩ + 2026-09-26 默认开启裁决）：
 * 照片壁纸出厂即开（新账号登录后壁纸层自动出现、AI 徽标隐藏）；
 * 主开关关闭后退回纯色渐变桌面（opt-out 语义）。
 */
test('dynamic desktop: photo wallpaper on by default, opt-out restores the plain desktop', async ({
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

  // 默认开启：生成流程完成后壁纸层出现。Phase A.6：主动样域为真实照片——
  // <img> 照片表面 + 「AI 生成」徽标隐藏（照片非 AI 生成，徽标声明不成立）。
  const layer = page.getByTestId('wallpaper-layer')
  await expect(layer).toBeVisible({ timeout: 20_000 })
  const photo = page.getByTestId('wallpaper-surface-photo')
  await expect(photo).toBeVisible()
  await expect(photo).toHaveAttribute('src', /\/wallpapers\/landscapes\/.+\.jpg$/)
  await expect(page.getByTestId('ai-badge')).toHaveCount(0)

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
