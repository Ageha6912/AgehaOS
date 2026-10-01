import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * Performance and robustness checks (PRD §29): interactive desktop within
 * 3 seconds of a reload, and a usable desktop under 20 open windows.
 */
test('restores the interactive desktop within 3 seconds after reload (PRD §29.1)', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('perfuser')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()

  const startedAt = Date.now()
  await page.reload()
  await expect(startButton).toBeVisible({ timeout: 3_000 })
  const elapsed = Date.now() - startedAt

  expect(elapsed).toBeLessThan(3_000)
  await expect(page.getByRole('button', { name: /perfuser/ })).toBeVisible()
})

test('keeps the desktop responsive with 20 open windows (PRD §29.2)', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('stressuser')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()

  // P2-5 起启动器有「最近」区——记事会同时出现在最近与全部网格，取后者。
  const notesItem = page
    .getByRole('list', { name: /开始/ })
    .getByRole('button', { name: /记事/ })
    .last()
  for (let index = 0; index < 20; index++) {
    // 任务栏自动隐藏：每次启动前唤出（docs/DESIGN.md §9）。
    await revealTaskbar(page)
    await startButton.click()
    await notesItem.click()
  }

  await expect(page.getByRole('region', { name: '记事' })).toHaveCount(20)
  // §32 Dock 参考图形态：常驻瓷贴按应用聚合（macOS 语义）——20 个记事窗口
  // 聚合为单枚瓷贴，悬停预览/点击激活契约不变。
  const taskbar = page.getByRole('contentinfo')
  const notesPin = taskbar.getByTestId('dock-pin-com.ageha.notes')
  await expect(notesPin).toHaveCount(1)
  await expect(notesPin).toHaveAttribute('aria-label', '记事')

  // The desktop still reacts: activating the pinned tile and opening the menu.
  await revealTaskbar(page)
  await notesPin.click()
  await startButton.click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible()
})
