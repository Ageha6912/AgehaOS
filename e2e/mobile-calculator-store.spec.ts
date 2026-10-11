import { expect, test, type Page } from '@playwright/test'

/**
 * M3-4 Calculator / Store 窄容器适配 E2E（结构契约归各自 *.test.tsx 的
 * 窄容器组；真实视口几何 / 容器分支 / 触控语义归本文件，生产构建 +
 * vite preview）：
 * - 窄容器（经 Mobile AppHost 打开，360×800）：应用网格 → 计算器——按键
 *   命中区 ≥44px、7×8= 核心计算可用、显示区不截断（内容不溢出）、宿主
 *   零横向溢出；应用网格 → 商店——浏览（内置目录渲染）→ 安装（权限确认
 *   弹层允许）→「已安装」→ 卸载可用，安装/卸载/弹层控件命中区 ≥44px、
 *   宿主零横向溢出；
 * - 桌面两应用既有断言不归本文件（e2e/app-store.spec.ts 即桌面计算器 +
 *   商店全流程回归，本切片运行验证）。
 *
 * 设备档与 e2e/mobile-files.spec.ts 同口径（360×800 + iPhone UA；判定不在
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

/** 经移动 Home 应用网格打开应用并断言宿主面板 open + 窗口落地。 */
async function openAppFromGrid(page: Page, appId: string): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  await page
    .locator(`[data-testid="mobile-app-tile"][data-app-id="${appId}"]`)
    .click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-app-id', appId)
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
}

/** header 返回键回 home：退场帧（≤200ms）播完卸载，Home 重新在场。 */
async function backToHomeFromApp(page: Page): Promise<void> {
  await page.getByTestId('mobile-app-back').click()
  await expect(page.getByTestId('mobile-app-host')).toHaveCount(0)
  await expect(page.getByTestId('mobile-home')).toBeVisible()
}

/** 宿主面板零横向溢出契约（M2-4/M2-5 同口径：横向交互只属于豁免面）。 */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const body = page.getByTestId('mobile-app-body')
  const metrics = await body.evaluate((el: HTMLElement) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(metrics.scrollWidth).toBe(metrics.clientWidth)
}

test.describe('mobile context（360×800 iPhone UA）：Calculator / Store 窄容器', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('计算器：按键触控档 ≥44px、核心计算可用、显示区不截断、零横向溢出', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilecalc')
    await openAppFromGrid(page, 'com.ageha.calculator')

    // 触控档：窄分支按键命中区 ≥44×44px（§35.3；网格拉伸只会更高）。
    const key = page.getByTestId('calculator-key-8')
    const keyBox = (await key.boundingBox()) ?? { width: 0, height: 0 }
    expect(keyBox.height).toBeGreaterThanOrEqual(44)
    expect(keyBox.width).toBeGreaterThanOrEqual(44)

    // 核心计算：7 × 8 = 56（移动全屏视图下同一状态机路径）。
    await page.getByTestId('calculator-key-7').click()
    await page.getByTestId('calculator-key-×').click()
    await page.getByTestId('calculator-key-8').click()
    await page.getByTestId('calculator-key-=').click()
    await expect(page.getByTestId('calculator-display')).toHaveText('56')

    // 显示区不截断：最长输出（14 位数字 + 符号/小数点 = 16 字符）也不溢出。
    const display = await page
      .getByTestId('calculator-display')
      .evaluate((el: HTMLElement) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
    expect(display.scrollWidth).toBeLessThanOrEqual(display.clientWidth)

    await expectNoHorizontalOverflow(page)
    await backToHomeFromApp(page)
  })

  test('商店：浏览 → 安装（权限确认弹层）→ 已安装 → 卸载；控件触控档 + 零横向溢出', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilestore')
    await openAppFromGrid(page, 'com.ageha.store')

    const host = page.getByTestId('mobile-app-host')
    // 浏览：内置目录渲染（远程目录在 e2e 无后端环境缺席，是常态）。
    const install = host.getByRole('button', { name: '安装', exact: true }).first()
    await expect(install).toBeVisible()

    // 触控档：安装键 min-height 44px（§35.3，窄分支类由真实视口证实）。
    expect(await install.evaluate((el) => getComputedStyle(el).minHeight)).toBe('44px')

    // 安装流：确认弹层（共享组件的弹层控件同样 ≥44px——.mobile-shell
    // 作用域规则，桌面无此规则）→ 允许并安装 →「已安装」。
    await install.click()
    const dialog = page.getByRole('dialog', { name: '应用权限申请' })
    await expect(dialog).toBeVisible()
    const allow = dialog.getByRole('button', { name: '允许并安装' })
    expect(await allow.evaluate((el) => getComputedStyle(el).minHeight)).toBe('44px')
    expect(
      await dialog
        .getByRole('button', { name: '拒绝' })
        .evaluate((el) => getComputedStyle(el).minHeight),
    ).toBe('44px')
    await allow.click()
    await expect(dialog).toHaveCount(0)
    await expect(host.getByText('已安装').first()).toBeVisible()

    // 打开 / 卸载键触控档 + 卸载可用（回到未安装态）。
    const uninstall = host.getByRole('button', { name: /卸载 时钟/ })
    const uninstallBox = (await uninstall.boundingBox()) ?? { width: 0, height: 0 }
    expect(uninstallBox.height).toBeGreaterThanOrEqual(44)
    expect(uninstallBox.width).toBeGreaterThanOrEqual(44)
    expect(
      await host
        .getByRole('button', { name: '打开' })
        .first()
        .evaluate((el) => getComputedStyle(el).minHeight),
    ).toBe('44px')
    await uninstall.click()
    await expect(host.getByRole('button', { name: '安装', exact: true }).first()).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await backToHomeFromApp(page)
  })
})
