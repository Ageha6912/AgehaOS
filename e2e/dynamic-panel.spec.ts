import { expect, test } from '@playwright/test'

/**
 * AI 内容面板（DDS §5.1 域③，Phase B 本地切片）：启动面板 → 卡片渲染且带
 * 「AI 生成」标识 → 决策来源为本地规则。
 */
test('dynamic panel: local cards render with AI attribution', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('panele2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = page.getByRole('button', { name: /开始/ })
  await expect(startButton).toBeVisible()

  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /动态面板/ }).click()
  const panel = page.getByRole('region', { name: '动态面板' })
  await expect(panel).toBeVisible()

  // 问候卡恒在；AI 生成标识逐卡存在；决策来源 = 本地规则。
  await expect(panel.getByTestId('panel-card-greeting')).toBeVisible()
  await expect(panel.getByTestId('panel-card-suggest')).toBeVisible()
  await expect(panel.getByTestId('panel-card-tip')).toBeVisible()
  await expect(panel.getByText('AI 生成').first()).toBeVisible()
  await expect(panel.getByText('本地规则').first()).toBeVisible()

  // 刷新按钮重新装配（内容仍完整）。
  await panel.getByTestId('dynamic-panel-refresh').click()
  await expect(panel.getByTestId('panel-card-greeting')).toBeVisible()
})
