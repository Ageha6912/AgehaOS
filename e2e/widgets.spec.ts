import { expect, test, type Page } from '@playwright/test'

import { openDynamicPanel, revealTaskbar, taskbarStartButton } from './helpers'

/**
 * 右侧 Floating System Center（Desktop Shell 3.0 STEP 4，§0.2 材质 + §33.2
 * 右栏节奏）：≥1280px 显示，四层漂浮层级 = 时钟日期 / 系统状态 / 最近通知 /
 * 今日世界（Dynamic/Explore）。容器高度由内容决定（bottom 锚 + 全高滚动的
 * Dashboard 形态退役），仅内容超出「顶锚 48 + 底部 Dock 区」剩余空间才兜底
 * 滚动；世界层沿用 STEP 3 门控——羽化默认关时整卡不渲染（桌面安静）。
 * 手动打开的动态面板让位契约（2026-10-02 起不再自动开窗）保持。
 */

/** 注册新用户并等待桌面就绪（每用例独立上下文，无需清理）。 */
async function registerDesktop(page: Page, username: string): Promise<void> {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(taskbarStartButton(page)).toBeVisible({ timeout: 15_000 })
}

/** 模拟「远程模式下已开启羽化」的用户（同 e2e/eclosion-world.spec.ts 先例）。 */
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
  await expect(taskbarStartButton(page)).toBeVisible({ timeout: 15_000 })
}

/** 下一个 UTC 零点（额度重置时间，与 server quota.ts 日界同口径）。 */
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

/** 6 个世界应用行（slug/name/icon/hue/tagline/category 均过白名单）。 */
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

/** 过 src/core/eclosion/world.ts 校验器的合法世界载荷。 */
function worldPayload(options: { headline: string; accentHue: number; signalTitles: string[] }): Record<string, unknown> {
  const degraded = options.signalTitles.length === 0
  return {
    worldDate: todayKey(),
    generatedAt: new Date().toISOString(),
    degraded,
    signalCount: options.signalTitles.length,
    signals: {
      titles: options.signalTitles,
      sourceName: degraded ? '' : 'GitHub Trending',
      sourceUrl: degraded ? '' : 'https://github.com/mshibanami/GitHubTrendingRSS',
    },
    theme: {
      headline: options.headline,
      paletteId: 'aurora-borealis',
      accentHue: options.accentHue,
      wallpaper: { engine: 'landscape', paletteId: 'aurora-borealis', mood: 'calm' },
    },
    apps: worldApps(),
  }
}

/** 羽化接口桩（quota + world + generate；widgets 场景只读世界不触发生成）。 */
async function stubEclosionBackend(page: Page, world: Record<string, unknown>): Promise<void> {
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
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"stub"}' }),
  )
  await page.route('**/api/eclosion/world', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(world),
    }),
  )
}

/** 等今日世界落地（以启动器「今日」分组出现世界应用瓦片为准）。 */
async function waitForWorldLanded(page: Page, appName: string): Promise<void> {
  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  await page.getByTestId('launcher-category-today').click()
  await expect(
    page.getByTestId('launcher-grid').getByRole('button', { name: appName }),
  ).toBeVisible({ timeout: 15_000 })
}

test.describe('widgets: Floating System Center (STEP 4)', () => {
  test('three floating cards by default; world layer gated off; no full-height dashboard', async ({
    page,
  }) => {
    await registerDesktop(page, 'widgets-e2e-default')

    const rail = page.getByTestId('widget-rail')
    await expect(rail).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('widgets-clock')).toBeVisible()
    await expect(page.getByTestId('widgets-system')).toBeVisible()
    await expect(page.getByTestId('widgets-notifications')).toBeVisible()

    // Shell 3.1 F2 权重分级：通知卡投影弱于时钟卡——quiet 档 shadow-soft
    // （最大 blur 8px）vs 全档 shadow-panel（主影 0 4px 16px）。computed
    // style 实测禁心算（window-visual.spec.ts 同款手法）；双主题阴影透明
    // 度不同但模糊半径同值，断言与主题无关。
    const shadows = await page.evaluate(() => {
      const read = (testId: string): string => {
        const el = document.querySelector(`[data-testid="${testId}"]`)
        return el ? getComputedStyle(el).boxShadow : ''
      }
      return { clock: read('widgets-clock'), notifications: read('widgets-notifications') }
    })
    expect(shadows.clock).toContain('16px')
    expect(shadows.notifications).not.toContain('16px')
    expect(shadows.notifications).toContain('8px')
    // 品牌横幅退役（中央品牌层承载）；羽化默认关 → 世界层整卡不渲染。
    await expect(page.getByTestId('widgets-brand')).toHaveCount(0)
    await expect(page.getByTestId('widgets-world')).toHaveCount(0)

    // §32：月历收拢进时钟卡（默认收起），展开后今日高亮格在位。
    await page.getByTestId('widgets-clock-calendar-toggle').click()
    await expect(page.getByTestId('widgets-calendar')).toBeVisible()

    // 手动打开的动态面板完整处于系统中心左侧（E2E 视口 1280 = xl 恰好启用；
    // 2026-10-02 起不再自动开窗，让位契约对手动开窗同样成立）。
    const panel = await openDynamicPanel(page)
    const panelBox = await panel.boundingBox()
    const railBox = await rail.boundingBox()
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(railBox!.x + 1)

    // Shell 2.0 浮动节奏（§33.2）严格钉扎：右缘留白 20px（right-5）、顶部锚
    // 48px（菜单栏 32px + 1rem，地基切片 token 自动成立）——±0.5px 亚像素余量。
    const vp = page.viewportSize() ?? { width: 1280, height: 720 }
    const railInset = vp.width - (railBox!.x + railBox!.width)
    expect(railInset).toBeGreaterThanOrEqual(19.5)
    expect(railInset).toBeLessThanOrEqual(20.5)
    expect(railBox!.y).toBeGreaterThanOrEqual(47.5)
    expect(railBox!.y).toBeLessThanOrEqual(48.5)

    // STEP 4 验收：高度由内容决定，1280x720 默认态不越界（剩余空间 =
    // 视口 - 顶锚 48 - 底部 Dock 区 88）。
    expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(vp.height)
    expect(railBox!.height).toBeLessThanOrEqual(vp.height - 48 - 88 + 1)

    // 兜底滚动只在内容超出剩余空间时生效：月历展开后容器被 max-h 钳住，仍不越界。
    await expect(page.getByTestId('widgets-calendar')).toBeVisible()
    const expandedBox = await rail.boundingBox()
    expect(expandedBox!.y + expandedBox!.height).toBeLessThanOrEqual(vp.height)
    expect(expandedBox!.height).toBeLessThanOrEqual(vp.height - 48 - 88 + 1)
  })

  test('eclosion world completes the four floating layers and routes to the launcher today category', async ({
    page,
  }) => {
    await registerDesktop(page, 'widgets-e2e-world')
    await stubEclosionBackend(
      page,
      worldPayload({
        headline: '系统中心的世界：边缘推理与本地智能体',
        accentHue: 212,
        signalTitles: ['本地智能体编排框架冲上热榜', '边缘推理网关发布 2.0'],
      }),
    )
    await seedEclosionEnabled(page)

    // 世界先落地（启动器「今日」分组可见），关启动器回桌面。
    await waitForWorldLanded(page, '边缘神谕')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('launcher-grid')).toHaveCount(0)

    // 第四层在位：趋势主题 headline + 新应用数 + 今日更新状态——四层漂浮层级齐。
    const world = page.getByTestId('widgets-world')
    await expect(world).toBeVisible()
    await expect(world).toContainText('系统中心的世界：边缘推理与本地智能体')
    await expect(world).toContainText('6 款新应用')
    await expect(world).toContainText('今日已更新')
    for (const testId of ['widgets-clock', 'widgets-system', 'widgets-notifications']) {
      await expect(page.getByTestId(testId)).toBeVisible()
    }

    // 1280x720 四层齐仍不越界（超出剩余空间的部分进容器兜底滚动）。
    const vp = page.viewportSize() ?? { width: 1280, height: 720 }
    const railBox = await page.getByTestId('widget-rail').boundingBox()
    expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(vp.height)

    // 点击世界卡 → 共享启动器直接落在「今日」分类（aria-pressed）。
    // 世界卡挂 .sp-ambient-float 环境慢浮动（9s 无限 transform）——卡内按钮
    // 是常动目标，永不满足「稳定」可操作性检查；force 跳过稳定等待。
    await page.getByTestId('widgets-world-entry').click({ force: true })
    await expect(page.getByTestId('launcher-category-today')).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByTestId('launcher-grid').getByRole('button', { name: '边缘神谕' }),
    ).toBeVisible()
  })
})
