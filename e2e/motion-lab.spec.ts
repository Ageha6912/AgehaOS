import { expect, test } from '@playwright/test'

import { taskbarStartButton } from './helpers'

/**
 * 动效实验室集成契约（docs/DESIGN.md §15/§32.5 修订 10，2026-10-01 用户裁决）：
 * 进阶炫技档四项 + 指针光晕默认开——流光氛围画布、主题光晕呼吸、Dock 扫光
 * 覆盖层在桌面就位；波浪域覆盖瓷贴（图标随指针放大）；设置「外观」五开关
 * 可即时关闭对应效果。
 */
test.describe.configure({ retries: 2 })

test('motion lab: aurora/glow/sheen present, wave covers pins, toggles cut effects', async ({
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

  // ② 波浪域覆盖瓷贴：悬停瓷贴图标 → 波浪引擎写入放大 transform。
  const terminalPin = page.getByTestId('dock-pin-com.ageha.terminal')
  await terminalPin.hover()
  await page.waitForTimeout(300) // 波浪包络进入（120ms）+ 帧写入。
  const wave = await terminalPin
    .locator('[data-wave-icon]')
    .evaluate((el) => el.style.transform)
  expect(wave).toContain('scale')

  // ②b 运行中行（动态面板图标所在）滚动条 UI 隐藏：波浪 1.5× 变换边界会
  //    撑出可滚动区域，滚动条不得随悬停闪现（修订 11）。
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
