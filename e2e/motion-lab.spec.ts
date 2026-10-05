import { expect, test } from '@playwright/test'

import { taskbarStartButton } from './helpers'

/**
 * 动效实验室集成契约（docs/DESIGN.md §15/§32.5 修订 10，2026-10-01 用户裁决；
 * §13 悬停浮起修订 2026-10-02 + 波浪恢复 2026-10-05 用户裁决）：进阶炫技档
 * 四项 + 指针光晕默认开——流光氛围画布、主题光晕呼吸、Dock 扫光覆盖层在桌面
 * 就位；Dock 悬停枚强浮起（CSS）+ 邻位高斯轻浮（Taskbar 波浪引擎，inline）；
 * 设置「外观」开关可即时关闭对应效果。
 */
test.describe.configure({ retries: 2 })

test('motion lab: aurora/glow/sheen present, hovered dock icon lifts alone, toggles cut effects', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`motion-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(450) // 开场动画落定。

  // ① 三层氛围挂载：流光画布 / 主题光晕（呼吸中）/ Dock 扫光覆盖层。
  await expect(page.getByTestId('aurora-canvas')).toBeAttached()
  await expect(page.getByTestId('ambient-glow')).toHaveClass(/is-on/)
  await expect(page.getByTestId('dock-sheen')).toBeAttached()

  // ② 悬停强浮起 + 邻位波浪（2026-10-05 裁决）：悬停瓷贴 → 该图标 computed
  //    transform = 强浮起（scale 1.18，CSS hover 域）；相邻瓷贴（terminal 与
  //    store 在常驻序相邻，节距 56 = σ）= 波浪轻浮（scale 1 < n < 1.18，
  //    Taskbar 引擎 inline 域）；隔两枚以上（files 距 terminal 3σ）已出波浪
  //    截止，transform 归 none。
  const terminalPin = page.getByTestId('dock-pin-com.ageha.terminal')
  const storePin = page.getByTestId('dock-pin-com.ageha.store')
  const filesPin = page.getByTestId('dock-pin-com.ageha.files')
  const computedTransform = (locator: ReturnType<typeof page.getByTestId>) =>
    locator.locator('[data-wave-icon]').evaluate((el) => getComputedStyle(el).transform)
  const scaleOf = (matrix: string) => Number(matrix.slice(7, matrix.indexOf(',')))
  await terminalPin.hover()
  await page.waitForTimeout(500) // CSS hover 380ms + 波浪 inline 220ms 落定。
  const hoveredTransform = await computedTransform(terminalPin)
  const neighborTransform = await computedTransform(storePin)
  expect(hoveredTransform).toContain('matrix')
  expect(scaleOf(hoveredTransform)).toBeCloseTo(1.18, 1)
  expect(neighborTransform).toContain('matrix')
  const neighborScale = scaleOf(neighborTransform)
  expect(neighborScale).toBeGreaterThan(1)
  expect(neighborScale).toBeLessThan(1.18)
  expect(await computedTransform(filesPin)).toBe('none')

  // ②b 移开指针：浮起与波浪一并回落归位。
  await page.mouse.move(960, 300)
  await page.waitForTimeout(300)
  expect(await computedTransform(terminalPin)).toBe('none')
  expect(await computedTransform(storePin)).toBe('none')

  // ②c 运行中行滚动条 UI 隐藏：浮起 scale 变换边界会撑出可滚动区域，
  //    滚动条不得随悬停闪现（修订 11）。
  const scrollbarWidth = await page
    .getByTestId('dock-running-row')
    .evaluate((el) => getComputedStyle(el).scrollbarWidth)
  expect(scrollbarWidth).toBe('none')

  // ③ 菜单浮层可开（进场动效语言由 pop-motion 单测钉扎，此处验证链路通）。
  await taskbarStartButton(page).click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // ④ 设置「外观」五开关：关流光 → 画布淡出；关主题光晕 → 呼吸类摘除。
  await page.getByTestId('dock-pin-com.ageha.settings').click()
  await expect(page.getByTestId('motion-aurora-toggle')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('motion-aurora-toggle').click()
  await expect(page.getByTestId('aurora-canvas')).toHaveJSProperty('style.opacity', '0')
  await page.getByTestId('motion-theme-glow-toggle').click()
  await expect(page.getByTestId('ambient-glow')).not.toHaveClass(/is-on/)

  // ⑤ 即时恢复：重新打开 → 效果回归。
  await page.getByTestId('motion-aurora-toggle').click()
  await expect(page.getByTestId('aurora-canvas')).toHaveJSProperty('style.opacity', '0.2')
})
