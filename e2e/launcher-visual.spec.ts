import { expect, test, type Page } from '@playwright/test'

/**
 * Shell 3.0 STEP 8 启动器精修契约（几何/材质全部 Playwright 探针实测，
 * 禁止心算 rem）：
 * - 居中 Ageha Application Launcher：视口水平居中的大幅玻璃面板，
 *   宽 560-680 档（实现 600），固定高 560（Shell 3.1 场景 F：分类网格随世界清单扩到两行，520 档裁第二行瓦片名称标签——高度档同步抬升）；不压菜单栏带与 Dock 带。
 * - 材质 = popover-panel 深玻璃：44px backdrop blur + 白86% 面 + 16px
 *   弹层圆角 + shadow-popover 档（§33.1 材质表⑥）。
 * - 结构序 Search → Recent → Pinned → Categories（DOM 序探针）。
 * - 键盘导航：↑↓ 移动 data-active 高亮、Enter 启动（打开 app 行为回归）。
 * 截图取证写 .tmp/shots/（gitignored，永不入库）。
 */

async function register(page: Page): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`launcher-vis-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
}

const openLauncher = async (page: Page): Promise<void> => {
  await page.getByRole('contentinfo').getByRole('button', { name: /开始/ }).click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(450) // 弹入动画落定后再探针。
}

test('launcher: centered large glass panel with Search → Recent → Pinned → Categories', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await register(page)

  // 先产生一条真实「最近使用」（Dock 瓷贴 = launchApp source='user'），
  // 再关窗——Recent 区只认 usage-store 真数据，无数据不渲染该区。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  const notes = page.getByRole('region', { name: '记事' })
  await expect(notes).toBeVisible()
  await notes.getByRole('button', { name: '关闭窗口' }).click()
  await expect(notes).toBeHidden()

  await openLauncher(page)

  // 几何：宽 600（560-680 档）× 高 560（Shell 3.1 场景 F 抬档，见文件头）；水平中心 = 视口中心（±2px）；
  // 面板整体落在菜单栏带之下、Dock 带之上（Dock 顶 = 1080 − 68 − 20 = 992）。
  const box = (await page.getByRole('list', { name: /开始/ }).boundingBox())!
  expect(Math.abs(box.width - 600)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.height - 560)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThanOrEqual(2)
  expect(box.y).toBeGreaterThanOrEqual(32)
  expect(box.y + box.height).toBeLessThanOrEqual(992)

  // 材质（§33.1 ⑥ 弹层深玻璃）：44px blur + 白86% 玻璃面 + 16px 弹层圆角
  // + shadow-popover 档大气软影。
  const visual = await page.evaluate(() => {
    const el = document.querySelector('menu[aria-label="开始"]')
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
  expect(visual!.radius).toBe('16px')
  expect(visual!.shadow).toContain('0px 24px 64px')

  // 结构序：Search → Recent → Pinned → Categories（DOM 序 = 视觉/Tab 序）。
  const inOrder = await page.evaluate(() => {
    const ids = ['launcher-search', 'launcher-recent-list', 'launcher-pinned-list']
    const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`))
    if (nodes.some((node) => !node)) return false
    return nodes.every(
      (node, index) =>
        index === 0 ||
        (nodes[index - 1]!.compareDocumentPosition(node!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
  })
  expect(inOrder).toBe(true)
  // Recent 区内容来自真实 usage-store（刚启动并关闭的「记事」置顶）。
  await expect(page.getByTestId('launcher-recent-item')).toHaveText(/记事/)

  // 分类芯片保留 aria-pressed 契约（默认「最近使用」选中）。
  await expect(page.getByTestId('launcher-category-recent')).toHaveAttribute('aria-pressed', 'true')

  // 对照截图：居中启动器全貌（指针已移开，避免 Dock 悬停态入镜）。
  await page.mouse.move(10, 300)
  await page.screenshot({ path: '.tmp/shots/step8-launcher-centered.png' })
})

test('launcher keyboard: arrows move the highlight, Enter opens the app (行为回归)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await register(page)

  await openLauncher(page)

  // 打开即聚焦搜索框；高亮落在扁平动作序第一项（空最近 → Pinned 行首「文件」）。
  await expect(page.getByTestId('launcher-search')).toBeFocused()
  let activeName = await page.evaluate(() => {
    const el = document.querySelector('menu[aria-label="开始"] [data-active="true"]')
    return el?.textContent ?? ''
  })
  expect(activeName).toContain('文件')

  // ↓ 高亮移到下一项（Pinned 第二枚「记事」）→ Enter 启动：面板关闭、开窗。
  await page.keyboard.press('ArrowDown')
  activeName = await page.evaluate(() => {
    const el = document.querySelector('menu[aria-label="开始"] [data-active="true"]')
    return el?.textContent ?? ''
  })
  expect(activeName).toContain('记事')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '记事' })).toBeVisible()
  await expect(page.getByRole('list', { name: /开始/ })).toBeHidden()
})
