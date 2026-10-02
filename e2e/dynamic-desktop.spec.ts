import { expect, test } from '@playwright/test'

/**
 * AI 动态桌面验收（设计文档 §11.2-A ⑨⑩ + §32 参考图对齐重裁决）：
 * 出厂默认 = 照片基底壁纸（§32 参考图同源素材），动态桌面默认关；
 * 开启动态桌面后 gradient-field 场以覆盖层淡入（canvas 绘制，AI 徽标按
 * 裁决不显示）；关闭后回落照片基底（opt-out 语义）。
 */
test('dynamic desktop: photo wallpaper by default, opt-in field rendering, opt-out restores photo', async ({
  page,
}) => {
  await page.goto('/')

  // 注册并进入桌面（自动登录）。
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`dynamice2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // §32 默认：照片基底常驻，无场渲染面。
  await expect(page.getByTestId('wallpaper-layer')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('wallpaper-surface-photo')).toBeVisible()
  await expect(page.getByTestId('wallpaper-surface-canvas')).toHaveCount(0)
  await expect(page.getByTestId('ai-badge')).toHaveCount(0)

  // 照片态右键契约照常（空白画布右键出菜单，Esc 收起）。
  await page.mouse.click(200, 400, { button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  await page.keyboard.press('Escape')

  // 设置 → 动态桌面：开关出厂处于关闭位。
  await page.getByTestId('sidebar-settings').click()
  await page.getByRole('button', { name: '动态桌面' }).click()
  const toggle = page.getByTestId('dynamic-desktop-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  // 开启：field 场面（canvas）淡入照片之上；关窗还桌面。
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('wallpaper-surface-canvas')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('region', { name: '设置' }).getByRole('button', { name: '关闭窗口' }).click()

  // 右键菜单「更换壁纸」：seed 变化驱动 canvas 重绘（同款构图或新构图都合法）。
  // §30 横版面板占 240-920×64-484（§32 让位 336px 右栏），(200,400) 在面板
  // 左侧稳定空白区（左栏 16-92，Shell 2.0 浮岛：80px 栏 + left 16px；契约不变：空白画布右键出菜单）。
  await page.mouse.click(200, 400, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await page.getByTestId('context-menu-renew-wallpaper').click()
  await expect(menu).toBeHidden()
  await expect(page.getByTestId('wallpaper-surface-canvas')).toBeVisible()

  // 关闭：opt-out 回落照片基底。
  await page.getByTestId('sidebar-settings').click()
  await page.getByRole('button', { name: '动态桌面' }).click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('wallpaper-surface-canvas')).toHaveCount(0)
  await expect(page.getByTestId('wallpaper-surface-photo')).toBeVisible()
})
