import { expect, test } from '@playwright/test'

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

  const startButton = page.getByRole('button', { name: /开始/ })
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

  const startButton = page.getByRole('button', { name: /开始/ })
  await expect(startButton).toBeVisible()

  const notesItem = page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /记事/ })
  for (let index = 0; index < 20; index++) {
    await startButton.click()
    await notesItem.click()
  }

  await expect(page.getByRole('region', { name: '记事' })).toHaveCount(20)
  const taskbar = page.getByRole('contentinfo')
  await expect(taskbar.getByRole('button', { name: /记事/ })).toHaveCount(20)

  // The desktop still reacts: focusing another window and opening the menu.
  await taskbar.getByRole('button', { name: /记事/ }).first().click()
  await startButton.click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible()
})
