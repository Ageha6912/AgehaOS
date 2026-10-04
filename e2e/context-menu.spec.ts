import { expect, test } from '@playwright/test'

/**
 * 桌面右键上下文菜单（DESIGN.md §14 遗留项）：空白处右键弹出、视口收拢、
 * 菜单项可用（更换壁纸 / 打开应用商店 / 打开设置）、Esc 关闭。
 */
test('desktop context menu: open at pointer, clamp to viewport, run actions', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('ctxmenu2e')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  // 桌面图标层已移除（2026-10-01）：以侧栏就绪为桌面就绪信号。
  await page.getByTestId('sidebar-files').waitFor()

  // 右键工作区右缘附近空白：§32 右侧小组件栏占 944-1272×48-712（顶 48 =
  // 菜单栏 32px + 16px，Shell 2.0 精修；品牌横幅卡压到 y≈712）、动态面板
  // 横版占 240-920×64-484——(935, 660) 是面板/侧栏/小组件栏之间的稳定空白；
  // 菜单底边须收进视口。
  await page.mouse.click(935, 660, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)

  // 更换壁纸：菜单关闭（节流内壁纸可能不换，但动作触发不报错）
  await page.getByTestId('context-menu-renew-wallpaper').click()
  await expect(menu).toBeHidden()

  // 再开 → 打开设置（设置窗经级联 176 起锚、右缘约 836；取其与右侧小组件
  // 栏 964 起之间的稳定空白；拉伸后的系统栏组占 16-166 全高）。
  await page.mouse.click(900, 400, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.getByTestId('context-menu-open-settings').click()
  await expect(page.getByRole('region', { name: '设置' })).toBeVisible()
  await expect(menu).toBeHidden()

  // 再开 → Esc 关闭（级联 176 + 840×560 的设置窗经入屏钳制占 176-1016×
  // 152-712，下部已被覆盖——取其上方的壁纸带；窗口/图标上不出菜单是预期）。
  await page.mouse.click(400, 120, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
