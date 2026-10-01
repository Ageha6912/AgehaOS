import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * Type C SDK（PRD §8.1、§30.1）：安装便签（storage + window 权限）→ 在沙箱
 * iframe 里添加便签 → 关窗重开后数据仍在——证明存储经宿主桥落在了
 * 按 appId 隔离的命名空间，而不是应用自己的（不透明 origin 无法持久化）。
 */
test('sdk sticky notes: install, write through the sandbox bridge, persist across reopen', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('sdke2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()

  // 安装便签（申请 storage + window 权限，对话框默认全选）。
  await revealTaskbar(page)
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /应用商店/ }).click()
  const store = page.getByRole('region', { name: '应用商店' })
  await expect(store).toBeVisible()

  await store.getByRole('listitem').filter({ hasText: '便签' }).getByRole('button', { name: '安装' }).click()
  const dialog = page.getByRole('dialog', { name: '应用权限申请' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('使用本地存储')).toBeVisible()
  await expect(dialog.getByText('创建和管理窗口')).toBeVisible()
  await dialog.getByRole('button', { name: '允许并安装' }).click()

  // 启动便签，在沙箱 iframe 内写一条便签。
  await store.getByRole('listitem').filter({ hasText: '便签' }).getByRole('button', { name: '打开' }).click()
  const stickyWindow = page.getByRole('region', { name: /^便签/ })
  await expect(stickyWindow).toBeVisible()
  // §30 横版默认：目录应用默认窗口宽 > 高。
  const stickyBox = (await stickyWindow.boundingBox()) ?? { width: 0, height: 0 }
  expect(stickyBox.width).toBeGreaterThan(stickyBox.height)

  const frame = stickyWindow.locator('iframe').contentFrame()
  await expect(frame.getByText('SDK 已连接')).toBeVisible({ timeout: 10_000 })
  await frame.getByPlaceholder('记点什么…').fill('买牛奶')
  await frame.getByRole('button', { name: '添加' }).click()
  await expect(frame.getByText('买牛奶')).toBeVisible()
  // Window API：窗口标题随数量更新。
  await expect(page.getByRole('region', { name: '便签 (1)' })).toBeVisible()

  // 关窗重开：数据经宿主隔离存储持久化。
  await page.getByRole('region', { name: '便签 (1)' }).getByRole('button', { name: '关闭窗口' }).click()
  await store.getByRole('listitem').filter({ hasText: '便签' }).getByRole('button', { name: '打开' }).click()
  const reopened = page.getByRole('region', { name: /^便签/ })
  const reopenedFrame = reopened.locator('iframe').contentFrame()
  await expect(reopenedFrame.getByText('买牛奶')).toBeVisible({ timeout: 10_000 })
})
