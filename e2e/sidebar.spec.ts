import { expect, test } from '@playwright/test'

/**
 * 左侧 Workspace Rail（Desktop Shell 3.0 STEP 1，docs/DESIGN.md §33.2 浮岛
 * 基线）：窄轨漂浮垂直居中、icon-first + os-tooltip、轻 translucent capsule；
 * 真实动作轨——启动应用、共享启动器面板、共享通知中心。
 */
test('sidebar: floating narrow rail with working actions, tooltips and capsules', async ({
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

  // ① 窄轨漂浮 + 垂直居中：left 16px、宽 72-88px、中线 ≈ 视口中线。
  const rail = page.getByTestId('system-rails')
  const railBox = (await rail.boundingBox())!
  expect(railBox.x).toBeGreaterThanOrEqual(15.5)
  expect(railBox.x).toBeLessThanOrEqual(16.5)
  expect(railBox.width).toBeGreaterThanOrEqual(72)
  expect(railBox.width).toBeLessThanOrEqual(88)
  expect(Math.abs(railBox.y + railBox.height / 2 - vp.height / 2)).toBeLessThanOrEqual(2)

  // ② Rail 启动文件管理器（与 Dock/启动器正交的快捷入口）。
  await page.getByTestId('sidebar-files').click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()

  // ③ 悬停 tooltip 完整可见：锚定条目右缘向右伸出；轨道容器（及祖先）
  //    overflow 恒 visible——§26 教训（overflow-y 连带裁剪 tooltip）不回归。
  const files = page.getByTestId('sidebar-files')
  await files.hover()
  await expect(files.locator('.os-tooltip')).toHaveCSS('opacity', '1', { timeout: 2000 })
  const buttonBox = (await files.boundingBox())!
  const tooltipBox = (await files.locator('.os-tooltip').boundingBox())!
  expect(tooltipBox.x).toBeGreaterThanOrEqual(buttonBox.x + buttonBox.width + 7)
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(vp.width)
  expect(tooltipBox.y).toBeGreaterThanOrEqual(0)
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(vp.height)
  const overflowPair = await rail.evaluate((el) => {
    const collect = (node: Element): string[] => {
      const style = getComputedStyle(node)
      return [style.overflowX, style.overflowY]
    }
    // 组容器 + 轨 nav 自身不得裁剪（桌面画布根的 overflow-hidden 不在此列）。
    return [...collect(el), ...collect(el.querySelector('[data-testid="sidebar"]')!)]
  })
  for (const overflow of overflowPair) {
    expect(overflow).toBe('visible')
  }
  await page.mouse.move(vp.width / 2, vp.height / 2 + 120)

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
