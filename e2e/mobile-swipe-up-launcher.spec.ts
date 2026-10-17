import { expect, test, type Page } from '@playwright/test'

/**
 * M3-1 上滑唤起启动器 E2E（判定纯函数归 src/mobile/gesture/swipe-up-decision
 * .test.ts；hook 契约归 use-swipe-up.test.tsx；Shell 接线结构归
 * MobileShell.test.tsx；真实触控输入 + 生产构建全链路落本文件）：
 * - Dock 底缘（safe-area 预留带内起点）上滑 → Launcher Bottom Sheet 打开，
 *   导航仍 home、窗口计数 0（开抽屉不是开应用）；
 * - Launcher 打开期间同位再上滑：抽屉保持在场不关闭不重触发（打开期间
 *   手势 enabled=false + 覆盖层挡住指针采集面）；
 * - 内容区纵向滚动与此手势空间隔离（横屏 800×360 档，Home 内容确定可滚）：
 *   内容区触控拖拽 = 原生滚动照常推进且零误触发；同景 Dock 上滑仍开抽屉
 *   （两件事在同一屏各归各）；
 * - desktop 回归：桌面 Shell 无此手势/无启动器抽屉，触控上滑零影响。
 *
 * 触控注入与 e2e/mobile-edge-back.spec.ts 同口径：CDP
 * `Input.dispatchTouchEvent`（真实输入管线，产出 touch 指针的 PointerEvent）；
 * 设备档 360×800 / 800×360 + iPhone UA（判定不在测试里复算，只断言用户
 * 可见结果）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 注册新账号进入 Shell（本地认证模式，每个 context 独立 localStorage）。 */
async function registerAndReachShell(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
}

interface TouchPoint {
  x: number
  y: number
}

/** CDP 触控滑动：touchStart → 逐点 touchMove（真实输入管线）→ touchEnd。 */
async function touchSwipe(
  page: Page,
  points: TouchPoint[],
  { stepMs = 24 }: { stepMs?: number } = {},
): Promise<void> {
  const session = await page.context().newCDPSession(page)
  const [first, ...rest] = points
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: first!.x, y: first!.y }],
  })
  for (const point of rest) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y }],
    })
    await page.waitForTimeout(stepMs)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

/** Dock 底缘（预留带内 y）上滑一步到位的点位：起于预留带、上滑 ~150px。 */
function dockSwipePoints(viewportHeight: number): TouchPoint[] {
  const startY = viewportHeight - 10
  return [
    { x: 180, y: startY },
    { x: 180, y: startY - 80 },
    { x: 180, y: startY - 150 },
  ]
}

test.describe('mobile context（360×800 iPhone UA，touchscreen）', () => {
  // 真实时序手势测试：文件内串行——并行的合成触控序列会被同机 worker 抢
  // CPU 拉宽时序（mobile-edge-back 同款纪律）。
  test.describe.configure({ mode: 'serial' })

  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('Dock 底缘上滑：Launcher 抽屉打开，导航仍 home、零窗口', async ({ page }) => {
    await registerAndReachShell(page, 'e2eswipeup')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)

    // 起点在 safe-area 预留带（视口底 10px 上方），上滑 150px > 0.15×800。
    await touchSwipe(page, dockSwipePoints(800))

    const sheet = page.getByTestId('mobile-launcher-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    // 打开的是抽屉不是应用：导航停在 home，窗口计数 0。
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '0')
    await expect(page.getByTestId('mobile-launcher-item')).toHaveCount(11)
  })

  test('Launcher 打开期间同位再上滑：不重复触发、不关闭（手势 enabled=false）', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2eswipeupopen')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    await touchSwipe(page, dockSwipePoints(800))
    await expect(page.getByTestId('mobile-launcher-sheet')).toBeVisible()

    // 打开期间抽屉是 fixed inset-0 z-20 覆盖层（底缘带在 sheet 之下），手势
    // enabled=false 双保险：再次上滑抽屉原样在场，不关闭不重挂不启动应用。
    await touchSwipe(page, dockSwipePoints(800))
    await expect(page.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')
    await expect(page.getByTestId('mobile-launcher-sheet')).toBeVisible()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '0')
  })
})

test.describe('mobile context 横屏（800×360）：内容区滚动与此手势空间隔离', () => {
  test.describe.configure({ mode: 'serial' })

  test.use({
    viewport: { width: 800, height: 360 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('内容区纵向触控滚动照常推进且零误触发；同景 Dock 上滑仍打开抽屉', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2eswipeupscroll')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    // 横屏下 Home 内容（品牌头 + 问候 + 应用网格 ≈ 480px）必然超出内容区
    // （≈255px）：滚动容器确定可滚，滚动断言不依赖内容恰好溢出的巧合。
    const scroll = page.getByTestId('mobile-content-scroll')
    await expect(scroll).toBeVisible()
    const scrollable = await scroll.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    )
    expect(scrollable).toBe(true)

    // 内容区起手的纵向触控拖拽：原生滚动照常推进，Launcher 不被误触发
    // （起点在底缘带外，Dock 区挂载面根本收不到这次手势）。
    await touchSwipe(
      page,
      [
        { x: 400, y: 260 },
        { x: 400, y: 170 },
        { x: 400, y: 90 },
      ],
      { stepMs: 32 },
    )
    const scrollTop = await scroll.evaluate((el) => el.scrollTop)
    expect(scrollTop).toBeGreaterThan(0)
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    // 同景 Dock 底缘上滑：空间隔离的另一侧——抽屉照常打开（视口 360 高，
    // 上滑 150px > 0.15×360 = 54）。
    await touchSwipe(page, dockSwipePoints(360))
    await expect(page.getByTestId('mobile-launcher-sheet')).toBeVisible()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '0')
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无上滑启动器手势：底缘触控上滑零影响', async ({ page }) => {
    await registerAndReachShell(page, 'e2eswipeupdesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
    await expect(page.getByTestId('mobile-dock-zone')).toHaveCount(0)

    // 桌面开 Files 窗口后底缘上滑：窗口原样（手势只挂在移动 Dock 区，
    // 桌面 Shell 根本不挂 useSwipeUp）。
    await page.getByTestId('menu-bar').getByRole('button', { name: '文件' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '打开文件管理器' }).click()
    const windowFrame = page.locator('[data-window-id]').first()
    await expect(windowFrame).toBeVisible()

    await touchSwipe(
      page,
      [
        { x: 640, y: 790 },
        { x: 640, y: 700 },
        { x: 640, y: 620 },
      ],
    )

    await expect(desktop).toBeVisible()
    await expect(windowFrame).toBeVisible()
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
  })
})
