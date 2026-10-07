import { devices, expect, test, type Page } from '@playwright/test'

/**
 * M0-2 Shell Selection：ready 分支按 device-store 的 shell 单点切换——
 * 移动 context（手机/平板口径，M0-1 探针 + 2026-10-07 裁决）渲染
 * MobileShell（根元素 data-shell="mobile"），桌面 context 渲染 Desktop
 * （根元素 data-shell="desktop" 且 Taskbar 可见，桌面渲染路径不变）。
 * 判定不在测试里复算（innerWidth/UA 判断集中在 core/platform 探针——架构
 * 铁律），只断言用户可见的 Shell 选择结果。
 *
 * M0-4 Safe Area 几何探针：safe-area 的 env(safe-area-inset-*) jsdom 算不
 * 了（单测只钉结构契约，见 src/mobile/MobileShell.test.tsx），几何断言落
 * 本文件——移动 context 用两种设备档（360×800 手动档与 iPhone 15 Pro
 * 描述档）各跑一轮：
 * ① 基线（模拟器无刘海，env 零回退）：无横向溢出、状态栏/Dock 占位带落
 *    max() 保底 24/12px、内容区起始 y ≥ 状态栏占位带高度；
 * ② CDP `Emulation.setSafeAreaInsetsOverride` 注入 iPhone 15 Pro 档真实
 *    inset（top 59 / bottom 34 / 左右 47）：根 padding（--safe-left/right）
 *    与两条占位带高度实时跟随 env 增长，内容区仍被约束在安全区内。
 * desktop context 回归不变（M0-2 断言原样保留）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 注册新账号进入桌面（本地认证模式，每个 context 独立 localStorage）。 */
async function registerAndReachDesktop(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
}

/** 一次 evaluate 收齐几何探针所需的全部读数（DOMRect 不可结构克隆，先摊平）。 */
interface ShellGeometry {
  innerWidth: number
  innerHeight: number
  scrollWidth: number
  framePaddingLeft: string
  framePaddingRight: string
  statusbarHeight: number
  contentTop: number
  contentBottom: number
  dockHeight: number
}

async function readShellGeometry(page: Page): Promise<ShellGeometry> {
  return page.evaluate(() => {
    const box = (testId: string): DOMRect => {
      const el = document.querySelector(`[data-testid="${testId}"]`)
      if (!el) throw new Error(`missing [data-testid="${testId}"]`)
      return el.getBoundingClientRect()
    }
    const frame = document.querySelector('[data-testid="mobile-shell-frame"]')
    if (!frame) throw new Error('missing mobile-shell-frame')
    const cs = getComputedStyle(frame)
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.scrollingElement?.scrollWidth
        ?? document.documentElement.scrollWidth,
      framePaddingLeft: cs.paddingLeft,
      framePaddingRight: cs.paddingRight,
      statusbarHeight: box('mobile-statusbar-slot').height,
      contentTop: box('mobile-content-slot').top,
      contentBottom: box('mobile-content-slot').bottom,
      dockHeight: box('mobile-dock-slot').height,
    }
  })
}

/**
 * 断言移动 Shell 的安全区几何：env 值随期望档（基线 = env 零回退落
 * max() 保底；注入档 = 跟随 CDP inset）。
 */
async function assertSafeAreaGeometry(
  page: Page,
  expected: { statusbarMin: number; dockMin: number; sidePadding: string },
): Promise<void> {
  const geo = await readShellGeometry(page)

  // 无横向溢出：文档横向不超出视口（安全区 padding 与占位带不得撑出横向滚动）。
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.innerWidth)

  // 根 padding 生效：frame 左右 padding 等于该档的 env 值（基线 0px / 注入 47px）。
  expect(geo.framePaddingLeft).toBe(expected.sidePadding)
  expect(geo.framePaddingRight).toBe(expected.sidePadding)

  // 占位带高度达 max() 保底：基线 24/12px，注入档随 env（59/34）长高。
  expect(geo.statusbarHeight).toBeGreaterThanOrEqual(expected.statusbarMin)
  expect(geo.dockHeight).toBeGreaterThanOrEqual(expected.dockMin)

  // 内容区起始 y ≥ 状态栏占位带高度；底部不越入 Dock 安全区预留带
  // （内容区整体约束在安全区内）。
  expect(geo.contentTop).toBeGreaterThanOrEqual(geo.statusbarHeight)
  expect(geo.contentBottom + geo.dockHeight).toBeLessThanOrEqual(geo.innerHeight + 0.5)
}

/** M0-4 探针：同一页面内先测 env 零回退基线，再注入 inset 验证实时跟随。 */
async function runSafeAreaGeometryProbe(page: Page, username: string): Promise<void> {
  await registerAndReachDesktop(page, username)

  const mobileShell = page.locator('[data-shell="mobile"]')
  await expect(mobileShell).toBeVisible({ timeout: 15_000 })

  // viewport-fit=cover（index.html）：真机 env(safe-area-inset-*) 非零的前提。
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/,
  )

  // ① 基线：模拟器无刘海，env 零回退——占位带落 max() 保底 24/12px。
  await assertSafeAreaGeometry(page, {
    statusbarMin: 24,
    dockMin: 12,
    sidePadding: '0px',
  })

  // ② 注入 iPhone 15 Pro 档 inset（top 59 / bottom 34 / 左右 47）：
  //    根 padding 与两条占位带高度实时跟随 env，内容区仍约束在安全区内。
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, bottom: 34, left: 47, right: 47 },
  })
  await assertSafeAreaGeometry(page, {
    statusbarMin: 59,
    dockMin: 34,
    sidePadding: '47px',
  })
}

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('ready 分支渲染 MobileShell：data-shell="mobile" + 品牌字，无桌面 chrome', async ({
    page,
  }) => {
    await registerAndReachDesktop(page, 'e2emobile')

    const mobileShell = page.locator('[data-shell="mobile"]')
    await expect(mobileShell).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-shell-brand')).toHaveText('AgehaOS')

    // 桌面 Shell 不渲染：Taskbar（contentinfo 地标）与桌面根标记均缺席。
    await expect(page.locator('[data-shell="desktop"]')).toHaveCount(0)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
  })

  test('移动根声明 safe-area 基础设施：--safe-top 经 getComputedStyle 可读（M0-3）', async ({
    page,
  }) => {
    await registerAndReachDesktop(page, 'e2emobilesafe')

    const mobileShell = page.locator('[data-shell="mobile"]')
    await expect(mobileShell).toBeVisible({ timeout: 15_000 })

    // .mobile-shell 根类声明 --safe-*（env(safe-area-inset-*)）：计算样式
    // 读出自定义属性令牌流非空（无刘海视口下值回退 0px，但声明本身存在）。
    const safeTop = await mobileShell.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--safe-top'),
    )
    expect(safeTop.trim(), '--safe-top declared on the mobile root').not.toBe('')

    // 三段骨架占位（状态栏/内容/Dock）已就位，内容归 M1。
    for (const testId of ['mobile-statusbar-slot', 'mobile-content-slot', 'mobile-dock-slot']) {
      await expect(page.getByTestId(testId)).toHaveCount(1)
    }
  })

  test('safe-area 几何探针：无横向溢出 + 根 padding 生效 + 内容区约束在安全区内（M0-4）', async ({
    page,
  }) => {
    await runSafeAreaGeometryProbe(page, 'e2emobilegeo')
  })

  // M1-1 StatusBar + Home：登录后的移动 context 断言状态栏真实时间与
  // Home 时段问候可见（读数格式与文案归组件，测试只认用户可见结果；
  // 电池/网络在 Chromium 模拟档可能存在也可能缺席，「不可用即隐藏」的
  // 判定归 jsdom 单测，这里不断言它们在或不在）。
  test('状态栏真实时间 + Home 时段问候 + 用户名可见（M1-1）', async ({ page }) => {
    await registerAndReachDesktop(page, 'e2emobilestatus')

    const mobileShell = page.locator('[data-shell="mobile"]')
    await expect(mobileShell).toBeVisible({ timeout: 15_000 })

    // 状态栏时钟：24 小时制 hh:mm 等宽读出，随真实系统时间走。
    await expect(page.getByTestId('mobile-statusbar-clock')).toHaveText(/^\d{2}:\d{2}$/)
    // 状态栏用户名 = 注册会话用户（session-store 真实用户）。
    await expect(page.getByTestId('mobile-statusbar-user')).toHaveText('e2emobilestatus')

    // Home 品牌头 + 双语标语 + 时段问候（早/午/晚三档之一 + 用户名）。
    await expect(page.getByTestId('mobile-shell-brand')).toHaveText('AgehaOS')
    await expect(page.getByTestId('mobile-home-tagline')).toHaveText('Your Web OS, Your Space.')
    await expect(page.getByTestId('mobile-home-greeting')).toHaveText(
      /^(早上好|下午好|晚上好)，e2emobilestatus$/,
    )
  })
})

test.describe('mobile context（iPhone 15 Pro 描述档）', () => {
  // 描述档不能整体展开进 describe 内的 test.use（defaultBrowserType 会
  // 强制新 worker，Playwright 禁止）——只取模拟字段，浏览器档沿用项目
  // 配置（chromium）。
  const iphone15Pro = devices['iPhone 15 Pro']
  test.use({
    viewport: iphone15Pro.viewport,
    userAgent: iphone15Pro.userAgent,
    deviceScaleFactor: iphone15Pro.deviceScaleFactor,
    isMobile: iphone15Pro.isMobile,
    hasTouch: iphone15Pro.hasTouch,
  })

  test('safe-area 几何探针：无横向溢出 + 根 padding 生效 + 内容区约束在安全区内（M0-4）', async ({
    page,
  }) => {
    await runSafeAreaGeometryProbe(page, 'e2emobilegeo15pro')
  })
})

test.describe('desktop context（1920×1080）', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('ready 分支渲染 Desktop：data-shell="desktop" 且 Taskbar 可见', async ({ page }) => {
    await registerAndReachDesktop(page, 'e2edesktop')

    const desktopShell = page.locator('[data-shell="desktop"]')
    await expect(desktopShell).toBeVisible({ timeout: 15_000 })

    // 桌面渲染路径行为等价：Taskbar 照常可见（revealTaskbar 兼带等开机
    // 覆盖层退场），移动根标记与移动状态栏均缺席（M1-1 桌面零接触回归）。
    await expect(page.getByRole('contentinfo')).toBeVisible()
    await expect(page.locator('[data-shell="mobile"]')).toHaveCount(0)
    await expect(page.getByTestId('mobile-statusbar')).toHaveCount(0)

    // safe-area 变量仅移动作用域（M0-3）：桌面根上 --safe-top 未声明（空串）。
    const safeTop = await desktopShell.evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--safe-top'),
    )
    expect(safeTop.trim(), 'desktop root must not declare --safe-top').toBe('')
  })
})
