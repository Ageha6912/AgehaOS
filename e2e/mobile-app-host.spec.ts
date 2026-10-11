import { expect, test, type Page } from '@playwright/test'

/**
 * M1-6 移动应用宿主 E2E（结构契约归 src/mobile/app/MobileAppHost.test.tsx；
 * 真实视口几何 / 生产构建全链路 / 浏览器返回键落本文件）：
 * - 全链路 Home→Files→返回→Notes→返回→Settings→返回：每步断言移动视图
 *   （data-nav-view / data-nav-app-id 反射 + 宿主面板 state）与窗口 store
 *   状态（data-window-count 反射 + 面板 data-window-id）。**M3-2 起窗口与
 *   视图解耦**：返回只退视图不关窗，窗口计数随打开次数单调增长，最终回
 *   Home 后计数保留；**单实例**：再进已开应用 = 指回已有 windowId（不新
 *   开窗）；
 * - 浏览器返回键：应用视图 page.goBack() → popstate → backToHome——停在
 *   AgehaOS 内（不退出页面）；
 * - desktop context 回归：桌面 Shell 渲染路径不变（无移动宿主反射、无
 *   data-nav 标记，桌面经菜单栏开 Files 照常出窗）。
 *
 * 设备档与 e2e/mobile-shell.spec.ts 同口径（360×800 + iPhone UA；判定不在
 * 测试里复算，只断言用户可见结果）。
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

/**
 * 经移动 Dock 位打开应用并断言宿主面板 + 窗口 store 同步（返回 windowId）。
 * expectedWindowCount = 打开后的窗口计数（M3-2 窗口常驻：已开应用再进 =
 * 切回旧窗，计数不变；新应用 = 新窗，计数 +1）。
 */
async function openAppFromDock(
  page: Page,
  appId: string,
  title: string,
  expectedWindowCount: string,
): Promise<string> {
  const shell = page.locator('[data-shell="mobile"]')
  await page.locator(`[data-testid="mobile-dock-app"][data-app-id="${appId}"]`).click()

  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-app-id', appId)
  await expect(host).toHaveAttribute('data-state', 'open')
  // 窗口真实落地：非空 windowId + 窗口计数（面板渲染 = launchApp 返回后）。
  await expect(host).not.toHaveAttribute('data-window-id', '')
  const windowId = await host.getAttribute('data-window-id')
  expect(windowId).toBeTruthy()
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
  await expect(shell).toHaveAttribute('data-nav-app-id', appId)
  await expect(shell).toHaveAttribute('data-window-count', expectedWindowCount)
  await expect(page.getByTestId('mobile-app-title')).toHaveText(title)
  // 全屏应用视图：Home 卸载，Dock 仍在（当前位指示位）。
  await expect(page.getByTestId('mobile-home')).toHaveCount(0)
  await expect(page.getByTestId('mobile-dock')).toBeVisible()
  return windowId!
}

/**
 * header 返回键回 home：视图复位、窗口保留（M3-2 窗口常驻，app 可在最近
 * 任务切回）、退场帧播完卸载。
 */
async function backToHomeFromApp(page: Page, expectedWindowCount: string): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await page.getByTestId('mobile-app-back').click()

  await expect(shell).toHaveAttribute('data-nav-view', 'home')
  await expect(shell).not.toHaveAttribute('data-nav-app-id')
  await expect(shell).toHaveAttribute('data-window-count', expectedWindowCount)
  // 退场帧（data-state='leaving'，≤200ms）播完卸载，避免与下一次启动串扰。
  await expect(page.getByTestId('mobile-app-host')).toHaveCount(0)
}

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('全链路 Home→Files→返回→Notes→返回→Settings→返回→再进 Files：窗口常驻 + 单实例切回', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobileapphost')

    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toBeVisible({ timeout: 15_000 })
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '0')
    await expect(page.getByTestId('mobile-app-host')).toHaveCount(0)
    await expect(page.getByTestId('mobile-home')).toBeVisible()

    // ① Home → Files（Dock 位）：新窗，计数 1。
    const filesWindowId = await openAppFromDock(page, 'com.ageha.files', '文件', '1')

    // ② Files → 返回：视图回 home，窗口保留（计数仍 1）。
    await backToHomeFromApp(page, '1')
    await expect(page.getByTestId('mobile-home')).toBeVisible()

    // ③ Home → Notes（Dock 位）：第二个窗口（计数 2，windowId 不同于 Files）。
    const notesWindowId = await openAppFromDock(page, 'com.ageha.notes', '记事', '2')
    expect(notesWindowId).not.toBe(filesWindowId)

    // ④ Notes → 返回：两个窗口都在（计数 2）。
    await backToHomeFromApp(page, '2')
    await expect(page.getByTestId('mobile-home')).toBeVisible()

    // ⑤ Home → Settings（Dock 位）：第三个窗口（计数 3）。
    const settingsWindowId = await openAppFromDock(page, 'com.ageha.settings', '设置', '3')
    expect(settingsWindowId).not.toBe(notesWindowId)

    // ⑥ 单实例切回：Home 再进 Files = 指回已有 windowId（计数仍 3，不开新窗；
    //    切换链路的 E2E 主断言在 e2e/mobile-recents.spec.ts）。
    await backToHomeFromApp(page, '3')
    const reenteredWindowId = await openAppFromDock(page, 'com.ageha.files', '文件', '3')
    expect(reenteredWindowId).toBe(filesWindowId)

    // ⑦ 浏览器返回键：popstate → backToHome，停在 AgehaOS 内（URL 不变），
    //    窗口常驻（计数 3）。
    const urlBefore = page.url()
    await page.goBack()
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await expect(shell).toHaveAttribute('data-window-count', '3')
    await expect(page.locator('[data-shell="mobile"]')).toBeVisible()
    expect(page.url()).toBe(urlBefore)

    // ⑧ 最终回 Home：宿主缺席、窗口计数保留、Home 视图完整在场。
    await expect(page.getByTestId('mobile-app-host')).toHaveCount(0)
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 不受影响：无移动宿主反射，桌面经菜单栏开 Files 照常出窗', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilehostdesk')

    // 1280×720（≥1024 短边）→ Desktop Shell；无移动 nav/宿主反射标记。
    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="mobile-app-host"]')).toHaveCount(0)
    await expect(desktop).not.toHaveAttribute('data-nav-view')
    await expect(desktop).not.toHaveAttribute('data-window-count')

    // 桌面开窗路径不变：菜单栏 文件 → 打开文件管理器 → 桌面窗口（含
    // data-window-id 的应用内容）出现——MobileAppHost 未渗入桌面。
    await page.getByTestId('menu-bar').getByRole('button', { name: '文件' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '打开文件管理器' }).click()
    await expect(page.locator('[data-window-id]').first()).toBeVisible()
    await expect(page.locator('[data-testid="mobile-app-host"]')).toHaveCount(0)
  })
})
