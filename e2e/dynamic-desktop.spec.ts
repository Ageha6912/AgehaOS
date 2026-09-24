import { expect, test } from '@playwright/test'

/**
 * AI 动态桌面 Phase A 验收（设计文档 §11.2-A ⑨⑩）：
 * 设置中启用 → 壁纸层与 AI 徽标出现；关闭后回到 v0.1 默认桌面外观。
 */
test('dynamic desktop: enable in settings, wallpaper appears, disable restores the default', async ({
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

  const startButton = page.getByRole('button', { name: /开始/ })
  await expect(startButton).toBeVisible()

  // 打开 设置 → 动态桌面。
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /设置/ }).click()
  await page.getByRole('button', { name: '动态桌面' }).click()

  // 默认关闭：无壁纸层。
  const toggle = page.getByTestId('dynamic-desktop-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('wallpaper-layer')).toHaveCount(0)

  // 开启：生成流程完成后壁纸层出现。Phase A.6：主动样域为真实照片——
  // <img> 照片表面 + 「AI 生成」徽标隐藏（照片非 AI 生成，徽标声明不成立）。
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const layer = page.getByTestId('wallpaper-layer')
  await expect(layer).toBeVisible()
  const photo = page.getByTestId('wallpaper-surface-photo')
  await expect(photo).toBeVisible()
  await expect(photo).toHaveAttribute('src', /\/wallpapers\/landscapes\/.+\.jpg$/)
  await expect(page.getByTestId('ai-badge')).toHaveCount(0)

  // 关闭：回到 v0.1 默认桌面外观。
  await toggle.click()
  await expect(page.getByTestId('wallpaper-layer')).toHaveCount(0)
})
