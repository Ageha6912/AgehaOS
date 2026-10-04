import { expect, test } from '@playwright/test'

/**
 * 窗口八向拖拽缩放（docs/DESIGN.md §21 补充，2026-10-02 用户裁决「自由改变
 * 大小」）：边缘 6px + 角 14px 命中区；西缘拖拽带位置补偿（左缘跟手）。
 * 角柄外半段被圆角+overflow-hidden 裁剪属已知几何——测试一律抓柄的内侧点。
 * 断言用「向内收缩的精确值 + 向外增大」——向外受工作区钳制（视口 1280 下
 * 上限 = 1280-左栏 80-右栏 296-窗 x 80 = 824），精确值会耦合 Token 几何。
 */
test('window resize: free edge/corner drag grows and shrinks with west compensation', async ({
  page,
}) => {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`resize-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)

  await page.getByTestId('dock-pin-com.ageha.files').click()
  const region = page.getByRole('region', { name: '文件' })
  await expect(region).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(900) // 开窗飞行落定（坑：waitFor 可见 ≠ 动画完成）。

  // 八向柄全部在位。
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    await expect(page.getByTestId(`window-resize-${dir}`)).toBeAttached()
  }

  // 级联起点 176 让 SE 角落在右栏遮盖带（1280 视口下 ≥964）内——先把窗口
  // 拖左 96px（x→80），SE 角回到右栏左侧的可达区。
  const cascadeBox = (await region.boundingBox())!
  expect(cascadeBox.width).toBeGreaterThan(400)
  await page.mouse.move(cascadeBox.x + 220, cascadeBox.y + 14)
  await page.mouse.down()
  await page.mouse.move(cascadeBox.x + 124, cascadeBox.y + 14, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const before = (await region.boundingBox())!
  expect(before.width).toBeGreaterThan(400)


  // SE 角向内拖 (-120, -80)：精确收缩。抓柄内侧点（避开圆角裁剪死区）。
  await page.mouse.move(before.x + before.width - 10, before.y + before.height - 10)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width - 130, before.y + before.height - 90, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const shrunk = (await region.boundingBox())!
  expect(Math.abs(shrunk.width - (before.width - 120))).toBeLessThanOrEqual(2)
  expect(Math.abs(shrunk.height - (before.height - 80))).toBeLessThanOrEqual(2)

  // SE 角向外拖 (+200, +120)：宽度/高度增大（可能撞工作区上限，只断增大）。
  await page.mouse.move(shrunk.x + shrunk.width - 10, shrunk.y + shrunk.height - 10)
  await page.mouse.down()
  await page.mouse.move(shrunk.x + shrunk.width + 190, shrunk.y + shrunk.height + 110, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const grown = (await region.boundingBox())!
  expect(grown.width).toBeGreaterThan(shrunk.width + 50)
  expect(grown.height).toBeGreaterThan(shrunk.height + 30)

  // 先把窗口拖出左栏浮轨下方（视口 1280：浮轨 16-96px 遮盖西缘，z 契约
  // 上轨盖窗）——抓标题栏中部右移 140px，让西缘可被命中。
  await page.mouse.move(grown.x + grown.width / 2, grown.y + 14)
  await page.mouse.down()
  await page.mouse.move(grown.x + grown.width / 2 + 140, grown.y + 14, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const moved = (await region.boundingBox())!
  expect(moved.x).toBeGreaterThanOrEqual(150)

  // 西缘向右拖 60：宽度 -60、x +60（左缘跟手，精确）。
  await page.mouse.move(moved.x + 3, moved.y + moved.height / 2)
  await page.mouse.down()
  await page.mouse.move(moved.x + 63, moved.y + moved.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const compensated = (await region.boundingBox())!
  expect(Math.abs(compensated.width - (grown.width - 60))).toBeLessThanOrEqual(2)
  expect(Math.abs(compensated.x - (moved.x + 60))).toBeLessThanOrEqual(2)
})
