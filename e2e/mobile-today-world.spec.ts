import { expect, test, type Page } from '@playwright/test'

/**
 * M1-2 移动今日世界卡（只消费 eclosion-store 世界摘要，不重建引擎）：
 *
 * - 羽化开 + 世界落地：卡片在场（✦ 今日世界标题 + 真实字段统计行
 *   apps.length / signalCount + 「查看世界」按钮 ≥44px 命中区）；
 * - 「查看世界」= mobile-nav-store 导航推进（过渡语义：M1-6 AppHost 之前
 *   不真实开窗）——断言口是 MobileShell 根的 data-nav-view / data-nav-app-id
 *   反射（与 data-shell 同一「标记供测试断言」先例）；
 * - 羽化关（默认）：世界零请求、整卡缺席（禁止空壳）；
 * - 羽化开但世界不可得（503 静默降级）：请求已发但整卡缺席（无数据不建
 *   「查看世界」死按钮，与桌面同铁律）。
 *
 * 数据预置沿用 e2e/eclosion-world.spec.ts 的桩模式：注册 → 桩
 * /api/eclosion/world（quota 失败自愈无需桩）→ 写 eclosion 偏好 → reload
 * 触发登录链路重新拉取世界。移动 context 设备档与 e2e/mobile-shell.spec.ts
 * 同口径（判定不在测试里复算，只断言用户可见结果）。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 注册新账号进入移动 Shell（本地认证模式，每个 context 独立 localStorage）。 */
async function registerAndReachMobile(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
}

/** 模拟「远程模式下已开启羽化」（同 e2e/eclosion-world.spec.ts 先例）。 */
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

/** 今日 UTC 日键（世界 worldDate 必须是「今日」，客户端逐字校验）。 */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 6 个世界应用行（slug/name/icon/hue/tagline/category 均过客户端校验白名单）。 */
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

/** 过 src/core/eclosion/world.ts 校验器的合法世界桩载荷。 */
function worldPayload(signalTitles: string[]): Record<string, unknown> {
  return {
    worldDate: todayKey(),
    generatedAt: new Date().toISOString(),
    degraded: signalTitles.length === 0,
    signalCount: signalTitles.length,
    signals: {
      titles: signalTitles,
      sourceName: signalTitles.length === 0 ? '' : 'GitHub Trending',
      sourceUrl: signalTitles.length === 0 ? '' : 'https://github.com/mshibanami/GitHubTrendingRSS',
    },
    theme: {
      headline: '边缘推理与本地智能体的浪潮',
      paletteId: 'aurora-borealis',
      accentHue: 212,
      wallpaper: { engine: 'landscape', paletteId: 'aurora-borealis', mood: 'calm' },
    },
    apps: worldApps(),
  }
}

/** 桩 /api/eclosion/world（null = 503 静默降级档）；返回请求计数供断言。 */
async function stubWorld(
  page: Page,
  payload: () => Record<string, unknown> | null,
): Promise<{ hits: () => number }> {
  let hits = 0
  await page.route('**/api/eclosion/world', async (route) => {
    hits += 1
    const world = payload()
    if (world === null) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'world-unavailable' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(world),
    })
  })
  return { hits: () => hits }
}

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('世界落地：卡片在场（真实字段统计）+「查看世界」点击推进 nav 状态', async ({ page }) => {
    await registerAndReachMobile(page, 'e2emobiletoday')
    const world = await stubWorld(page, () => worldPayload([
      '本地智能体编排框架冲上热榜',
      '边缘推理网关发布 2.0',
      '开源矢量数据库刷新性能纪录',
    ]))
    await seedEclosionEnabled(page)

    // 卡片在场：标题 + 真实字段统计行（6 应用 / 3 信号）+「查看世界」按钮。
    const card = page.getByTestId('mobile-today-world')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('mobile-today-world-stats')).toContainText('6 款新应用')
    await expect(page.getByTestId('mobile-today-world-stats')).toContainText('3 条趋势信号')

    // 触控纪律（DESIGN.md §35.3）：命中区 ≥44×44px。
    const view = page.getByTestId('mobile-today-world-view')
    await expect(view).toContainText('查看世界')
    const box = (await view.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)

    // 点击 = 导航推进（过渡语义）：根元素反射 app + 动态面板注册 appId
    //（M1-6 AppHost 之前不真实开窗，反射是 nav 状态机的 E2E 断言口）。
    const shell = page.locator('[data-shell="mobile"]')
    await expect(shell).toHaveAttribute('data-nav-view', 'home')
    await view.click()
    await expect(shell).toHaveAttribute('data-nav-view', 'app')
    await expect(shell).toHaveAttribute('data-nav-app-id', 'com.ageha.dynamic.panel')
    expect(world.hits(), '世界经登录链路拉取').toBeGreaterThanOrEqual(1)
  })

  test('羽化关（默认）：世界零请求，整卡缺席（禁止空壳）', async ({ page }) => {
    const world = await stubWorld(page, () => worldPayload(['不应被拉取的信号']))
    await registerAndReachMobile(page, 'e2emobiletodayoff')

    // 登录链路对世界零请求（门控在客户端），卡片不渲染。
    await page.waitForTimeout(300)
    expect(world.hits(), '羽化关不拉取世界').toBe(0)
    await expect(page.getByTestId('mobile-today-world')).toHaveCount(0)
    await expect(page.getByTestId('mobile-today-world-view')).toHaveCount(0)
  })

  test('世界接口 503 → 静默降级：请求已发但整卡缺席（无数据不建死按钮）', async ({ page }) => {
    await registerAndReachMobile(page, 'e2emobiletoday503')
    const world = await stubWorld(page, () => null)
    await seedEclosionEnabled(page)

    // 503 被吞（AI 铁律不阻塞 Shell）：Home 照常，卡片整卡缺席。
    await page.waitForTimeout(300)
    expect(world.hits()).toBeGreaterThanOrEqual(1)
    await expect(page.getByTestId('mobile-today-world')).toHaveCount(0)
    await expect(page.getByTestId('mobile-today-world-view')).toHaveCount(0)
    await expect(page.getByTestId('mobile-home-greeting')).toBeVisible()
  })
})
