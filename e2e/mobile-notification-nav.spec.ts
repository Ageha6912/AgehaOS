import { expect, test, type Page } from '@playwright/test'

/**
 * M4-2 通知点击跳转 E2E（判定与分发契约归 src/mobile/notifications/*.test.tsx；
 * 真实视口 + 生产构建全链路落本文件，全程真实事件、零测试后门）：
 *
 * - 真实事件①（无 appId → 纯展示）：羽化三接口桩 + 本地种子「羽化开」，
 *   reload 后登录恢复链 refreshWorld() → eclosion.world.ready →
 *   notification-bridge 真实推送「今日世界已就绪」——载荷只有 worldDate，
 *   断言整条不可点（data-navigable="false"、无跳转按钮）。
 * - 真实事件②（载荷带 appId → 可跳转）：生成接口桩 500（非可重试错误码）→
 *   打开今日应用（运行时注册表真实在册）→ EclosionAppFrame 宿主质量回退链
 *   requestRetry → giveUp → eclosion.app.failed（载荷带 appId）→ 桥存
 *   targetAppId → 通知渲染可跳转样式。
 * - 点击跳转断言链：点按可跳转行 → sheet 关闭（退场帧播完卸载）→
 *   mobile-nav-store openApp 最近任务模型：目标已有活窗口 → 切回既有
 *   windowId（data-window-id 前后一致 = 单实例复用，不重开）。
 * - 桩只落在 /api/eclosion/*（e2e 环境无后端口径）；生成失败是真实管线
 *   行为，不是伪造数据。
 *
 * 设备档与 e2e/mobile-notifications.spec.ts 同口径（360×800 + iPhone UA；
 * 种子/桩同款复用）。
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

/** 模拟「远程模式下已开启羽化」的用户（e2e/mobile-notifications.spec.ts 同款种子）。 */
async function seedEclosionEnabled(page: Page): Promise<void> {
  const userId = await page.evaluate(() => {
    const raw = localStorage.getItem('agehaos.session.v1') ?? ''
    const parsed = JSON.parse(raw) as { userId?: string }
    if (!parsed.userId) throw new Error(`no session userId in ${raw}`)
    return parsed.userId
  })
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ enabled: true, modes: {} }))
  }, `agehaos.eclosion.prefs.v1.${userId}`)
  await page.reload()
  await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
}

/** 下一个 UTC 零点（quota 桩的重置时间，与 server quota.ts 日界同口径）。 */
function nextUtcMidnightIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString()
}

/** 今日 UTC 日键（世界 worldDate 必须是「今日」，客户端逐字校验）。 */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 桩用世界应用行（过 src/core/eclosion/world.ts 校验器的合法形态；
 *  校验器下限 ECLOSION_WORLD_MIN_APPS = 6，行集与 mobile-notifications.spec
 *  同款；首个 slug 是后续点击/跳转断言的目标应用）。 */
function worldApps(): Array<Record<string, unknown>> {
  return [
    {
      slug: 'edge-oracle',
      name: '边缘神谕',
      icon: 'Sparkle',
      hue: 268,
      tagline: '在你的浏览器里预言下一行代码',
      category: 'tools',
      window: { width: 720, height: 480 },
    },
    {
      slug: 'trend-compass',
      name: '趋势罗盘',
      icon: 'Compass',
      hue: 210,
      tagline: '把六条趋势折叠成一张导航图',
      category: 'tools',
      window: { width: 720, height: 480 },
    },
    {
      slug: 'signal-garden',
      name: '信号花园',
      icon: 'Flower',
      hue: 120,
      tagline: '把每日热点种成一株会开花的植物',
      category: 'creative',
      window: { width: 720, height: 480 },
    },
    {
      slug: 'aurora-beat',
      name: '极光节拍',
      icon: 'MusicNote',
      hue: 300,
      tagline: '跟随趋势热度起伏的节奏盒子',
      category: 'games',
      window: { width: 720, height: 480 },
    },
    {
      slug: 'idea-bazaar',
      name: '灵感集市',
      icon: 'Lightbulb',
      hue: 45,
      tagline: '用今日信号换来一个新点子',
      category: 'life',
      window: { width: 720, height: 480 },
    },
    {
      slug: 'echo-hollow',
      name: '回声树洞',
      icon: 'Moon',
      hue: 12,
      tagline: '对着今天的头条说句悄悄话',
      category: 'social',
      window: { width: 720, height: 480 },
    },
  ]
}

/** 世界桩载荷（mobile-notifications.spec.ts 同构）。 */
function worldPayload(): Record<string, unknown> {
  return {
    worldDate: todayKey(),
    generatedAt: new Date().toISOString(),
    degraded: false,
    signalCount: 3,
    signals: {
      titles: [
        '本地智能体编排框架冲上热榜',
        '边缘推理网关发布 2.0',
        '开源矢量数据库刷新性能纪录',
      ],
      sourceName: 'GitHub Trending',
      sourceUrl: 'https://github.com/mshibanami/GitHubTrendingRSS',
    },
    theme: {
      headline: '今日由 3 条趋势信号织成：本地智能体与边缘推理',
      paletteId: 'aurora-borealis',
      accentHue: 212,
      wallpaper: { engine: 'landscape', paletteId: 'aurora-borealis', mood: 'calm' },
    },
    apps: worldApps(),
  }
}

/** 羽化三接口桩：quota/world 真实成功；generate 恒 500（非可重试错误码 →
 *  宿主质量回退链一次即 giveUp，eclosion.app.failed 真实发出）。 */
async function stubEclosionBackend(page: Page): Promise<void> {
  await page.route('**/api/eclosion/quota', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        quotas: {
          basic: { used: 0, limit: 10 },
          today: { used: 0, limit: 30 },
          imagine: { used: 0, limit: 20 },
        },
        resetAtIso: nextUtcMidnightIso(),
      }),
    }),
  )
  await page.route('**/api/eclosion/generate', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'e2e-forced-failure' }),
    }),
  )
  await page.route('**/api/eclosion/world', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(worldPayload()),
    }),
  )
}

const TARGET_APP_ID = 'com.ageha.eclosion.edge-oracle'

test.use({
  viewport: { width: 360, height: 800 },
  isMobile: true,
  hasTouch: true,
  userAgent: IPHONE_UA,
})

test('真实事件全链路：world.ready 纯展示 + app.failed 可跳转 + 点击切回既有窗口', async ({
  page,
}) => {
  await registerAndReachShell(page, 'e2emobilenotifynav')
  await stubEclosionBackend(page)
  await seedEclosionEnabled(page)

  // ① 真实事件①落地：世界就绪通知进 store（载荷无 appId）。
  await expect(page.getByTestId('mobile-notification-badge')).toHaveText('1', {
    timeout: 15_000,
  })

  // ② 纯展示断言：该通知整条不可点（无跳转按钮、data-navigable=false）。
  await page.getByTestId('mobile-notification-bell').click()
  const sheet = page.getByTestId('mobile-notification-sheet')
  await expect(sheet).toBeVisible()
  const displayItem = page
    .locator('[data-testid="mobile-notification-item"]')
    .filter({ hasText: '今日世界已就绪' })
  await expect(displayItem).toHaveCount(1)
  await expect(displayItem).toHaveAttribute('data-navigable', 'false')
  await expect(displayItem.getByTestId('mobile-notification-open')).toHaveCount(0)
  await page.getByTestId('mobile-notification-backdrop').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('mobile-notification-center')).toHaveCount(0, { timeout: 3_000 })

  // ③ 打开今日应用（运行时注册表真实在册）：生成桩 500 → 宿主质量回退链
  //    giveUp → eclosion.app.failed（载荷带 appId）→ 桥存 targetAppId →
  //    徽标回到 1（新未读）。应用窗口常驻（错误卡），windowId 随之落地。
  await page
    .locator(`[data-testid="mobile-app-tile"][data-app-id="${TARGET_APP_ID}"]`)
    .click()
  const host = page.locator(`[data-testid="mobile-app-host"][data-app-id="${TARGET_APP_ID}"]`)
  await expect(host).toBeVisible({ timeout: 15_000 })
  const windowIdBefore = await host.getAttribute('data-window-id')
  await expect(page.getByTestId('mobile-notification-badge')).toHaveText('1', {
    timeout: 20_000,
  })

  // ④ 可跳转断言：app.failed 通知带 data-target-app-id + 跳转按钮；世界
  //    通知保持纯展示（同一 sheet 两条真实通知各走各的分支）。
  await page.getByTestId('mobile-notification-bell').click()
  await expect(sheet).toBeVisible()
  const navItem = page
    .locator('[data-testid="mobile-notification-item"][data-navigable="true"]')
    .filter({ hasText: '羽化应用生成失败' })
  await expect(navItem).toHaveCount(1)
  const openButton = navItem.getByTestId('mobile-notification-open')
  await expect(openButton).toHaveAttribute('data-target-app-id', TARGET_APP_ID)
  await expect(
    page
      .locator('[data-testid="mobile-notification-item"]')
      .filter({ hasText: '今日世界已就绪' }),
  ).toHaveAttribute('data-navigable', 'false')

  // ⑤ 点击跳转：sheet 关闭退场 → openApp 命中活记录 = 切回既有窗口
  //    （data-window-id 与点按前一致 = 单实例复用，不重开）。
  await openButton.click()
  await expect(page.getByTestId('mobile-notification-center')).toHaveCount(0, { timeout: 3_000 })
  await expect(host).toBeVisible()
  await expect(host).toHaveAttribute('data-state', 'open')
  expect(await host.getAttribute('data-window-id')).toBe(windowIdBefore)
})
