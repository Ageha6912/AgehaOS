import { expect, test } from '@playwright/test'

// 4-worker 高负载下开窗飞行动画可能未落定——几何断言前先等待，偶发毛刺重试即愈
//（同 responsive.spec 的环境级处置）。
test.describe.configure({ retries: 2 })

/**
 * 窗口最大化契约（§32.5 修订 12，2026-10-02 用户裁决）：最大化 = 整视口
 * 真全屏——横向贴左右屏幕边缘、上缘到屏幕顶、下缘到屏幕底，盖过菜单栏/
 * Dock/左右浮层栏全部 chrome（窗口层 z-[45]），不留任何系统栏带；还原走
 * 窗口标题栏。
 */
test('maximized window covers the entire screen above every chrome layer', async ({ page }) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`maximize-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 打开记事并最大化（按钮在窗口标题栏内；动态面板自动开启且同样有
  // 最大化按钮——定位器一律收窄到「记事」窗口区域内）。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  const region = page.getByRole('region', { name: '记事' })
  const maximize = region.getByRole('button', { name: '最大化窗口' })
  await expect(maximize).toBeVisible()
  await maximize.click()
  await page.waitForTimeout(450) // 开窗/层叠切换动画落定后再测量。
  const frame = region

  // ① 几何：x=0、y=0、宽=视口宽、高=视口高——无任何系统栏带留边。
  const vp = page.viewportSize() ?? { width: 1280, height: 720 }
  await expect(frame).toBeVisible()
  const box = (await frame.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(-0.5)
  expect(box.x).toBeLessThanOrEqual(1)
  expect(Math.abs(box.width - vp.width)).toBeLessThanOrEqual(1)
  expect(box.y).toBeGreaterThanOrEqual(-0.5)
  expect(box.y).toBeLessThanOrEqual(1)
  expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(1.5)

  // ② 遮挡：小组件栏（xl 可见，右侧 296px 带）与底部 Dock 带内取点都必须
  //    命中窗口——窗口层 z-[45] 盖过全部 z-40 chrome。
  const probe = await page.evaluate(
    ([right, bottom]) => {
      const win = document.querySelectorAll('section[aria-label="记事"]')[0]
      const hit = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y)
        return !!el && !!win && (el === win || win.contains(el))
      }
      return { hitRail: hit(right, 300), hitDockBand: hit(200, bottom) }
    },
    [vp.width - 150, vp.height - 20],
  )
  expect(probe.hitRail).toBe(true)
  expect(probe.hitDockBand).toBe(true)
  const layerZ = await page.evaluate(() => {
    const win = document.querySelectorAll('section[aria-label="记事"]')[0]
    const layer = win?.parentElement
    return layer ? getComputedStyle(layer).zIndex : ''
  })
  expect(layerZ).toBe('45')

  // ③ 还原：窗口回到原几何，窗口层回落 z-30。
  await region.getByRole('button', { name: '还原窗口' }).click()
  const restored = (await frame.boundingBox())!
  expect(restored.width).toBeLessThan(vp.width)
  expect(await frame.isVisible()).toBe(true)
})
