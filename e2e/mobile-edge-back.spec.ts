import { expect, test, type Page } from '@playwright/test'

/**
 * M2-4 边缘返回手势 E2E（结构契约归 src/mobile/gesture/*.test.tsx；真实
 * 触控输入归本文件，生产构建 + vite preview 全链路）：
 * - 左缘滑入过半 → 确认回 home（视图复位 + Home 完整在场；M3-2 起窗口
 *   常驻——返回不关窗，app 留在最近任务里可切回）；
 * - 快速甩动（距离 < 半屏）同样确认（速度判据的真实时序验证）；
 * - 短慢拖（不过半不甩动）→ 取消回弹，停在应用视图；
 * - 非边缘起点滑动 → 不激活（应用视图原样）；
 * - 应用内纵向滑动 → 原生滚动照常（轴向裁决不抢滚动）；
 * - desktop 回归：桌面 Shell 无此手势，触控滑动零影响。
 *
 * 触控注入：Playwright 的 page.touchscreen 只有 tap，滑入走 CDP
 * `Input.dispatchTouchEvent`（真实输入管线，Chromium 由此派发 touch 指针的
 * PointerEvent——与真机同路）。设备档与 e2e/mobile-app-host.spec.ts 同口径
 * （360×800 + iPhone UA；判定不在测试里复算，只断言用户可见结果）。
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

/** 经移动 Dock 位打开 Files 并断言宿主面板 open + 窗口落地。 */
async function openFiles(page: Page): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="mobile-dock-app"][data-app-id="com.ageha.files"]').click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
  await expect(shell).toHaveAttribute('data-window-count', '1')
}

interface TouchPoint {
  x: number
  y: number
}

/** CDP 触控滑入：touchStart → 逐点 touchMove（真实输入管线，产出 pointer
 * 事件）→ settle 后 touchEnd。settleMs 让末帧之后至少空两帧——取消路径的
 * 速度平滑衰减到阈值下，测试不依赖帧率巧合。 */
async function touchSwipe(
  page: Page,
  points: TouchPoint[],
  { stepMs = 24, settleMs = 0 }: { stepMs?: number; settleMs?: number } = {},
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
  if (settleMs > 0) await page.waitForTimeout(settleMs)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

async function expectBackAtHome(page: Page): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toHaveAttribute('data-nav-view', 'home')
  // M3-2 窗口常驻：返回不关窗（app 留在最近任务，可切回）。
  await expect(shell).toHaveAttribute('data-window-count', '1')
  await expect(page.getByTestId('mobile-home')).toBeVisible()
  await expect(page.getByTestId('mobile-app-host')).toHaveCount(0)
}

test.describe('mobile context（360×800 iPhone UA，touchscreen）', () => {
  // 真实时序手势测试：文件内串行——并行的合成触控序列会被同机 worker 抢
  // CPU 拉宽（速度随之失真），串行保证甩动输入的时序保真。
  test.describe.configure({ mode: 'serial' })

  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('左缘滑入过半：确认回 home，窗口保留（M3-2 窗口常驻）', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgeback')
    await openFiles(page)

    // 起点 x=5（≤24px 激活带），拖到 x=330（> 半屏 180）。
    await touchSwipe(page, [
      { x: 5, y: 400 },
      { x: 90, y: 400 },
      { x: 180, y: 400 },
      { x: 270, y: 400 },
      { x: 330, y: 400 },
    ])

    await expectBackAtHome(page)
  })

  test('快速甩动（距离 < 半屏）：速度判据确认回 home', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgeflick')
    await openFiles(page)

    // 距离 140 < 180；单跳合成甩动（140px 一记 pointermove，真实速度
    // ~14px/ms）——余量扛 CPU 拉伸：速度窗按事件时序计，多跳步进会被
    // 同机负载拉宽成慢拖（实测 flake），单跳把每毫秒位移拉满。
    await touchSwipe(
      page,
      [
        { x: 5, y: 400 },
        { x: 145, y: 400 },
      ],
      { stepMs: 8 },
    )

    await expectBackAtHome(page)
  })

  test('短慢拖（不过半、末帧沉速）：取消回弹，停在应用视图', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgecancel')
    await openFiles(page)

    // 距离 95 < 半屏；settle 两帧让速度衰减 < 0.5px/ms。
    await touchSwipe(
      page,
      [
        { x: 5, y: 400 },
        { x: 55, y: 400 },
        { x: 100, y: 400 },
      ],
      { stepMs: 40, settleMs: 80 },
    )

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-window-count', '1')
    await expect(page.getByTestId('mobile-app-host')).toHaveAttribute('data-state', 'open')
    await expect(page.getByTestId('mobile-home')).toHaveCount(0)
  })

  test('非边缘起点滑动：不激活，应用视图原样', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgeoutside')
    await openFiles(page)

    await touchSwipe(page, [
      { x: 140, y: 400 },
      { x: 240, y: 400 },
      { x: 340, y: 400 },
    ])

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-window-count', '1')
    await expect(page.getByTestId('mobile-app-host')).toHaveAttribute('data-state', 'open')
  })

  test('应用内纵向滑动：轴向裁决让位原生滚动，视图不变', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgevertical')
    await openFiles(page)

    // 缘带内起手的纵向拖拽：pointercancel（浏览器接管滚动）→ 静默复位。
    await touchSwipe(
      page,
      [
        { x: 10, y: 300 },
        { x: 14, y: 420 },
        { x: 16, y: 540 },
      ],
      { stepMs: 30, settleMs: 60 },
    )

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-window-count', '1')
  })

  test('横向滚动面契约：Files 工具栏豁免可横滚，宿主面板零横向溢出（M2-4 QA）', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2eedgehscroll')
    await openFiles(page)

    // QA 探针同口径：360px 视口下 Files 工具栏操作簇 min-content 超出视口。
    // 横向交互必须归属显式豁免面（工具栏行），宿主面板自身不得再有横向
    // 溢出（否则 touch-action: pan-y 会让触屏够不到被裁剪的操作）。
    const contract = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="mobile-app-body"]')
      const toolbar = document.querySelector('[data-testid="files-toolbar"]')
      if (!body || !(body instanceof HTMLElement) || !toolbar || !(toolbar instanceof HTMLElement)) {
        return null
      }
      const button = toolbar.querySelector('button')
      return {
        bodyOverflow: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth },
        toolbar: {
          exempt: toolbar.hasAttribute('data-no-edge-back'),
          touchAction: getComputedStyle(toolbar).touchAction,
          innerTouchAction: button ? getComputedStyle(button).touchAction : null,
          scrollWidth: toolbar.scrollWidth,
          clientWidth: toolbar.clientWidth,
        },
      }
    })
    expect(contract).not.toBeNull()
    // 宿主面板零横向溢出：横向交互只属于豁免面。
    expect(contract!.bodyOverflow.scrollWidth).toBe(contract!.bodyOverflow.clientWidth)
    // 豁免面：标记在场 + touch-action 放行横滚（容器与后代，链条交集不为
    // pan-y）+ 内容确实横向溢出（操作簇在滚动方向上可达）。
    expect(contract!.toolbar.exempt).toBe(true)
    expect(contract!.toolbar.touchAction).toBe('pan-x pan-y')
    expect(contract!.toolbar.innerTouchAction).toBe('pan-x pan-y')
    expect(contract!.toolbar.scrollWidth).toBeGreaterThan(contract!.toolbar.clientWidth)
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无边缘返回手势：左缘触控滑动零影响', async ({ page }) => {
    await registerAndReachShell(page, 'e2eedgedesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)

    // 桌面开 Files 窗口（菜单栏路径），左缘滑动后窗口原样（手势只挂在
    // 移动宿主上，桌面 Shell 根本不挂 useEdgeBack）。
    await page.getByTestId('menu-bar').getByRole('button', { name: '文件' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '打开文件管理器' }).click()
    const windowFrame = page.locator('[data-window-id]').first()
    await expect(windowFrame).toBeVisible()

    await touchSwipe(page, [
      { x: 5, y: 360 },
      { x: 120, y: 360 },
      { x: 300, y: 360 },
    ])

    await expect(desktop).toBeVisible()
    await expect(windowFrame).toBeVisible()
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
  })
})
