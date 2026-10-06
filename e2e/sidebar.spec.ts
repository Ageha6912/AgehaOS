import { expect, test } from '@playwright/test'

/**
 * 左侧 Workspace Rail + Workspace Panel（Desktop Shell 3.0，docs/DESIGN.md
 * §34 双岛口径）：窄轨与面板是两块独立玻璃岛、顶锚菜单栏下方通高到 Dock
 * 上方；icon-first（可访问名走 aria-label，收起态气泡已退役）、轻
 * translucent capsule；真实动作轨——启动应用、共享启动器面板、共享通知中心。
 */
test('sidebar: floating narrow rail with working actions and capsules', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('sidebar-e2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })
  const vp = page.viewportSize()!

  // ① 双岛顶锚（§34）：窄轨岛 left 16px、宽 72-88px、顶边 = 菜单栏（32px）
  //    +12px、岛高撑满定位带（视口 − 顶 44 − 底 100）；面板岛收起态不存在。
  const rail = page.getByTestId('sidebar')
  const railBox = (await rail.boundingBox())!
  expect(railBox.x).toBeGreaterThanOrEqual(15.5)
  expect(railBox.x).toBeLessThanOrEqual(16.5)
  expect(railBox.width).toBeGreaterThanOrEqual(72)
  expect(railBox.width).toBeLessThanOrEqual(88)
  expect(Math.abs(railBox.y - 44)).toBeLessThanOrEqual(2)
  expect(Math.abs(railBox.height - (vp.height - 144))).toBeLessThanOrEqual(4)
  await expect(page.getByTestId('workspace-panel-island')).toHaveCount(0)

  // ② Rail 启动文件管理器（与 Dock/启动器正交的快捷入口）。
  await page.getByTestId('sidebar-files').click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()

  // ③ Workspace Panel：悬停条目即揭示独立面板岛（304px 档）——两岛顶边
  //    对齐、等高、岛间 ≥10px 缝隙；名称由面板常显承载（收起态 os-tooltip
  //    气泡已退役：hover 即展开，气泡不可达，终审遗留清理）；组容器与窄轨
  //    overflow 恒 visible 的 §26 契约不回归。
  const files = page.getByTestId('sidebar-files')
  // ② 的点击让指针留在轨内（面板已随动作收起）：先移出再悬停才有 mouseenter。
  await page.mouse.move(640, 660)
  await files.hover()
  await expect(rail).toHaveAttribute('data-expanded', 'true')
  const island = page.getByTestId('workspace-panel-island')
  await expect(island).toBeVisible()
  await expect
    .poll(async () => (await island.boundingBox())!.width, { timeout: 3000 })
    .toBeGreaterThanOrEqual(300)
  const islandBox = (await island.boundingBox())!
  expect(islandBox.x - (railBox.x + railBox.width)).toBeGreaterThanOrEqual(10)
  expect(Math.abs(islandBox.y - railBox.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(islandBox.height - railBox.height)).toBeLessThanOrEqual(2)
  await expect(files.locator('.os-tooltip')).toHaveCount(0)
  await expect(page.getByTestId('workspace-panel')).toBeVisible()
  const overflowPair = await page.getByTestId('system-rails').evaluate((el) => {
    const collect = (node: Element): string[] => {
      const style = getComputedStyle(node)
      return [style.overflowX, style.overflowY]
    }
    // 定位带 + 窄轨岛自身不得裁剪（面板岛 overflow-hidden 只裁自身内容）。
    return [...collect(el), ...collect(el.querySelector('[data-testid="sidebar"]')!)]
  })
  for (const overflow of overflowPair) {
    expect(overflow).toBe('visible')
  }
  // 鼠标离开（240ms 宽限 + 过渡）收起回窄轨。
  await page.mouse.move(vp.width / 2, vp.height / 2 + 120)
  await expect(rail).not.toHaveAttribute('data-expanded', 'true')
  // 岛间缝隙穿透桌面：pointer-events-none 的定位带不截胡点击
  // （elementFromPoint 落点不在 system-rails 子树内）。
  const gapHit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el?.closest('[data-testid="system-rails"]') !== null
    },
    [railBox.x + railBox.width + 7, railBox.y + 40],
  )
  expect(gapHit).toBe(false)

  // ④ 启动器项唤起共享启动器面板（launcher-store 与 Dock 触发器同源）。
  await page.getByTestId('sidebar-launcher').click()
  await expect(page.getByTestId('launcher-grid')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('launcher-grid')).toBeHidden()

  // ⑤ 通知项唤起与顶栏铃铛共享的面板；展开态 = 轻 translucent capsule
  //    （data-active 走 chrome 白玻璃 token，非实心色块）。
  const bell = page.getByTestId('sidebar-notifications')
  await bell.click()
  await expect(page.getByTestId('notification-panel')).toBeVisible()
  await expect(bell).toHaveAttribute('aria-expanded', 'true')
  await expect(bell).toHaveAttribute('data-active', 'true')
  // chrome 作用域 --ag-surface-raised = 白 16%：轻透 capsule 而非实心块。
  // （按钮带 120ms background-color 过渡——index.css :where(button) 基线，
  // 须等过渡落定再采样。）
  const capsuleAlpha = () =>
    bell.evaluate((el) => {
      const color = getComputedStyle(el).backgroundColor
      return color.startsWith('rgba') ? Number(color.slice(5, -1).split(',')[3]) : 1
    })
  await expect.poll(capsuleAlpha, { timeout: 2000 }).toBeGreaterThan(0)
  expect(await capsuleAlpha()).toBeLessThan(0.5)
  await bell.click()
  await expect(page.getByTestId('notification-panel')).toBeHidden()
  await expect(bell).toHaveAttribute('aria-expanded', 'false')

  // ⑥ 最近区（§22 P2-5）：用户启动出现在启动器「最近」。
  await page.mouse.move(640, 717)
  await page.waitForFunction(
    () => document.querySelector('footer[data-state]')?.getAttribute('data-state') === 'revealed',
    undefined,
    { timeout: 5000 },
  )
  await page.getByRole('contentinfo').getByRole('button', { name: /开始/ }).click()
  // §32 分类轨（组件卡「最近通知」/推荐行副标同含「最近」，testid 取位）。
  await expect(page.getByTestId('launcher-category-recent')).toBeVisible()
  await expect(page.getByTestId('launcher-recent-item').first()).toBeVisible()
})
