import { expect, test } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * App Store + Type B 沙箱应用（PRD §26、§30.3）：
 * 打开商店 → 安装示例 Web 应用（零权限确认）→ 启动出现沙箱 iframe → 卸载。
 */
test('app store: install a sandboxed web app, launch it, uninstall it', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('storee2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()

  // 内置应用里现在有计算器（P1 系统应用）。
  await revealTaskbar(page)
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /计算器/ }).click()
  const calculator = page.getByRole('region', { name: '计算器' })
  await expect(calculator).toBeVisible()
  await page.getByTestId('calculator-key-7').click()
  await page.getByTestId('calculator-key-×').click()
  await page.getByTestId('calculator-key-8').click()
  await page.getByTestId('calculator-key-=').click()
  await expect(page.getByTestId('calculator-display')).toHaveText(/56/)
  await calculator.getByRole('button', { name: '关闭窗口' }).click()

  // 打开应用商店，安装「时钟」（零权限 Web 应用）。
  await revealTaskbar(page)
  await startButton.click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /应用商店/ }).click()
  const store = page.getByRole('region', { name: '应用商店' })
  await expect(store).toBeVisible()

  await store.getByRole('button', { name: '安装', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '应用权限申请' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '允许并安装' }).click()

  await expect(store.getByText('已安装').first()).toBeVisible()

  // 安装的应用同步出现在桌面上（徽章图标 + 名称）。
  await expect(page.getByTestId('desktop-icon-com.ageha.samples.clock')).toBeVisible()

  // 从商店直接启动：出现沙箱 iframe（allow-scripts、同源站点）。
  await store.getByRole('button', { name: '打开' }).click()
  const clockWindow = page.getByRole('region', { name: '时钟' })
  await expect(clockWindow).toBeVisible()
  const iframe = clockWindow.locator('iframe')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(iframe).toHaveAttribute('src', '/apps/sites/clock/index.html')

  // 关闭窗口后卸载：开始菜单不再提供该应用。
  await clockWindow.getByRole('button', { name: '关闭窗口' }).click()
  await expect(clockWindow).toBeHidden()
  await store.getByRole('button', { name: /卸载 时钟/ }).click()
  await revealTaskbar(page)
  await startButton.click()
  await expect(
    page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /时钟/ }),
  ).toHaveCount(0)
})

test('store list keeps a visible scrollbar and a bottom fade while content overflows', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('e2e-store-scroll')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  await page.getByRole('list', { name: /开始/ }).getByRole('button', { name: /应用商店/ }).click()
  const store = page.getByRole('region', { name: '应用商店' })
  await expect(store).toBeVisible()

  // 常驻细滚动条（Windows 悬浮滚动条问题的修复载体）。
  const list = store.getByTestId('store-list')
  await expect(list).toHaveClass(/scroll-thin/)

  // 目录已有 8 条（4 样例 + 4 小游戏），默认窗口尺寸即溢出 → 底部渐隐直接可见。
  await expect(store.getByTestId('scroll-fade')).toBeVisible()

  // 滚到底 → 渐隐退场（用户能判断「已到末尾」）。
  const listBox = (await list.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2)
  await page.mouse.wheel(0, 4000)
  await expect(store.getByTestId('scroll-fade')).toHaveCount(0)
})
