import { expect, test, type Page } from '@playwright/test'

/**
 * M4-1 移动全域搜索 E2E（结构/防抖/分组/截断/定位通道分发归
 * src/mobile/launcher/*.test、src/store/files-target-store.test.ts 与
 * FileManager.test.tsx；真实 VFS + 生产构建全链路落本文件）：
 * - 预置 VFS 文件（经 Files 应用 UI 真实新建：Documents/m4-locate.txt）
 *   → Launcher 搜索命中文件域（组标题 + 名称/路径双行）→ 点击文件结果 =
 *   打开 Files 并定位到所在目录（页脚 /Documents + 文件 tile 在场）；
 * - 两条落点路径都覆盖：Files 已开（M3-2 切回 + 在场实例订阅导航）与
 *   Files 未开（最近任务全部关闭后从 Home 直开 = 新启动 + 挂载后消费）。
 *
 * 设备档与 e2e/mobile-files.spec.ts 同口径（360×800 + iPhone UA；判定不在
 * 测试里复算，只断言用户可见结果）。同一页面内串行（真实 VFS 是页面内存
 * 树，预置一次两条用例间不共享——各用例独立注册独立 context）。
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
async function openFilesFromDock(page: Page): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="mobile-dock-app"][data-app-id="com.ageha.files"]').click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
  await expect(shell).toHaveAttribute('data-window-count', '1')
}

/** 经 Files 应用 UI 预置真实 VFS 文件：进入 Documents 新建 m4-locate.txt。 */
async function seedFileInDocuments(page: Page): Promise<void> {
  await openFilesFromDock(page)

  const switcher = page.getByTestId('files-dir-switcher')
  await switcher.getByRole('button', { name: '文档' }).click()
  await expect(page.getByText('/Documents', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新建文本文件' }).click()
  const dialog = page.getByRole('dialog', { name: '新建文本文件' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('m4-locate.txt')
  await dialog.getByRole('button', { name: '确定' }).click()
  await expect(
    page.locator('[data-window-id]').getByRole('button', { name: /m4-locate\.txt/ }),
  ).toBeVisible()
}

/** 回 Home 后经网格搜索按钮打开 Launcher（M2-1 同一入口，真实点击链）。 */
async function openLauncherFromHome(page: Page): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await page.getByTestId('mobile-dock-home').click()
  await expect(shell).toHaveAttribute('data-nav-view', 'home')
  await page.getByTestId('mobile-launcher-open').click()
  await expect(page.getByTestId('mobile-launcher-sheet')).toBeVisible()
}

interface TouchPoint {
  x: number
  y: number
}

/** 长按（CDP 真触控：touchStart 按住 holdMs 再抬起）——Dock Home 位长按
 *  开最近任务的入口输入，与 e2e/mobile-recents.spec.ts 同口径（该手势 hook
 *  只认 touch/pen 指针，Playwright click delay 产不出真实 touch 序列）。 */
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

test.describe('mobile context（360×800 iPhone UA）：全域搜索 → Files 定位', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('Files 已开：搜索命中文件 → 点击切回 Files 并定位所在目录', async ({ page }) => {
    await registerAndReachShell(page, 'e2em4filesopen')
    await seedFileInDocuments(page)

    await openLauncherFromHome(page)
    const search = page.getByTestId('mobile-launcher-search')
    await search.fill('m4-locate')

    // 文件域命中：组标题（i18n）+ 名称与完整路径双行；防抖 200ms 由
    // toBeVisible 自动重试消化。
    const fileRow = page.getByTestId('mobile-launcher-file-item')
    await expect(fileRow).toBeVisible()
    await expect(fileRow).toContainText('m4-locate.txt')
    await expect(fileRow).toContainText('/Documents/m4-locate.txt')
    await expect(page.getByTestId('mobile-launcher-group-files')).toHaveText('文件')

    // 点击 = Files 切回（窗口计数仍 1，M3-2 窗口常驻）+ 定位到 /Documents。
    await fileRow.click()
    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.files')
    await expect(shell).toHaveAttribute('data-window-count', '1')
    await expect(page.getByTestId('mobile-app-host')).toHaveAttribute('data-state', 'open')
    await expect(page.getByText('/Documents', { exact: true })).toBeVisible()
    await expect(
      page.locator('[data-window-id]').getByRole('button', { name: /m4-locate\.txt/ }),
    ).toBeVisible()
  })

  test('Files 未开：搜索命中 → 点击新启动 Files 并直接落位所在目录', async ({ page }) => {
    await registerAndReachShell(page, 'e2em4filesnew')
    await seedFileInDocuments(page)

    // 关掉 Files（最近任务「全部关闭」，M3-2 语义：窗口真关）→ Home 直开
    // 路径 = 新启动，Files 挂载后消费定位意图。
    const shell = page.locator('[data-shell="mobile"]')
    await page.getByTestId('mobile-dock-home').click()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await touchLongPress(page, await dockHomeCenter(page))
    const recents = page.getByTestId('mobile-recents-sheet')
    await expect(recents).toBeVisible()
    await recents.getByRole('button', { name: '全部关闭' }).click()
    await expect(shell).toHaveAttribute('data-window-count', '0')

    await openLauncherFromHome(page)
    await page.getByTestId('mobile-launcher-search').fill('m4-locate')
    const fileRow = page.getByTestId('mobile-launcher-file-item')
    await expect(fileRow).toBeVisible()
    await expect(fileRow).toContainText('/Documents/m4-locate.txt')

    // 点击 = Files 新启动（窗口计数 1）+ 挂载后定位 /Documents。
    await fileRow.click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.files')
    await expect(shell).toHaveAttribute('data-window-count', '1')
    await expect(page.getByTestId('mobile-app-host')).toHaveAttribute('data-state', 'open')
    await expect(page.getByText('/Documents', { exact: true })).toBeVisible()
    await expect(
      page.locator('[data-window-id]').getByRole('button', { name: /m4-locate\.txt/ }),
    ).toBeVisible()
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无移动启动器：全域搜索改动零外溢', async ({ page }) => {
    await registerAndReachShell(page, 'e2em4filesdesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-launcher')).toHaveCount(0)
    await expect(page.getByTestId('mobile-launcher-open')).toHaveCount(0)
  })
})
