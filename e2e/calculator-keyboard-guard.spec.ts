import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * 计算器物理键盘监听的作用域守卫（2026-10-18 用户 bug 回归）：
 * 计算器一旦挂载过，全系统输入框的数字/标点/退格曾被 window 级监听吞掉
 * ——地址栏「打不进数字标点、退格失效」。本 spec 钉住修复：可编辑字段豁免
 * + 仅聚焦窗口接管；同时钉住计算器自身的物理键盘便利不回退。
 */

async function registerShell(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page.getByRole('contentinfo')).toBeVisible()
}

async function launch(page: Page, name: string): Promise<void> {
  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  await page.getByTestId('launcher-grid').getByRole('button', { name }).click()
}

test('计算器打开过之后：浏览器地址栏数字/标点/退格完好（用户 bug）', async ({ page }) => {
  await registerShell(page, `cg${Date.now() % 10_000_000}`)

  // 打开计算器（挂载 window 级键盘监听——修复前的吞键源头）。
  await launch(page, '计算器')
  await expect(page.getByTestId('calculator-display')).toBeVisible()

  // 再打开浏览器，点地址栏输入数字/标点/退格。
  await launch(page, '浏览器')
  const address = page.getByTestId('browser-address')
  await expect(address).toBeVisible()
  await address.click()
  await page.keyboard.type('abc123,.')
  await expect(address).toHaveValue('abc123,.')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(address).toHaveValue('abc123')

  // 顺带：搜索面板（另一输入框）同样恢复。
  await page.keyboard.press('Control+k')
  const palette = page.getByTestId('search-input')
  await expect(palette).toBeVisible()
  await palette.fill('')
  await page.keyboard.type('12345')
  await expect(palette).toHaveValue('12345')
})

test('计算器自身聚焦时：物理键盘便利不回退（数字仍接管）', async ({ page }) => {
  await registerShell(page, `cg${Date.now() % 10_000_000}`)
  await launch(page, '计算器')
  const display = page.getByTestId('calculator-display')
  await expect(display).toBeVisible()

  // 点一下计算器窗口内容（夺焦），直接敲物理键盘。
  await display.click()
  await page.keyboard.type('12+3=')
  await expect(display).toHaveText('15')
})
