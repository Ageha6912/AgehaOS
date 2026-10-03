import { expect, test } from '@playwright/test'

import { taskbarStartButton } from './helpers'

/**
 * 底部 Dock（docs/DESIGN.md §9/§20 + §32 修订 8，2026-10-01 用户裁决）：
 * **常驻显示**——自动隐藏机制已移除（唤出区/收起定时器退役），Dock 恒为
 * 可见状态；开始菜单/常驻瓷贴/回收站直接可用，无需任何唤出动作。
 */
test('taskbar 常驻：默认可见、不自动隐藏、开始菜单与瓷贴直达', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`dock-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  const bar = page.getByRole('contentinfo')
  // 常驻：无任何交互即为可见状态。
  await expect(bar).toHaveAttribute('data-state', 'revealed')

  // 指针移开（等待超过原收起缓冲 400ms）仍常驻。
  await page.mouse.move(640, 200)
  await page.waitForTimeout(700)
  await expect(bar).toHaveAttribute('data-state', 'revealed')

  // 直接点开始（无需唤出）打开启动器，Esc 关闭。
  await taskbarStartButton(page).click()
  await expect(page.getByRole('list', { name: /开始/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // 常驻瓷贴直达：点击文件管理瓷贴启动应用。
  await page.getByTestId('dock-pin-com.ageha.files').click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()
})

/**
 * Dock 悬停预览锚定（§12/§32，2026-10-01 用户报告回归）：预览必须悬在
 * 图标正上方。玻璃胶囊的 backdrop-filter 会成为 fixed 后代的包含块，
 * 视口坐标 left 被加上胶囊偏移、预览被推到屏幕右缘——修复后预览经
 * createPortal 挂 body，包含块回归视口。
 */
test('taskbar 悬停预览：锚定图标上方、不偏移到屏幕右缘', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`preview-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 有运行中窗口的瓷贴才有预览：先点瓷贴启动文件管理。
  const pin = page.getByTestId('dock-pin-com.ageha.files')
  await pin.click()
  await expect(page.getByRole('region', { name: '文件' })).toBeVisible()

  // 移开再悬停（窗口打开后 mouseEnter 处理器才带窗口语义）。
  await page.mouse.move(640, 200)
  await pin.hover()
  const preview = page.getByTestId('window-preview')
  await expect(preview).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(450) // 弹入动画落定后再测量。

  // 预览经 portal 挂在 body 上，不在 footer 子树内。
  expect(await preview.evaluate((el) => el.parentElement === document.body)).toBe(true)
  expect(await preview.evaluate((el) => el.closest('footer'))).toBeNull()

  // 几何契约：横向以图标中心居中（2026-10-01 用户裁决：左缘对齐会视觉
  // 偏右）、纵向悬在图标上方、完整在视口内。
  const icon = await pin.boundingBox()
  const box = await preview.boundingBox()
  expect(icon).not.toBeNull()
  expect(box).not.toBeNull()
  const vw = page.viewportSize()?.width ?? 0
  const iconCenterX = icon!.x + icon!.width / 2
  const previewCenterX = box!.x + box!.width / 2
  expect(Math.abs(previewCenterX - iconCenterX)).toBeLessThanOrEqual(2)
  expect(box!.y + box!.height).toBeLessThanOrEqual(icon!.y + 2)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw)

  // 瓷贴按钮不画底色（2026-10-01 用户裁决：44px 图标坐在 48px 按钮里，
  // hover/active 浅底在玻璃胶囊上显成图标四周的白边）——悬停时背景仍透明。
  const hoverBg = await pin.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(hoverBg).toBe('rgba(0, 0, 0, 0)')

  // 悬停桥（2026-10-02 用户裁决：指针可移入预览）——离开图标预览不立即
  // 消失，移入预览后驻留，移出预览才收卡。
  const previewBox = (await preview.boundingBox())!
  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2)
  await page.waitForTimeout(500) // 越过 240ms 宽限窗，验证驻留。
  await expect(preview).toBeVisible()
  await page.mouse.move(640, 120) // 移出预览（远离 Dock）。
  await page.waitForTimeout(500)
  await expect(preview).toBeHidden()
})
