import { expect, test } from '@playwright/test'

import { openDynamicPanel } from './helpers'

/**
 * AI 内容面板（DDS §5.1 域③）。2026-10-02 用户裁决：进桌面不再自动开窗——
 * 面板改为经 Ctrl+K 搜索手动打开；卡片渲染且带「AI 生成」标识，生成位置
 * 为本机。桌面空态由 Desktop 单测钉扎。
 */
test('dynamic panel: opens via search with local cards and AI attribution', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('panele2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 零自动开窗：桌面就绪后动态面板（原自动打开项）不在场。
  await expect(page.getByRole('region', { name: '动态面板' })).toHaveCount(0)

  // 手动打开：停靠屏幕右半侧；§30 横版默认：默认窗口宽 > 高。
  const panel = await openDynamicPanel(page)
  const size = page.viewportSize() ?? { width: 1280, height: 720 }
  const box = (await panel.boundingBox()) ?? { x: 0, width: 0, height: 0 }
  // §32 右栏 296px（用户裁决收窄）：面板停靠在右栏左侧（右缘不越入小组件栏）。
  expect(box.x + box.width).toBeLessThanOrEqual(size.width - 296 + 1)
  expect(box.width).toBeGreaterThan(box.height)

  // 问候卡恒在；AI 生成标识逐卡存在；生成位置 = 本机。
  await expect(panel.getByTestId('panel-card-greeting')).toBeVisible()
  await expect(panel.getByTestId('panel-card-suggest')).toBeVisible()
  await expect(panel.getByTestId('panel-card-tip')).toBeVisible()
  await expect(panel.getByText('AI 生成').first()).toBeVisible()
  await expect(panel.getByTestId('panel-decision-source')).toHaveText('生成于 本机')

  // 刷新按钮重新装配（内容仍完整）。
  await panel.getByTestId('dynamic-panel-refresh').click()
  await expect(panel.getByTestId('panel-card-greeting')).toBeVisible()
})
