import { expect, test, type Page } from '@playwright/test'

/**
 * Window Switcher E2E（W6，审计 .tmp/spaces-audit.md §9）：**键盘驱动轻点
 * 路径**——Alt+W 轻点轮转聚焦、多窗循环、按住呼出面板 / Esc 取消 / 松开提交。
 *
 * ⚠️ 按住 auto-repeat（按住循环选择）在 Playwright 键盘模型里无法可靠合成
 * （keyboard.press 是离散 down+up，OS 级 repeat 不经 CDP），按审计 §9 口径
 * 该三段由状态机/快捷键单测覆盖（use-switcher.test.ts +
 * use-global-shortcuts.test.tsx 的 repeat keydown 用例），本 spec 注明不覆盖。
 */

// 4-worker/2-worker 高负载下开窗飞行动画未落定的偶发毛刺重试即愈
//（window-snap.spec 同款环境级处置）。
test.describe.configure({ retries: 2 })

/** 聚焦探针：WindowFrame 聚焦档类（sp-win-focused）所在 section 的 aria-label。 */
function focusedSection(page: Page) {
  return page.locator('section.sp-win-focused')
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

test('Alt+W tap 在两窗间轮转聚焦并回绕（轻点路径=迁移前 cycleWindows 语义）', async ({
  page,
}) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 轻点一次：焦点轮到 z 序下一位（记事）
  await page.keyboard.press('Alt+w')
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')
  // 面板不悬挂：松开即收（rect=null 式零 DOM）
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)

  // 再轻点：回绕（两窗循环）
  await page.keyboard.press('Alt+w')
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
})

test('按住 Alt+W 呼出面板（z 序条目），Esc 取消且不追加切换', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  // 按住（down 不 up）：keydown 首按先落轻点焦点（记事），再开面板
  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  const panel = page.getByTestId('window-switcher')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('window-switcher-item')).toHaveCount(2)
  // 面板标题（i18n zh 词典；role="dialog" 即面板根节点）
  await expect(panel).toHaveAttribute('aria-label', '窗口切换')

  // Esc → 取消：面板收起，不再追加切换（焦点停在 keydown 已落的记事）
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  // 取消后的 keyup 零作用（不提交）
  await page.keyboard.up('w')
  await page.keyboard.up('Alt')
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
})

test('按住后松开提交选中：焦点即 keydown 预选窗，面板收起', async ({ page }) => {
  await openTwoWindows(page)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '文件')

  await page.keyboard.down('Alt')
  await page.keyboard.down('w')
  await expect(page.getByTestId('window-switcher')).toBeVisible()

  // 松开 W（Alt 仍按住）→ 提交选中（预选=记事）→ 面板收起
  await page.keyboard.up('w')
  await expect(page.getByTestId('window-switcher')).toHaveCount(0)
  await expect(focusedSection(page)).toHaveAttribute('aria-label', '记事')

  await page.keyboard.up('Alt')
})
