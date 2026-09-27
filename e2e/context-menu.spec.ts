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
  await page.getByTestId('desktop-icon-com.ageha.files').waitFor()

  // 右键视口右下角空白（远离图标列/面板/窗口）：菜单必须收进视口内
  await page.mouse.click(1265, 700, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)

  // 更换壁纸：菜单关闭（节流内壁纸可能不换，但动作触发不报错）
  await page.getByTestId('context-menu-renew-wallpaper').click()
  await expect(menu).toBeHidden()

  // 再开 → 打开设置
  await page.mouse.click(400, 400, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.getByTestId('context-menu-open-settings').click()
  await expect(page.getByRole('region', { name: '设置' })).toBeVisible()
  await expect(menu).toBeHidden()

  // 再开 → Esc 关闭（点空白处：设置窗口已盖住 400,400，窗口上不出菜单是预期行为）
  await page.mouse.click(100, 500, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})
