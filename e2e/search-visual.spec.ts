import { expect, test, type Page } from '@playwright/test'

/**
 * Shell 3.0 STEP 9 全局搜索精修契约（几何/材质全部 Playwright 探针实测，
 * 禁止心算 rem）：
 * - Raycast/Spotlight 形态：视口居中 640px（600-720 档）大玻璃面板；
 *   材质 = glass-popover 弹层深玻璃（44px blur + 白86% 面 + 20px radius-xl
 *   + shadow-popover 档，§33.1 材质表⑥；主入口大面 radius-XL 见 §2.2）。
 * - 结构序 Search → Apps → Files → Actions（DOM 序探针；想象域落位
 *   Actions 区，恒排两域之后——羽化入口保留）。
 * - 三域结果都在（应用 + 文件 + 想象同一视图）、键盘可达（Ctrl+K 呼出、
 *   ↑↓/Enter 开窗、Esc 关闭，全程不碰鼠标）。
 * 截图取证写 .tmp/shots/（gitignored，永不入库）。
 */

async function register(page: Page): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`search-vis-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
}

/**
 * 模拟「远程模式下已开启羽化」（eclosion.spec 同款手法）：按真实 userId 写
 * 按用户分键的持久化偏好再 reload——本地认证下无法经 UI 开启（置灰是 §9.3
 * 准入裁决）。想象行只验可见性，不按 Enter（无生成、无需后端桩）。
 */
async function seedEclosionEnabled(page: Page): Promise<void> {
  const userId = await page.evaluate(() => {
    const raw = localStorage.getItem('agehaos.session.v1') ?? ''
    const parsed = JSON.parse(raw) as { userId?: string }
    if (!parsed.userId) throw new Error(`no session userId in ${raw}`)
    return parsed.userId
  })
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ enabled: true, modes: {} }))
  }, `agehaos.eclosion.prefs.v1.${userId}`)
  await page.reload()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
}

test('search: centered Raycast panel, three domains in one view, keyboard-only (STEP 9)', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await register(page)

  // 造一条真实 VFS 文件（经记事应用，core-path 同款路径），同时产生一条
  // 真实「最近使用」（Ctrl+K → Enter 启动 = launchApp source='user'）。
  await page.keyboard.press('Control+k')
  const input = page.getByTestId('search-input')
  await expect(input).toBeVisible()
  await input.fill('记事')
  await input.press('Enter')
  const notes = page.getByRole('region', { name: '记事' })
  await expect(notes).toBeVisible()
  await page.getByRole('button', { name: '新建文本文件' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('记事备忘.txt')
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click()
  const editor = page.getByRole('textbox', { name: '笔记编辑器' })
  await expect(editor).toBeVisible()
  await editor.fill('step9 visual probe')
  const saveButton = page.getByRole('button', { name: '保存' })
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(saveButton).toBeDisabled()
  await notes.getByRole('button', { name: '关闭窗口' }).click()
  await expect(notes).toBeHidden()

  // 羽化开启态 hydrate（想象域门控的另一半场）。
  await seedEclosionEnabled(page)

  // Ctrl+K 呼出：空查询 = 真实「最近使用」速览（刚才搜索启动的记事置顶）。
  await page.keyboard.press('Control+k')
  const palette = page.getByTestId('search-palette')
  await expect(palette).toBeVisible()
  await expect(palette.getByTestId('search-result-recent').first()).toBeVisible()
  await expect(page.getByTestId('search-recent-list')).toContainText('记事')

  // 几何：宽 640（600-720 Raycast 档）；水平中心 = 视口中心（±2px）；
  // 面板整体落在菜单栏带（32px）之下、Dock 带（顶 = 1080 − 68 − 20 = 992）之上。
  const box = (await palette.boundingBox())!
  expect(Math.abs(box.width - 640)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThanOrEqual(2)
  expect(box.y).toBeGreaterThanOrEqual(32)
  expect(box.y + box.height).toBeLessThanOrEqual(992)

  // 材质（§33.1 ⑥ 弹层深玻璃）：44px blur + 白86% 玻璃面 + 20px radius-xl
  // + shadow-popover 档大气软影。
  const visual = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="search-palette"]')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      blur: style.backdropFilter,
      background: style.backgroundColor,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    }
  })
  expect(visual).not.toBeNull()
  expect(visual!.blur).toContain('blur(44px)')
  expect(visual!.background).toBe('rgba(255, 255, 255, 0.86)')
  expect(visual!.radius).toBe('20px')
  expect(visual!.shadow).toContain('0px 24px 64px')

  // 三域一屏（「记事」）：应用（记事）+ 文件（记事备忘.txt）+ 想象
  // （✦ 即时羽化「记事」应用）；结构序 Search → Apps → Files → Actions。
  await page.getByTestId('search-input').fill('记事')
  await expect(page.getByTestId('search-result-app')).toContainText('记事')
  await expect(page.getByTestId('search-result-file')).toContainText('记事备忘.txt')
  const imagine = page.getByTestId('search-result-imagine')
  await expect(imagine).toContainText('即时羽化「记事」应用')

  const inOrder = await page.evaluate(() => {
    const ids = [
      'search-input',
      'search-result-app',
      'search-result-file',
      'search-result-imagine',
      'search-footer',
    ]
    const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`))
    if (nodes.some((node) => !node)) return false
    return nodes.every(
      (node, index) =>
        index === 0 ||
        (nodes[index - 1]!.compareDocumentPosition(node!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
  })
  expect(inOrder).toBe(true)

  // 键盘全程可达：Esc 关闭 → Ctrl+K 重呼 → Enter（活动项 = 应用域首行）
  // 开窗——面板关闭、记事窗口在场。
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('search-input')).toBeFocused()
  await page.getByTestId('search-input').fill('记事')
  await expect(imagine).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '记事' })).toBeVisible()
  await expect(palette).toHaveCount(0)

  // 对照截图：三域一屏的 Spotlight 全貌（收尾前关窗重开一帧取证）。
  await page.getByRole('region', { name: '记事' }).getByRole('button', { name: '关闭窗口' }).click()
  await expect(page.getByRole('region', { name: '记事' })).toBeHidden()
  await page.keyboard.press('Control+k')
  await page.getByTestId('search-input').fill('记事')
  await expect(imagine).toBeVisible()
  await page.waitForTimeout(450) // 弹入动画落定后再拍。
  await page.mouse.move(10, 300)
  await page.screenshot({ path: '.tmp/shots/step9-search-spotlight.png' })
})
