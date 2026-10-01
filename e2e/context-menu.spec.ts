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

  // 右键工作区右下角空白：P2-3 起右侧小组件栏占 1008-1280、动态面板横版后占
  // 344-1024×52-472（§30）——(990, 700) 是右缘附近稳定空白；菜单底边须收进视口。
  await page.mouse.click(990, 700, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)

  // 更换壁纸：菜单关闭（节流内壁纸可能不换，但动作触发不报错）
  await page.getByTestId('context-menu-renew-wallpaper').click()
  await expect(menu).toBeHidden()

  // 再开 → 打开设置（面板左侧空白：左栏 0-80、面板 344 起）
  await page.mouse.click(200, 400, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.getByTestId('context-menu-open-settings').click()
  await expect(page.getByRole('region', { name: '设置' })).toBeVisible()
  await expect(menu).toBeHidden()

  // 再开 → Esc 关闭（点设置窗下方空白；窗口/图标上不出菜单是预期行为）
  await page.mouse.click(300, 690, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
