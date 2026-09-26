import { expect, test } from '@playwright/test'

/**
 * AI 内容面板（DDS §5.1 域③）+ 默认开启裁决（2026-09-26）：
 * 进入桌面即自动打开（停靠右上、避开图标列），卡片渲染且带
 * 「AI 生成」标识，决策来源为本地规则；不再需要从菜单手动启动。
 */
test('dynamic panel: auto-opens on the desktop with local cards and AI attribution', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('panele2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // 自动打开：桌面就绪后面板窗口直接出现，且停靠屏幕右半侧。
  const panel = page.getByRole('region', { name: '动态面板' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  const size = page.viewportSize() ?? { width: 1280, height: 720 }
  const box = (await panel.boundingBox()) ?? { x: 0, width: 0 }
  expect(box.x + box.width / 2).toBeGreaterThan(size.width / 2)

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
