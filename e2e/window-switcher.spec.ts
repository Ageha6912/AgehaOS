import { expect, test, type Page } from '@playwright/test'

/**
 * Window Switcher E2E（W6→**W11 真机反馈改版**，审计 .tmp/spaces-audit.md
 * §13 A，用户裁决覆盖「松开提交」）：Alt+W keydown 开**常驻面板**——keyup 后
 * 面板仍在；W 再按循环选中；**Enter 提交 / Esc 取消 / 点击条目选择**。
 *
 * ⚠️ 按住 auto-repeat（按住循环选择）在 Playwright 键盘模型里无法可靠合成
 * （keyboard.press 是离散 down+up，OS 级 repeat 不经 CDP），repeat 循环由
 * 状态机/快捷键单测覆盖（use-switcher.test.ts + use-global-shortcuts.test.tsx
 * 的 repeat keydown 用例），本 spec 以「再按一次 Alt+W」驱动同一 cycle 路径。
 */

// 4-worker/2-worker 高负载下开窗飞行动画未落定的偶发毛刺重试即愈
//（window-snap.spec 同款环境级处置）。
test.describe.configure({ retries: 2 })

/** 聚焦探针：WindowFrame 聚焦档类（sp-win-focused）所在 section 的 aria-label。 */
function focusedSection(page: Page) {
  return page.locator('section.sp-win-focused')
}

/** 面板当前选中条目的 data-window-id。 */
function selectedItemId(page: Page) {
  return page
    .getByTestId('window-switcher')
    .locator('[data-testid="window-switcher-item"][data-selected="true"]')
}

async function openTwoWindows(page: Page): Promise<void> {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`switcher-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 开两窗（后开者持焦点）：Dock 常驻瓷贴（§32），Taskbar z-40 盖过窗口 z-30。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  await expect(page.locator('section[aria-label="记事"]')).toBeVisible()
  await page.getByTestId('dock-pin-com.ageha.files').click()
  await expect(page.locator('section[aria-label="文件"]')).toBeVisible()
}

test('Alt+W 开常驻面板：keyup 后仍在，Enter 提交选中（z 序下一位）', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // keydown 开面板：选中=z 序下一位（记事）并即时聚焦
  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  const panel = page.getByTestId('window-switcher')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('window-switcher-item')).toHaveCount(2)
  await expect(panel).toHaveAttribute('aria-label', '窗口切换')
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // W11 裁决：keyup 一律不提交——松开 W 面板常驻（旧「松开提交」闪现即逝的根因修复）
  await page.keyboard.up('w')
  await page.keyboard.up('Alt')
  await expect(panel).toBeVisible()
  await expect(selectedItemId(page)).toHaveText(/记事/)

  // Enter 提交选中：面板收起，焦点保持记事
  await page.keyboard.press('Enter')
  await expect(panel).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')
})

test('面板开启期再按 Alt+W 循环选中；Esc 取消且不追加切换', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(page.getByTestId('window-switcher')).toBeVisible()
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事') // open 即时聚焦 z-next

  // 面板开启期再按 W（与 repeat 同一 cycle 路径）：选中回绕到文件并即时聚焦
  await page.keyboard.press('Alt+w')
  await expect(selectedItemId(page)).toHaveText(/文件/)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // Esc 取消：面板收起，不追加切换（焦点停在循环已落的文件）
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 取消后的 keyup 零作用（面板已关）
  await page.keyboard.up('w')
  await page.keyboard.up('Alt')
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
})

test('点击条目=提交该窗（W11 新增点击选择）', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  await page.keyboard.press('Alt+w')
  const panel = page.getByTestId('window-switcher')
  await expect(panel).toBeVisible()

  // 点击「记事」条目 → 提交该窗：面板收起、记事聚焦
  await panel.locator('[data-testid="window-switcher-item"]', { hasText: '记事' }).click()
  await expect(panel).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')
})

test('单窗 Alt+W 不开面板（<2 窗轻点零行为变化）', async ({ page }) => {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`switcher-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  await page.getByTestId('dock-pin-com.ageha.notes').click()
  await expect(page.locator('section[aria-label="记事"]')).toBeVisible()

  await page.keyboard.press('Alt+w')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
  await expect(page.locator('section.sp-win-focused')).toHaveAttribute('aria-label', '记事')
})
