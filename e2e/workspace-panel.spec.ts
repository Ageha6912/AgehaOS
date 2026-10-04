import { expect, test } from '@playwright/test'

/**
 * Workspace Panel（Desktop Shell 3.0 STEP 2）：窄 Rail → hover/click → 展开
 * Workspace。覆盖验收链：收起基线 → hover 展开（324px 档）→ 选择工作空间
 * （真实持久化）→ 刷新后保持 → 鼠标离开收起；pin/Esc/键盘开合；最近使用
 * 真实数据；桌面 click-through（右键上下文菜单）不被展开面板破坏。
 */
test.describe('workspace panel', () => {
  async function registerDesktop(page: import('@playwright/test').Page, username: string): Promise<void> {
    await page.goto('/')
    const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
    await expect(loginForm).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '没有账户？创建一个' }).click()
    await page.getByLabel('用户名').fill(username)
    await page.getByLabel('密码').fill('secret123')
    await page.getByRole('button', { name: '注册' }).click()
    await page.getByTestId('sidebar').waitFor({ timeout: 15_000 })
    await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
  }

  async function railWidth(page: import('@playwright/test').Page): Promise<number> {
    return (await page.getByTestId('system-rails').boundingBox())!.width
  }

  async function expandByHover(page: import('@playwright/test').Page): Promise<void> {
    await page.getByTestId('sidebar').hover()
    await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')
    await expect.poll(railWidth.bind(null, page), { timeout: 3000 }).toBeGreaterThanOrEqual(300)
    expect(await railWidth(page)).toBeLessThanOrEqual(340)
  }

  async function collapseByLeave(page: import('@playwright/test').Page): Promise<void> {
    await page.mouse.move(640, 360)
    await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')
    await expect.poll(railWidth.bind(null, page), { timeout: 3000 }).toBeLessThanOrEqual(88)
  }

  test('收起 → hover 展开 → 选择工作空间 → 刷新后保持 → 鼠标离开收起', async ({ page }) => {
    await registerDesktop(page, 'ws-panel-e2e')

    // ① 收起基线：窄轨 72-88px、无 data-expanded。
    const rails = page.getByTestId('system-rails')
    expect(await rails.getAttribute('data-expanded')).toBeNull()
    expect(await railWidth(page)).toBeGreaterThanOrEqual(72)
    expect(await railWidth(page)).toBeLessThanOrEqual(88)
    // 收起态面板不可达（inert）。
    await expect(page.getByTestId('workspace-panel')).toHaveAttribute('aria-hidden', 'true')

    // ② hover 展开：300-340 档（token 324）。
    await expandByHover(page)

    // ③ 选择工作空间：aria-pressed 真实翻转 + selector 持久化。
    await page.getByTestId('workspace-option-study').click()
    await expect(page.getByTestId('workspace-option-study')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('workspace-option-personal')).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => localStorage.getItem('agehaos.workspace.v1'))).toBe('"study"')

    // ④ 刷新后保持：重读持久化数据，展开后选中态仍在。
    await page.reload()
    await page.getByTestId('sidebar').waitFor({ timeout: 15_000 })
    await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
    expect(await page.evaluate(() => localStorage.getItem('agehaos.workspace.v1'))).toBe('"study"')
    await expandByHover(page)
    await expect(page.getByTestId('workspace-option-study')).toHaveAttribute('aria-pressed', 'true')

    // ⑤ 鼠标离开收起（240ms 宽限 + 宽度过渡），动画收尾回窄轨。
    await collapseByLeave(page)
    expect(await railWidth(page)).toBeGreaterThanOrEqual(72)
  })

  test('click(pin)/Esc/键盘开合、最近使用真实数据、桌面 click-through 不被破坏', async ({ page }) => {
    await registerDesktop(page, 'ws-panel-e2e-2')

    // ① 真实数据：经 Rail 启动文件管理器 → 面板「最近使用」出现真实行。
    await page.getByTestId('sidebar-files').click()
    await expect(page.getByRole('region', { name: '文件' })).toBeVisible()
    await expandByHover(page)
    const recentRow = page.getByTestId('workspace-recent-item')
    await expect(recentRow).toHaveText(/文件/)

    // ② hover 态下点击品牌钮 = pin：鼠标移开不再收起。
    await page.getByTestId('sidebar-brand').click()
    await page.mouse.move(640, 360)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')

    // ③ Esc 收起 pin 态。
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')

    // ④ 键盘开合：聚焦品牌钮 → Enter 展开 → Esc 收起。
    await page.getByTestId('sidebar-brand').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')
    await expect(page.getByTestId('sidebar-brand')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')

    // ⑤ 桌面 click-through（收起态）：右键空白弹出上下文菜单。
    await page.mouse.click(300, 690, { button: "right" })
    await expect(page.getByTestId('context-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toBeHidden()

    // ⑥ click-through（pin 展开态）：面板外按下既收起面板、又落到桌面。
    await page.getByTestId('sidebar-brand').click()
    await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')
    await page.mouse.click(300, 690, { button: "right" })
    await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')
    await expect(page.getByTestId('context-menu')).toBeVisible()
  })
})
