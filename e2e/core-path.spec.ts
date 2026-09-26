import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * The PRD §34.3 core path, exercised end to end:
 * Login → Desktop → Open App → Create File → Save → Close → Reopen
 * plus session restore across reload and sign-out (PRD §45.5).
 */
test('core path: register, work with a note, restore session, sign out', async ({ page }) => {
  await page.goto('/')

  // Boot finishes into the login screen (no session yet).
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  // Register a fresh account (auto sign-in).
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('e2euser')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()
  await expect(page.getByRole('button', { name: /e2euser/ })).toBeVisible()

  const launch = async (appName: RegExp) => {
    // 任务栏自动隐藏：先唤出再点开始菜单（docs/DESIGN.md §9）。
    await revealTaskbar(page)
    await startButton.click()
    await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: appName }).click()
  }

  // Open the Notes app and create a note.
  await launch(/记事/)
  const notesWindow = page.getByRole('region', { name: '记事' })
  await expect(notesWindow).toBeVisible()
  await page.getByRole('button', { name: '新建文本文件' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('e2e-note.txt')
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click()

  const editor = page.getByRole('textbox', { name: '笔记编辑器' })
  await expect(editor).toBeVisible()
  await editor.fill('hello from e2e')

  const saveButton = page.getByRole('button', { name: '保存' })
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(saveButton).toBeDisabled()

  // Session restore: a reload lands directly on the desktop, still signed in.
  await page.reload()
  await expect(startButton).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /e2euser/ })).toBeVisible()

  // Reopen the app: the saved note is still there with its content.
  await launch(/记事/)
  await page.getByRole('button', { name: /e2e-note\.txt/ }).click()
  await expect(page.getByRole('textbox', { name: '笔记编辑器' })).toHaveValue('hello from e2e')

  // Close the window and sign out.
  await page
    .getByRole('region', { name: '记事' })
    .getByRole('button', { name: '关闭窗口' })
    .click()
  await expect(page.getByRole('region', { name: '记事' })).toBeHidden()

  await revealTaskbar(page)
  await page.getByRole('button', { name: /e2euser/ }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('form', { name: '登录 AgehaOS' })).toBeVisible()
})

test('wrong credentials show an error on the login screen', async ({ page }) => {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('用户名').fill('ghost')
  await page.getByLabel('密码').fill('whatever1')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByRole('alert')).toHaveText('用户名或密码错误')
})
