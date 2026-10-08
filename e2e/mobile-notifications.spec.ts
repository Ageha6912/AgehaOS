import { expect, test, type Page } from '@playwright/test'

/**
 * M2-2 移动通知中心 E2E（结构契约归 src/mobile/notifications/*.test.tsx 与
 * MobileStatusBar.test.tsx；真实视口 + 生产构建全链路落本文件）：
 *
 * - 真实事件触发（切片指定「参考桌面 notification 相关 spec 的事件触发方
 *   式」= e2e/eclosion-world.spec.ts 同款）：羽化三接口全桩 + 本地种子
 *   「羽化开」，reload 后登录恢复链 refreshWorld() 拉到今日世界 →
 *   eclosion.world.ready → notification-bridge（main.tsx 装配链，双 Shell
 *   同一事件流）真实推送「今日世界已就绪」——零伪造数据、零测试后门。
 *   generate 桩必须给 200 SSE：今日应用空闲预取若失败会经 eclosion.app.failed
 *   再推「羽化应用生成失败」，徽标就不是干净的 1（预取失败即真实通知，
 *   这里让它真实成功）。
 * - 断言链：状态栏铃铛徽标（未读数 1）→ 点按开 Bottom Sheet（dialog）→
 *   列表条目（标题/正文/时间）→ 打开即消化徽标（markAllRead）→ 清空 →
 *   空态文案 + 徽标不复活 → backdrop 点击关闭。
 * - desktop context 回归：桌面 Shell 无移动铃铛/移动 sheet（桌面通知中心
 *   与本切片零接触，契约不变）。
 *
 * 设备档与 e2e/mobile-launcher.spec.ts 同口径（360×800 + iPhone UA；判定
 * 不在测试里复算，只断言用户可见结果）。
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

/** 模拟「远程模式下已开启羽化」的用户（e2e/eclosion-world.spec.ts 同款种子）。 */
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
 *  校验器下限 ECLOSION_WORLD_MIN_APPS = 6，行集与 eclosion-world.spec 同款）。 */
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

/** 世界桩载荷（eclosion-world.spec.ts 同构）。 */
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

/** 桩用的「生成应用」SSE（eclosion-world.spec.ts 同款：预取真实成功）。 */
const GENERATED_APP_SSE = [
  'event: meta',
  'data: {"requestId":"e2e-world","model":"stub-model"}',
  '',
  'event: think',
  'data: {"chars":36}',
  '',
  'event: delta',
  'data: {"text":"<!doctype html><html><head><style>#result{font-size:24px}</style></head><body><div id=\\"result\\">booting</div>"}',
  '',
  'event: delta',
  "data: {\"text\":\"<script>document.getElementById('result').textContent = 'E2E-GEN-OK';</script></body></html>\"}",
  '',
  'event: done',
  'data: {"bytes":300,"ms":11}',
  '',
  '',
].join('\n')

/** 羽化三接口全桩（quota/generate/world；e2e/eclosion-world.spec.ts 同款）。 */
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
      status: 200,
      contentType: 'text/event-stream',
      body: GENERATED_APP_SSE,
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

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('真实通知全链路：eclosion.world.ready → 徽标 → 列表 → 清空 → 空态', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilenotify')
    await stubEclosionBackend(page)
    await seedEclosionEnabled(page)

    // 铃铛常驻状态栏；徽标断言不做「初始缺席」前提（世界就绪通知在 reload
    // 后的登录恢复链上随时可达，到达时机不可控，不是被测契约）。
    const bell = page.getByTestId('mobile-notification-bell')
    await expect(bell).toBeVisible()
    await expect(bell).toHaveAttribute('aria-expanded', 'false')

    // ① 真实事件落地：世界就绪通知进 store → 徽标 = 未读数 1（15s 内到达，
    //    覆盖 reload → 登录恢复 → refreshWorld 的异步链）。
    await expect(page.getByTestId('mobile-notification-badge')).toHaveText('1', {
      timeout: 15_000,
    })

    // ② 点按铃铛开 Bottom Sheet：dialog 角色 + 列表条目（标题/正文/时间）。
    await bell.click()
    const sheet = page.getByTestId('mobile-notification-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('role', 'dialog')
    const item = page.getByTestId('mobile-notification-item')
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('今日世界已就绪')
    await expect(item).toContainText('趋势信号已织入今日的世界')
    await expect(item).toHaveAttribute('data-read', /true|false/)
    await expect(item).toContainText(/\d{1,2}:\d{2}/)

    // ③ 打开即消化徽标（markAllRead 语义）：sheet 开着、徽标已退场。
    await expect(page.getByTestId('mobile-notification-badge')).toHaveCount(0)

    // ④ 清空：列表清空 → 空态文案在场、清空按钮退场、徽标不复活。
    await page.getByTestId('mobile-notification-clear').click()
    await expect(page.getByTestId('mobile-notification-empty')).toHaveText('暂无通知')
    await expect(page.getByTestId('mobile-notification-clear')).toHaveCount(0)
    await expect(page.getByTestId('mobile-notification-item')).toHaveCount(0)
    await expect(page.getByTestId('mobile-notification-badge')).toHaveCount(0)

    // ⑤ backdrop 点击关闭：sheet 播完退场帧卸载，Home 照常。
    await page.getByTestId('mobile-notification-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.getByTestId('mobile-notification-center')).toHaveCount(0, { timeout: 3_000 })
    await expect(page.getByTestId('mobile-home')).toBeVisible()
  })
})

test.describe('desktop context 回归', () => {
  test('桌面 Shell 无移动通知中心入口（桌面 NotificationCenter 零接触）', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilenotifydesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })
    // 移动铃铛/移动 sheet 不在桌面渲染路径上（桌面铃铛是另一 testid，不受影响）。
    await expect(page.getByTestId('mobile-notification-bell')).toHaveCount(0)
    await expect(page.getByTestId('mobile-notification-center')).toHaveCount(0)
  })
})
