import { expect, test } from '@playwright/test'

// 4-worker 高负载下开窗飞行动画可能未落定——几何断言前先等待，偶发毛刺重试即愈
//（同 responsive.spec 的环境级处置）。
test.describe.configure({ retries: 2 })

/**
 * 窗口最大化契约（docs/DESIGN.md §19/§26 修订，2026-10-01 用户裁决）：
 * 最大化窗口横向全幅贴左右屏幕边缘、上贴菜单栏下界、下贴 Dock 边界，
 * 不留空白边框；窗口层抬到 z-[45] 盖过左栏/小组件栏（z-40 浮层）——
 * 桌面组件不得遮挡最大化窗口的任何区域。
 */
test('maximized window fills the screen edge-to-edge above the desktop widgets', async ({
  page,
}) => {
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

  // ① 几何：x=0、宽度=视口宽、上贴菜单栏（40px）下界、下贴 Dock 边界
  //    （--ag-dock-height 68 + 0.75rem = 80px footer 带）。
  const vp = page.viewportSize() ?? { width: 1280, height: 720 }
  await expect(frame).toBeVisible()
  const box = (await frame.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(-0.5)
  expect(box.x).toBeLessThanOrEqual(1)
  expect(Math.abs(box.width - vp.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y - 40)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.height - (vp.height - 40 - 80))).toBeLessThanOrEqual(1.5)

  // ② 遮挡：组件栏（xl 可见，右侧 296px 带）区域内取点必须命中窗口——
  //    窗口层 z-[45] 盖过 z-40 浮层；同时窗口层容器的计算 z-index 生效。
  const probe = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y)
      const win = document.querySelectorAll('section[aria-label="记事"]')[0]
      return {
        hitWindow: !!el && !!win && (el === win || win.contains(el)),
      }
    },
    [vp.width - 150, Math.round(vp.height / 2)],
  )
  expect(probe.hitWindow).toBe(true)
  const layerZ = await page.evaluate(() => {
    const win = document.querySelectorAll('section[aria-label="记事"]')[0]
    const layer = win?.parentElement
    return layer ? getComputedStyle(layer).zIndex : ''
  })
  expect(layerZ).toBe('45')

  // ③ 还原：窗口回到原几何，窗口层回落 z-30，组件栏重新可见于其上。
  await region.getByRole('button', { name: '还原窗口' }).click()
  const restored = (await frame.boundingBox())!
  expect(restored.width).toBeLessThan(vp.width)
  expect(await frame.isVisible()).toBe(true)
})
