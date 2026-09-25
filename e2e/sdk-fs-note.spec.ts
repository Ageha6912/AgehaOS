import { expect, test } from '@playwright/test'

/**
 * SDK Notification/File API（PRD §17）：安装云笔记（filesystem.read/write +
 * notification 权限）→ 沙箱内输入自动写入本应用专属目录 → 关窗重开内容仍在
 * （文件经宿主 VFS 落盘，而非沙箱自身）→ 发送通知 → 宿主 toast 与通知中心
 * 出现该应用的字面文本通知。
 */
test('sdk fs-note: install, persist a note through the file bridge, raise a host notification', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('fsnote2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = page.getByRole('button', { name: /开始/ })
  await expect(startButton).toBeVisible()

  // 安装云笔记（申请读/写文件 + 发送通知权限，对话框默认全选）。
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /应用商店/ }).click()
  const store = page.getByRole('region', { name: '应用商店' })
  await expect(store).toBeVisible()

  await store.getByRole('listitem').filter({ hasText: '云笔记' }).getByRole('button', { name: '安装' }).click()
  const dialog = page.getByRole('dialog', { name: '应用权限申请' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('读取文件')).toBeVisible()
  await expect(dialog.getByText('写入文件')).toBeVisible()
  await expect(dialog.getByText('发送通知')).toBeVisible()
  await dialog.getByRole('button', { name: '允许并安装' }).click()

  // 启动云笔记，在沙箱 iframe 内写正文（防抖自动保存）。
  await store.getByRole('listitem').filter({ hasText: '云笔记' }).getByRole('button', { name: '打开' }).click()
  const noteWindow = page.getByRole('region', { name: /^云笔记/ })
  await expect(noteWindow).toBeVisible()
  const frame = noteWindow.locator('iframe').contentFrame()
  await expect(frame.getByText(/已从应用空间载入|新笔记/)).toBeVisible({ timeout: 10_000 })

  await frame.getByRole('textbox').fill('AgehaOS 文件桥测试')
  await expect(frame.getByText(/已保存/)).toBeVisible({ timeout: 10_000 })

  // File API：关窗重开，正文经宿主 VFS 恢复。
  await noteWindow.getByRole('button', { name: '关闭窗口' }).click()
  await store.getByRole('listitem').filter({ hasText: '云笔记' }).getByRole('button', { name: '打开' }).click()
  const reopened = page.getByRole('region', { name: /^云笔记/ })
  const reopenedFrame = reopened.locator('iframe').contentFrame()
  await expect(reopenedFrame.getByText('已从应用空间载入')).toBeVisible({ timeout: 10_000 })
  await expect(reopenedFrame.getByRole('textbox')).toHaveValue('AgehaOS 文件桥测试')

  // Notification API：字面文本通知出现在 toast 与通知中心。
  await reopenedFrame.getByRole('button', { name: '发送通知' }).click()
  const toast = page.getByTestId('notification-toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('云笔记')
  await expect(toast).toContainText('笔记已保存在本应用空间')
  await toast.click()

  await page.getByTestId('notification-bell').click()
  const center = page.getByTestId('notification-panel')
  await expect(center).toBeVisible()
  await expect(center.getByTestId('notification-item').filter({ hasText: '云笔记' }).first()).toBeVisible()
})
