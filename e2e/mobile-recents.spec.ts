import { expect, test, type Page } from '@playwright/test'

/**
 * M3-2 最近任务切换器 E2E（判定纯函数归 dock-home-gesture / recents-card-
 * decision 单测；hook 与覆盖层结构契约归各 *.test.tsx；真实触控 + 生产构建
 * 全链路落本文件）。切片主链路：
 * - 开 Files → 开 Notes（两窗并存）→ 长按 Dock Home 位开最近任务 →
 *   点 Files 卡切回（**不新开窗**：面板 data-window-id 不变、计数仍 2）；
 * - 卡片上滑关 Notes（窗口计数 2→1）；「全部关闭」回 Home（计数 0，覆盖层
 *   空态自动退场）；
 * - 入口两路（长按 / 上滑）都真实开门；**空态整层不可达**（无已开应用时
 *   长按不开层）；
 * - app 内打开覆盖层后浏览器返回键**先关覆盖层**（应用视图原样，popstate
 *   层级——应用自己的栈位不被花掉，下一次返回才退出应用视图）；
 * - desktop 回归：桌面 Shell 无最近任务入口与覆盖层。
 *
 * 触控注入与 e2e/mobile-edge-back.spec.ts 同口径：CDP
 * `Input.dispatchTouchEvent`（真实输入管线，产出 touch 指针的 PointerEvent）；
 * 设备档 360×800 + iPhone UA（判定不在测试里复算，只断言用户可见结果）。
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

/** CDP 触控序列：touchStart → 逐点 touchMove（真实输入管线）→ touchEnd。 */
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

/** 长按（touchStart 按住 holdMs 再抬起——长按开最近任务的入口输入）。 */
async function touchLongPress(page: Page, point: TouchPoint, holdMs = 700): Promise<void> {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y }],
  })
  await page.waitForTimeout(holdMs)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

/** Dock Home 位中心（真实几何取自按钮 boundingBox，不硬编码坐标）。 */
async function dockHomeCenter(page: Page): Promise<TouchPoint> {
  const box = await page.getByTestId('mobile-dock-home').boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

/**
 * 等 sheet 入场动画落定（sheet-in 200ms，--ag-motion-base）：入场中的 sheet
 * 在动——立刻 click 会与动画竞速（测得的命中点落在 backdrop 上，把「切卡」
 * 点成「关层」）；立刻 boundingBox 会拿到运动中的几何。统一等一拍再交互。
 */
async function settleSheet(page: Page): Promise<void> {
  await page.waitForTimeout(260)
}

/** 经 Dock 位打开应用并断言窗口落地（返回 windowId）。 */
async function openAppFromDock(page: Page, appId: string, expectedWindowCount: string): Promise<string> {
  const shell = page.locator('[data-shell="mobile"]')
  await page.locator(`[data-testid="mobile-dock-app"][data-app-id="${appId}"]`).click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-app-id', appId)
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  const windowId = await host.getAttribute('data-window-id')
  expect(windowId).toBeTruthy()
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
  await expect(shell).toHaveAttribute('data-nav-app-id', appId)
  await expect(shell).toHaveAttribute('data-window-count', expectedWindowCount)
  return windowId!
}

test.describe('mobile context（360×800 iPhone UA，touchscreen）', () => {
  // 真实时序手势测试：文件内串行（mobile-edge-back / mobile-swipe-up 同款
  // 纪律——并行合成触控序列会被同机 worker 抢 CPU 拉宽时序）。
  test.describe.configure({ mode: 'serial' })

  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('主链路：开 Files→开 Notes→最近任务→切回 Files（windowId 不变）→上滑关 Notes→全部关闭回 Home', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilerecents')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    // ⓪ 空态整层不可达：无已开应用时长按 Home 位不开层。
    await touchLongPress(page, await dockHomeCenter(page))
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-nav-view', 'home')

    // ① 开 Files（计数 1）→ 开 Notes（计数 2，两窗并存）。
    const filesWindowId = await openAppFromDock(page, 'com.ageha.files', '1')
    const notesWindowId = await openAppFromDock(page, 'com.ageha.notes', '2')
    expect(notesWindowId).not.toBe(filesWindowId)

    // ② 长按 Dock Home 位（app 内）：最近任务覆盖层打开，两张卡（新→旧）。
    await touchLongPress(page, await dockHomeCenter(page))
    const sheet = page.getByTestId('mobile-recents-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    const cards = page.getByTestId('mobile-recents-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toHaveAttribute('data-app-id', 'com.ageha.notes')
    await expect(cards.nth(1)).toHaveAttribute('data-app-id', 'com.ageha.files')

    // ③ app 内返回键：先关覆盖层（popstate 层级），应用视图原样。
    await page.goBack()
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.notes')
    await expect(shell).toHaveAttribute('data-window-count', '2')

    // ④ 再开最近任务（上滑 Home 位——入口第二路），点 Files 卡切回：
    //    不新开窗（windowId 不变 + 计数仍 2）。
    const home = await dockHomeCenter(page)
    await touchSwipe(page, [
      { x: home.x, y: home.y + 10 },
      { x: home.x, y: home.y - 60 },
      { x: home.x, y: home.y - 110 },
    ])
    await expect(sheet).toBeVisible()
    await settleSheet(page)
    await page
      .locator('[data-testid="mobile-recents-card"][data-app-id="com.ageha.files"]')
      .click()
    const host = page.getByTestId('mobile-app-host')
    await expect(host).toHaveAttribute('data-app-id', 'com.ageha.files')
    await expect(host).toHaveAttribute('data-window-id', filesWindowId)
    await expect(shell).toHaveAttribute('data-window-count', '2')
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)

    // ⑤ 上滑关 Notes：再开层，对 Notes 卡上滑（距离档 110px > 64px）→
    //    卡片消失、窗口计数 2→1、Files 卡仍在、层保持在场。
    await touchSwipe(page, [
      { x: home.x, y: home.y + 10 },
      { x: home.x, y: home.y - 60 },
      { x: home.x, y: home.y - 110 },
    ])
    await expect(sheet).toBeVisible()
    await settleSheet(page)
    // 卡片根自带 data-app-id，直接按属性定位。
    const notesCardByAttr = page.locator('[data-testid="mobile-recents-card"][data-app-id="com.ageha.notes"]')
    await expect(notesCardByAttr).toBeVisible()
    const cardBox = await notesCardByAttr.boundingBox()
    expect(cardBox).not.toBeNull()
    await touchSwipe(page, [
      { x: cardBox!.x + cardBox!.width / 2, y: cardBox!.y + cardBox!.height / 2 },
      { x: cardBox!.x + cardBox!.width / 2, y: cardBox!.y + cardBox!.height / 2 - 60 },
      { x: cardBox!.x + cardBox!.width / 2, y: cardBox!.y + cardBox!.height / 2 - 110 },
    ])
    await expect(notesCardByAttr).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-window-count', '1')
    // Notes 窗口已关（app.stopped 派生正确），Files 仍在层里（层保持）。
    await expect(sheet).toBeVisible()
    await expect(page.locator('[data-testid="mobile-recents-card"][data-app-id="com.ageha.files"]')).toBeVisible()

    // ⑥ 全部关闭：记录清空 → 层空态自动退场，回 Home，窗口计数 0。
    //    （卡片飞出动画 120ms + 手势 click 抑制窗 50ms 过后再点按钮。）
    await page.waitForTimeout(180)
    await page.getByTestId('mobile-recents-close-all').click()
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '0')
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })

  test('Home 档入口与 Esc/backdrop 关闭：开 Files→返回→上滑开层→backdrop 关（窗口保留）', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilerecentshome')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })

    const filesWindowId = await openAppFromDock(page, 'com.ageha.files', '1')
    await page.getByTestId('mobile-app-back').click()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '1')

    // Home 档上滑入口：层打开、卡片在场。
    const home = await dockHomeCenter(page)
    await touchSwipe(page, [
      { x: home.x, y: home.y + 10 },
      { x: home.x, y: home.y - 60 },
      { x: home.x, y: home.y - 110 },
    ])
    await expect(page.getByTestId('mobile-recents-sheet')).toBeVisible()
    await settleSheet(page)
    await expect(
      page.locator('[data-testid="mobile-recents-card"][data-window-id="' + filesWindowId + '"]'),
    ).toBeVisible()

    // backdrop 点击关闭：导航仍 home、窗口保留（M3-2 窗口常驻）。
    await page.getByTestId('mobile-recents-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '1')
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无最近任务入口与覆盖层', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilerecentsdesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
    await expect(page.getByTestId('mobile-dock-home')).toHaveCount(0)
    await expect(page.getByTestId('mobile-recents')).toHaveCount(0)
    await expect(page.getByTestId('mobile-recents-sheet')).toHaveCount(0)
  })
})
