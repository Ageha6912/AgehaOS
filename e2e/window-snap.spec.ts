import { expect, test, type Page } from '@playwright/test'

// 4-worker 高负载下开窗飞行动画可能未落定——几何断言前先等待，偶发毛刺重试即愈
//（同 window-maximize.spec 的环境级处置）。
test.describe.configure({ retries: 2 })

// 视口 1024×768：左轨激活（sm≥640=80px）、右小组件栏隐藏（xl≥1280）——
// 工作区带 = {left:80, top:32, width:944, height:736}（viewport.ts
// getWorkspaceBand 数学）；缘判定带宽 = max(12, round(944*0.02)) = 19
//（snap.ts snapEdgeWidth）→ 左缘 x≤99 / 右缘 x≥1005 / 顶缘 y≤51；
// calculateSnapGeometry 左半屏 = {80,32,472,736}。
test.use({ viewport: { width: 1024, height: 768 } })

const BAND = { left: 80, top: 32, width: 944, height: 736 }
const HALF = BAND.width / 2

/**
 * W5 Snap Preview E2E（审计 .tmp/spaces-audit.md §8，任务书 §64 精神按 W4
 * 语义适配）：预览 rect 直接来自 calculateSnapGeometry 产物（与 W4 单一
 * 来源）——data-testid="snap-preview" + boundingBox 探针断言「预览矩形与
 * 松手后窗口几何像素级一致」。截图取证存 .tmp/（永不提交）；正式暗/亮双档
 * 视觉 QA 留 W10。
 */
async function openNotesWindow(page: Page) {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`snap-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 开记事（级联首窗落 (176,176,900,600)，window-manager CASCADE_BASE）。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  const region = page.locator('section[aria-label="记事"]')
  await expect(region).toBeVisible()
  // 开窗飞行落定后再测量（window-maximize.spec 同款纪律：按测量面自身等
  // 动画归零，不查全局常驻动画）。
  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  return region
}

/** 抓标题栏中部起拖（h-11=44px 带内，避开交通灯与按钮命中区）。 */
async function dragHeaderTo(
  page: Page,
  region: ReturnType<Page['locator']>,
  toX: number,
  toY: number,
  steps: number,
): Promise<{ startX: number; startY: number }> {
  const box = (await region.boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + 22
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  return { startX, startY }
}

test('dragging to the left edge shows a preview that the window lands on pixel-identically', async ({
  page,
}) => {
  const region = await openNotesWindow(page)

  // 无拖拽时零渲染：预览不在 DOM（SnapPreviewOverlay rect=null 返回 null）。
  expect(await page.getByTestId('snap-preview').count()).toBe(0)

  await dragHeaderTo(page, region, 30, 384, 10)

  // 预览出现且 rect = calculateSnapGeometry('left', band) 产物（boundingBox
  // 探针：预览与窗口同容器同坐标系，外框盒=内联几何）。
  const preview = page.getByTestId('snap-preview')
  await expect(preview).toBeVisible()
  const previewBox = (await preview.boundingBox())!
  expect(previewBox.x).toBe(BAND.left)
  expect(previewBox.y).toBe(BAND.top)
  expect(previewBox.width).toBe(HALF)
  expect(previewBox.height).toBe(BAND.height)

  // 截图取证（.tmp/ 永不提交；正式双档视觉 QA 留 W10）。
  await page.screenshot({ path: '.tmp/snap-preview-evidence.png' })

  // 松手：窗口几何与预览矩形像素级一致（W4 吸附消费同一 calculateSnapGeometry）。
  await page.mouse.up()
  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  const winBox = (await region.boundingBox())!
  expect(winBox.x).toBe(previewBox.x)
  expect(winBox.y).toBe(previewBox.y)
  expect(winBox.width).toBe(previewBox.width)
  expect(winBox.height).toBe(previewBox.height)
  // 预览已清（rect=null 零 DOM）。
  await expect(preview).toHaveCount(0)

  await page.screenshot({ path: '.tmp/snap-after-release-evidence.png' })
})

test('dragging a snapped window back out restores its pre-snap geometry and follows the pointer', async ({
  page,
}) => {
  const region = await openNotesWindow(page)
  // 原几何（吸附前 normal 态）：级联首窗 (176,176,900,600)。
  const original = (await region.boundingBox())!

  // 拖向左缘 → 吸附半屏。
  await dragHeaderTo(page, region, 30, 384, 10)
  const preview = page.getByTestId('snap-preview')
  await expect(preview).toBeVisible()
  await page.mouse.up()
  await expect(region).toBeVisible()
  const snapped = (await region.boundingBox())!
  expect(snapped.width).toBe(HALF)

  // 吸附态再拖出（带外放手）：先脱 snap 还原原几何为基线（W4 pointerdown
  // 转换点），再跟手位移。「原几何」=吸附那一刻的 normal 几何（引擎 snap
  // 记 restoreBounds=当前几何，审计 §7）——即松手前窗口随指针到达的位置
  // （开窗位 + 第一次拖拽位移），不是级联开窗位。按压点取吸附窗标题栏
  // 右段：第一次拖拽路径悬停过左轨会让工作空间面板保持展开（z-40 chrome
  // 盖过 z-30 窗口层），被面板遮住的标题栏段（左 ~352px 带）收不到
  // pointerdown——按审计 §1「snap 坐标系裁决」的层序前提，只按可视段。
  const firstPressX = original.x + original.width / 2
  const firstPressY = original.y + 22
  const preSnap = {
    x: original.x + (30 - firstPressX),
    y: original.y + (384 - firstPressY),
  }
  const snappedBox = (await region.boundingBox())!
  const pressX = snappedBox.x + snappedBox.width - 80
  const pressY = snappedBox.y + 22
  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.mouse.move(400, 300, { steps: 10 })
  expect(await preview.count()).toBe(0) // 带外无预览
  await page.mouse.up()
  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  const restored = (await region.boundingBox())!
  expect(restored.width).toBe(original.width)
  expect(restored.height).toBe(original.height)
  expect(restored.x).toBe(Math.round(preSnap.x + (400 - pressX)))
  expect(restored.y).toBe(Math.round(preSnap.y + (300 - pressY)))
})

test('resizing a snapped window from its east handle unsnaps to normal size', async ({ page }) => {
  const region = await openNotesWindow(page)
  const original = (await region.boundingBox())!

  // 吸附左半屏。
  await dragHeaderTo(page, region, 30, 384, 10)
  await expect(page.getByTestId('snap-preview')).toBeVisible()
  await page.mouse.up()
  await expect(region).toBeVisible()
  expect((await region.boundingBox())!.width).toBe(HALF)

  // 吸附态东缘 resize：pointerdown 即脱 snap（以吸附时刻几何——见上一测试
  // 的 restoreBounds 语义——为基线），东缘内收 100px → 宽 = 基线宽-100，
  // x/y 不动（东缘缩放无西/北位置补偿）。
  const firstPressX = original.x + original.width / 2
  const firstPressY = original.y + 22
  const preSnap = {
    x: original.x + (30 - firstPressX),
    y: original.y + (384 - firstPressY),
  }
  const handle = region.getByTestId('window-resize-e')
  const handleBox = (await handle.boundingBox())!
  const pressX = handleBox.x + handleBox.width / 2
  const pressY = handleBox.y + handleBox.height / 2
  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.mouse.move(pressX - 100, pressY, { steps: 5 })
  await page.mouse.up()

  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  const resized = (await region.boundingBox())!
  expect(resized.x).toBe(Math.round(preSnap.x))
  expect(resized.y).toBe(Math.round(preSnap.y))
  expect(resized.width).toBe(original.width - 100)
  // 南向余量钳制（WindowFrame 组件内：height ≤ innerHeight - y - 8）。
  expect(resized.height).toBe(
    Math.min(original.height, Math.round(768 - preSnap.y - 8)),
  )
})

test('maximize then restore returns the window to its exact original geometry', async ({
  page,
}) => {
  const region = await openNotesWindow(page)
  const original = (await region.boundingBox())!

  // 最大化：整视口真全屏（§32.5 修订 12）。
  await region.getByRole('button', { name: '最大化窗口' }).click()
  await page.waitForTimeout(450) // 层叠切换（z-30→z-[45]）落定后再测量。
  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  const maximized = (await region.boundingBox())!
  expect(maximized.x).toBeLessThanOrEqual(1)
  expect(maximized.y).toBeLessThanOrEqual(1)
  expect(Math.abs(maximized.width - 1024)).toBeLessThanOrEqual(1)
  expect(Math.abs(maximized.height - 768)).toBeLessThanOrEqual(1.5)

  // 还原：精确回原几何（restoreBounds 回落）。
  await region.getByRole('button', { name: '还原窗口' }).click()
  await expect
    .poll(() =>
      region.evaluate((el) => [...el.getAnimations()].every((a) => a.playState !== 'running')),
    )
    .toBe(true)
  const restored = (await region.boundingBox())!
  expect(restored.x).toBe(original.x)
  expect(restored.y).toBe(original.y)
  expect(restored.width).toBe(original.width)
  expect(restored.height).toBe(original.height)
})
