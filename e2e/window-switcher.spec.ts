import { expect, test, type Page } from '@playwright/test'

/**
 * Window Switcher E2E（W6→W11→**W12 Windows Alt+Tab 同款语义**，审计
 * .tmp/spaces-audit.md §14，用户确认覆盖 W11 常驻面板）：按住 Alt+W 开面板并
 * 驻留（**W keyup 不提交**）、面板开启期 W/→ 正向循环、Shift+W/← 反向循环
 * （Shift 按下时 DOM key=大写 'W'，e2e 直接钉扎匹配归一）、**松开 Alt=提交
 * 选中**（快速轻点=直接切到 z-next，面板闪现属 Windows 同款设计而非 bug）、
 * 点击条目=提交（保留手势）、Esc 取消（取消后的 Alt keyup 零作用）、
 * <2 窗轻点走既有 cycleWindows 单步（不开面板）。
 *
 * Playwright 可精确合成按住/松开（keyboard.down/up + 修饰键状态跨按键持久），
 * 本 spec 全链路钉扎 W12 交互；OS 级 auto-repeat 仍不经 CDP 无法可靠合成，
 * repeat 连发循环由状态机/快捷键单测覆盖（use-switcher.test.ts +
 * use-global-shortcuts.test.tsx 的 repeat keydown 用例）。
 */

// 4-worker/2-worker 高负载下开窗飞行动画未落定的偶发毛刺重试即愈
//（window-snap.spec 同款环境级处置）。
test.describe.configure({ retries: 2 })

/** 聚焦探针：WindowFrame 聚焦档类（sp-win-focused）所在 section 的 aria-label。 */
function focusedSection(page: Page) {
  return page.locator('section.sp-win-focused')
}

/** 切换器面板。 */
function panel(page: Page) {
  return page.getByTestId('window-switcher')
}

/** 面板当前选中条目的 data-window-id 定位器。 */
function selectedItemId(page: Page) {
  return panel(page).locator('[data-testid="window-switcher-item"][data-selected="true"]')
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

test('W12 主链路：按住 Alt+W 面板驻留（W keyup 不提交）→ ← 反向 → 松开 Alt=提交', async ({
  page,
}) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // down Alt + down w：面板出现，选中=z 序下一位（记事）并即时聚焦
  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByTestId('window-switcher-item')).toHaveCount(2)
  await expect(panel(page)).toHaveAttribute('aria-label', '窗口切换')
  await expect(selectedItemId(page)).toHaveText(/记事/)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // W12 裁决：W keyup 不提交——Alt 按住期间面板驻留、焦点不动
  await page.keyboard.up('w')
  await expect(panel(page)).toBeVisible()
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // ← 反向循环：记事 → 文件（可见窗即时聚焦，Windows Alt+Tab 同款方向键浏览）
  await page.keyboard.press('ArrowLeft')
  await expect(selectedItemId(page)).toHaveText(/文件/)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 松开 Alt=提交选中：面板收起，焦点保持文件
  await page.keyboard.up('Alt')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
})

test('Shift+W 反向循环（DOM key=大写 W 的匹配归一钉扎）；松开 Alt 提交反向选中的窗', async ({
  page,
}) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(panel(page)).toBeVisible()
  await expect(selectedItemId(page)).toHaveText(/记事/)

  // Shift 按下时按 W：DOM keydown 是 key='W'（大写）+ shiftKey——switcher W
  // 条目必须归一匹配并按 shiftKey 分流为反向
  await page.keyboard.down('Shift')
  await page.keyboard.down('w')
  await expect(selectedItemId(page)).toHaveText(/文件/)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
  await page.keyboard.up('w')
  await page.keyboard.up('Shift')

  // 面板仍驻留（W keyup 不提交）；松开 Alt 提交反向选中的文件
  await expect(panel(page)).toBeVisible()
  await page.keyboard.up('Alt')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
})

test('面板开启期再按 W 正向循环；Esc 取消且取消后的 Alt keyup 零作用（不提交）', async ({
  page,
}) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(panel(page)).toBeVisible()
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事') // open 即时聚焦 z-next

  // 面板开启期再按 W（与 repeat 同一 cycle 路径，Alt 保持按住）：正向回绕到文件
  await page.keyboard.press('w')
  await expect(selectedItemId(page)).toHaveText(/文件/)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // Esc 取消：面板收起、不追加切换（焦点停在循环已落的文件）
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 取消后的 Alt keyup 零作用（W12：cancel 后松 Alt 不得触发提交）
  await page.keyboard.up('Alt')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
})

test('快速轻点 Alt+W=直接切到 z 序下一位（面板闪现即提交，Windows 同款设计）', async ({
  page,
}) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // press = down Alt → down w → up w → up Alt：面板闪现几毫秒即提交
  await page.keyboard.press('Alt+w')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // 再轻点：记事已持焦（z 序跳顶）→ z-next=文件，直接切回
  await page.keyboard.press('Alt+w')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
})

test('点击条目=提交该窗（W12 §14 目标 5 保留手势）；提交后松开 Alt 零作用', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 按住 Alt+W 开面板并驻留（up w 不提交）
  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(panel(page)).toBeVisible()

  // 点击「记事」条目 → 提交该窗：面板收起、记事聚焦
  await panel(page).locator('[data-testid="window-switcher-item"]', { hasText: '记事' }).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // 面板已收（choose 提交）：松开 Alt 零作用（when 自守卫）
  await page.keyboard.up('Alt')
  await expect(panel(page)).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')
})

test('单窗 Alt+W 不开面板（<2 窗轻点走 cycleWindows 单步、零行为变化）', async ({ page }) => {
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
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('section.sp-win-focused')).toHaveAttribute('aria-label', '记事')
})
