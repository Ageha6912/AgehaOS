import { expect, test } from '@playwright/test'

import { openDynamicPanel } from './helpers'

// Chromium 在 4-worker 高负载 + 375px 仿真视口下曾现「absolute 底座相对其
// 包含块整体偏移 -33px」的反盒模型布局态（探针实证：画布 x=0/w=375、无滚动、
// 无变换，footer left:0 right:0 却量得 -33；单跑与成对跑永不复现）——属环境
// 级毛刺，重试即愈。真实断言（§25 契约）不变。
test.describe.configure({ retries: 2 })

/**
 * 响应式兜底（docs/DESIGN.md §25，升级提示词 §26）：窄视口（375px）下
 * 不崩——无横向 overflow、顶栏不撑爆、自动开窗不超视口、启动器在视口内。
 * 完整移动端 UX 属后续 Phase，这里只钉「不坏」。
 */
test('responsive: 375px viewport stays usable without horizontal overflow (§25)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('responsive-e2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  await page.getByTestId('menu-bar').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(800)

  // ① 无横向 overflow（滚动宽度不超视口）。
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement as HTMLElement | null
    return { scrollWidth: el?.scrollWidth ?? 0, clientWidth: el?.clientWidth ?? 0 }
  })
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

  // ② 顶栏完整在视口内（窄屏菜单标签已收起，品牌 + 状态保留）。
  const bar = await page.getByTestId('menu-bar').boundingBox()
  expect(bar).not.toBeNull()
  expect(bar!.x).toBeGreaterThanOrEqual(0)
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(375.5)

  // ③ 手动打开的动态面板不超视口（launch 钳制 §25；2026-10-02 起不再自动
  //    开窗，钳制契约对手动开窗同样成立）。
  // 坑（§30/§32）：waitFor 可见 ≠ 开窗动画完成，且弹性飞行可能重放——
  // 等「内联位姿已清除（落定）+ x≥0」再读数。
  const panel = await openDynamicPanel(page)
  await page.waitForFunction(
    () => {
      const region = document.querySelector('[aria-label="动态面板"]')
      const frame = region?.parentElement?.parentElement as HTMLElement | null
      return !!frame && frame.style.transform === '' && frame.getBoundingClientRect().x >= 0
    },
    undefined,
    { timeout: 10_000 },
  )
  const panelBox = await panel.boundingBox()
  expect(panelBox!.x).toBeGreaterThanOrEqual(0)
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(375.5)

  // ④ Dock 唤出 + 启动器面板在视口内。
  await page.mouse.move(187, 809)
  await page.waitForFunction(
    () => document.querySelector('footer')?.getAttribute('data-state') === 'revealed',
    undefined,
    { timeout: 5000 },
  )
  await page.getByRole('contentinfo').getByRole('button', { name: /开始/ }).click()
  const menu = page.getByRole('list', { name: /开始/ })
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(375.5)
})
