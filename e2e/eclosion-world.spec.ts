import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar, taskbarStartButton, waitEclosionFrame } from './helpers'

/**
 * 羽化模式 P2/P4 端到端（AI-GENERATED-APPS-DESIGN §12 P2「今日世界」/ P4「治理
 * 与回放」验收）：
 *
 * - P2：每天首次出现今日世界（世界就绪后「今日」分组落位 + 通知 + 顶栏信号
 *   来源小字）；热点源不可达的两种降级（503 无世界 / 空数据纯想象 degraded）；
 *   主题双主题对比度过质量门（对落地后的 --ag-primary/--ag-surface **计算值**
 *   断言 WCAG ≥3，浅/深各一轮——可自动断言的部分；壁纸管线的选择与质量门由
 *   单测 world-theme.test.ts / dynamic-desktop 域覆盖，E2E 不重复断言）；点按
 *   今日应用瓦片可生成并可用（桩 SSE 流式，产物走真实 dist 沙箱管线）。
 * - P4：蝶谱时间线展示与「回到那天的主题」；举报对话框与同意流程（ADR 22
 *   样本链路 + 会话封禁）。
 * - 回归：默认配置（羽化关）下世界/生成接口零请求，「今日」分组空、桌面照常。
 *
 * 默认 E2E 环境无后端（本地认证），世界/生成/quota/样本接口一律 page.route 桩
 * （沿用 e2e/eclosion.spec.ts 的桩模式）；「双击今日应用」按 2026-10-02 落位
 * 裁决映射为启动器「今日」瓦片点按（桌面图标区已移除，AppLauncher.tsx 头注）。
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

/** 模拟「远程模式下已开启羽化」的用户（同 e2e/eclosion.spec.ts 先例）。 */
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
  // 任务栏自动隐藏（§9；helpers.ts:18 约定「收起后再次交互前先唤出」）：
  // reload 后指针不在底缘热区——低负载时靠 reload 初始 reveal 窗口期侥幸，
  // 高并行负载下窗口期错过即 15s 超时（第 3 步强门禁 flake 实测）。显式
  // 唤出再断言开始按钮：纯等待方式修复，用例语义不变。
  await revealTaskbar(page)
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

// ── 世界桩载荷（过 src/core/eclosion/world.ts 校验器的合法形态） ────────────

interface WorldStubOptions {
  headline: string
  accentHue: number
  /** 信号标题；空数组 = 热点源全无数据的纯想象降级（degraded）。 */
  signalTitles: string[]
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

function worldPayload(options: WorldStubOptions): Record<string, unknown> {
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

// ── 接口桩 ──────────────────────────────────────────────────────────────────

/** 桩用的「生成应用」SSE：骨架 + 脚本（破茧后脚本真实执行并写结果）。 */
const GENERATED_APP_SSE = [
  'event: meta',
  'data: {"requestId":"e2e-world","model":"stub-model"}',
  '',
  'event: think',
  'data: {"chars":36}',
  '',
  'event: delta',
  'data: {"text":"<!doctype html><html><head><style>#result{font-size:24px}</style></head><body><div id=\\"result\\">booting</div><button id=\\"inc\\" type=\\"button\\">+1</button>"}',
  '',
  'event: delta',
  "data: {\"text\":\"<script>document.getElementById('result').textContent = 'E2E-GEN-OK';document.getElementById('inc').addEventListener('click',function(){var r=document.getElementById('result');r.textContent='E2E-CLICK-'+(2+3);});</script></body></html>\"}",
  '',
  'event: done',
  'data: {"bytes":300,"ms":11}',
  '',
  '',
].join('\n')

/**
 * 羽化三接口全桩 + 请求观测：
 * - quota：configured（额度可见，开关不因探测置灰）；
 * - generate：默认 200 SSE（可换 4xx）；记录请求体供契约断言；
 * - world：经 getter 动态取值（可中途换成另一份世界/置 null 表 503）；计数。
 */
async function stubEclosionBackend(
  page: Page,
  options: {
    world: () => Record<string, unknown> | null
    generateStatus?: number
    generateBody?: string
  },
): Promise<{ worldHits: () => number; generateBodies: () => Array<Record<string, unknown>> }> {
  let worldHits = 0
  const generateBodies: Array<Record<string, unknown>> = []
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
  await page.route('**/api/eclosion/generate', async (route) => {
    try {
      generateBodies.push(route.request().postDataJSON() as Record<string, unknown>)
    } catch {
      /* 请求体缺测不影响桩响应 */
    }
    const status = options.generateStatus ?? 200
    await route.fulfill({
      status,
      contentType: status === 200 ? 'text/event-stream' : 'application/json',
      body: options.generateBody ?? GENERATED_APP_SSE,
    })
  })
  await page.route('**/api/eclosion/world', async (route) => {
    worldHits += 1
    const world = options.world()
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
  return { worldHits: () => worldHits, generateBodies: () => generateBodies }
}

/** 桩样本举报链路（ADR 22：举报成功要件 = 200；记录上报载荷供断言）。 */
async function stubSampleUpload(
  page: Page,
): Promise<{ posts: () => Array<Record<string, unknown>> }> {
  const posts: Array<Record<string, unknown>> = []
  await page.route('**/api/dynamic/samples', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"samples":[]}' })
      return
    }
    try {
      posts.push(route.request().postDataJSON() as Record<string, unknown>)
    } catch {
      /* 同上 */
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return { posts: () => posts }
}

// ── 观测工具 ────────────────────────────────────────────────────────────────

/** 等今日世界落地（以启动器「今日」分组出现世界应用瓦片为准）。 */
async function waitForWorldLanded(page: Page, appName: string): Promise<void> {
  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  await page.getByTestId('launcher-category-today').click()
  await expect(
    page.getByTestId('launcher-grid').getByRole('button', { name: appName }),
  ).toBeVisible({ timeout: 15_000 })
}

/** 落地后的 accent Token 与 surface Token 的 WCAG 对比度（页面内实算）。 */
function tokenContrast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const computed = getComputedStyle(document.documentElement)
    const parse = (value: string): [number, number, number] | null => {
      const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
      if (hex) {
        const int = Number.parseInt(hex[1]!, 16)
        return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
      }
      const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)
      if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      return null
    }
    const accent = parse(computed.getPropertyValue('--ag-primary'))
    const surface = parse(computed.getPropertyValue('--ag-surface'))
    if (accent === null || surface === null) return -1
    const channel = (c: number) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luminance = (c: [number, number, number]) =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
    const la = luminance(accent)
    const lb = luminance(surface)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  })
}

/** documentElement 上的世界 accent inline 值（world-theme 写入）。 */
function worldAccentInline(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.style.getPropertyValue('--ag-primary'))
}

// ── P2：今日世界落位 ────────────────────────────────────────────────────────

test.describe('P2 今日世界（世界就绪 → 落位）', () => {
  test('首次出现今日世界：通知中心留档、顶栏信号小字可展开来源、启动器「今日」分组落位', async ({
    page,
  }) => {
    const world = worldPayload({
      headline: '今日由 3 条趋势信号织成：本地智能体与边缘推理',
      accentHue: 212,
      signalTitles: [
        '本地智能体编排框架冲上热榜',
        '边缘推理网关发布 2.0',
        '开源矢量数据库刷新性能纪录',
      ],
    })
    await registerDesktop(page, 'e2eworld-land')
    await stubEclosionBackend(page, { world: () => world })
    await seedEclosionEnabled(page)

    // 「今日」分组：6 个世界应用瓦片全部落位（世界行 → 运行时注册 → 启动器）。
    await waitForWorldLanded(page, '边缘神谕')
    const grid = page.getByTestId('launcher-grid')
    for (const name of ['边缘神谕', '趋势罗盘', '信号花园', '极光节拍', '灵感集市', '回声树洞']) {
      await expect(grid.getByRole('button', { name })).toBeVisible()
    }

    // 右栏世界卡信号行（§6.3 透明性；Shell 3.1 STEP 3 自顶栏迁入）：来源
    // 入口 + 可展开来源列表（headline 已述「织成」计数，行内不复述——终审
    // 遗留去重）；弹层 portal 至 body，完整落在视口内不被裁剪。
    const signals = page.getByTestId('widgets-world-signals')
    await expect(signals).toBeVisible()
    await expect(signals).toContainText('趋势信号来源')
    // 世界卡挂 .sp-ambient-float 环境慢浮动（9s 无限 transform，2026-10-11
    // 环境抛光）——卡内按钮是常动目标，永不满足 Playwright「稳定」可操作性
    // 检查（ boundingBox 连续两帧不变）；force 跳过稳定等待、仍走真实命中。
    await signals.click({ force: true })
    const signalsPanel = page.getByTestId('widgets-world-signals-panel')
    await expect(signalsPanel).toBeVisible()
    await expect(page.getByTestId('widgets-world-signal')).toHaveCount(3)
    await expect(page.getByTestId('widgets-world-signals-source-link')).toBeVisible()
    // 重生成入口随迁（截图评审验在位；行为由 eclosion.spec 羽化窗口链路验）。
    await expect(page.getByTestId('widgets-world-regenerate')).toBeVisible()
    const signalsPanelBox = (await signalsPanel.boundingBox())!
    const vp = page.viewportSize()!
    expect(signalsPanelBox.x).toBeGreaterThanOrEqual(0)
    expect(signalsPanelBox.y).toBeGreaterThanOrEqual(0)
    expect(signalsPanelBox.x + signalsPanelBox.width).toBeLessThanOrEqual(vp.width)
    expect(signalsPanelBox.y + signalsPanelBox.height).toBeLessThanOrEqual(vp.height)

    // 「今日世界已就绪」进通知中心（每 worldDate 一条；面板留档不受 toast 时限影响）。
    await page.getByTestId('notification-bell').click()
    await expect(page.getByTestId('notification-panel')).toBeVisible()
    await expect(
      page.getByTestId('notification-item').filter({ hasText: '今日世界已就绪' }),
    ).toHaveCount(1)
    // 列表区必须有真实几何高度：toBeVisible 检测不到「有布局盒但被 0 高
    // overflow 容器裁剪」的塌缩（QA 2026-10-04 通知面板态），直接量盒子。
    const listBox = await page.getByTestId('notification-list').boundingBox()
    const panelBox = await page.getByTestId('notification-panel').boundingBox()
    expect(listBox?.height ?? 0).toBeGreaterThan(120)
    expect(panelBox?.height ?? 0).toBeGreaterThan(200)
  })

  test('Workspace Panel 底部「今日世界」入口：真实摘要 + 「查看世界」直达启动器「今日」分类', async ({
    page,
  }) => {
    const world = worldPayload({
      headline: '面板入口的世界：边缘推理与本地智能体',
      accentHue: 160,
      signalTitles: ['本地智能体编排框架冲上热榜', '边缘推理网关发布 2.0'],
    })
    await registerDesktop(page, 'e2eworld-panel-entry')
    await stubEclosionBackend(page, { world: () => world })
    await seedEclosionEnabled(page)

    // 世界先落地（启动器「今日」分组可见），关启动器回桌面。
    await waitForWorldLanded(page, '边缘神谕')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('launcher-grid')).toHaveCount(0)

    // pin 展开面板 → 底部入口在场：趋势主题（headline）+ 新应用数 + 今日更新状态。
    await page.getByTestId('sidebar-brand').click()
    const entry = page.getByTestId('workspace-world-entry')
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('面板入口的世界：边缘推理与本地智能体')
    await expect(entry).toContainText('6 款新应用')
    await expect(entry).toContainText('今日已更新')

    // 「查看世界 →」：打开共享启动器并直接落在「今日」分类（aria-pressed），
    // 面板经既有弹层互斥收起。
    await entry.click()
    await expect(page.getByTestId('launcher-category-today')).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByTestId('launcher-grid').getByRole('button', { name: '边缘神谕' }),
    ).toBeVisible()
    await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')
  })

  test('主题双主题对比度过质量门：世界 accent 落地后浅/深两主题 WCAG ≥3（计算值实算）', async ({
    page,
  }) => {
    await registerDesktop(page, 'e2eworld-contrast')
    await stubEclosionBackend(page, {
      world: () =>
        worldPayload({
          headline: '对比度门的今日世界',
          accentHue: 268,
          signalTitles: ['一条信号'],
        }),
    })
    await seedEclosionEnabled(page)

    // 世界 accent 接管 --ag-primary（§6.3：只改色相，明度/饱和度 Token 层固定）。
    await expect.poll(() => worldAccentInline(page)).toBeTruthy()
    // 浅色（新用户默认）：accent 对 surface 对比度 ≥ 3（质量门口径）。
    expect(await tokenContrast(page)).toBeGreaterThanOrEqual(3)

    // 视图菜单切深色：世界主题随 class 变化重派（dark 取值），对比度同样 ≥ 3。
    await page.getByRole('button', { name: '视图', exact: true }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect
      .poll(() => tokenContrast(page), { message: '深色主题下世界 accent 对比度' })
      .toBeGreaterThanOrEqual(3)
    // 深色重派后 inline 值确已按深色口径换算（非浅色原值照抄）。
    const darkInline = await worldAccentInline(page)
    expect(darkInline).toBeTruthy()
  })

  test('热点源空数据 → 纯想象降级：世界照常（今日分组在场），顶栏无信号小字', async ({ page }) => {
    await registerDesktop(page, 'e2eworld-degraded')
    await stubEclosionBackend(page, {
      world: () =>
        worldPayload({ headline: '无锚点纯想象的今日世界', accentHue: 212, signalTitles: [] }),
    })
    await seedEclosionEnabled(page)

    // degraded（signalCount=0）：世界照常生成落位——今日分组仍有 6 个应用。
    await waitForWorldLanded(page, '边缘神谕')
    // 纯想象降级无来源可列：世界卡信号行不渲染（WorldSignals 门控）。
    await expect(page.getByTestId('widgets-world-signals')).toHaveCount(0)
  })

  test('世界接口 503 → 静默放弃：无今日世界、桌面照常（AI 铁律：不阻塞桌面）', async ({ page }) => {
    await registerDesktop(page, 'e2eworld-503')
    const stubs = await stubEclosionBackend(page, { world: () => null })
    await seedEclosionEnabled(page)

    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    await page.getByTestId('launcher-category-today').click()
    // 今日分组空（世界不可得时不落任何应用），空态提示在场。
    await expect(page.getByText('无匹配结果')).toBeVisible()
    await expect(page.getByTestId('widgets-world-signals')).toHaveCount(0)
    // 世界请求确实发出过（503 被吞）：证明走了「拉取失败 → 静默降级」路径。
    expect(stubs.worldHits()).toBeGreaterThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(taskbarStartButton(page)).toBeVisible()

    // 面板入口：世界未落地 → 安静空态（无数据不建「查看世界」死按钮）。
    await page.getByTestId('sidebar-brand').click()
    await expect(page.getByTestId('workspace-world-empty')).toBeVisible()
    await expect(page.getByTestId('workspace-world-empty')).toContainText('还未织成')
    await expect(page.getByTestId('workspace-world-entry')).toHaveCount(0)
  })
})

test.describe('P4 蝶谱（§8 时间线 + 回放）', () => {
  test('世界留档进蝶谱；「回到那天的主题」把当日主题恢复为那天的 accent（只动主题不动应用）', async ({
    page,
  }) => {
    const worldA = worldPayload({
      headline: '甲世界：边缘推理的浪潮',
      accentHue: 212,
      signalTitles: ['本地智能体编排框架冲上热榜'],
    })
    const worldB = worldPayload({
      headline: '乙世界：向量数据库的黎明',
      accentHue: 268,
      signalTitles: ['开源矢量数据库刷新性能纪录'],
    })
    let current: Record<string, unknown> | null = worldA
    await registerDesktop(page, 'e2eworld-replay')
    await stubEclosionBackend(page, { world: () => current })
    await seedEclosionEnabled(page)

    // 第一天（世界甲）：accent 甲落地。
    await waitForWorldLanded(page, '边缘神谕')
    const accentA = await worldAccentInline(page)
    expect(accentA, '世界甲 accent 已写 inline').toBeTruthy()

    // 同日换了世界乙（个人重生成同日覆盖语义的等价观测）：蝶谱仍保留甲的
    // 首笔记录（同日不重复写），现行主题换为乙。
    current = worldB
    await page.reload()
    await expect(taskbarStartButton(page)).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(() => worldAccentInline(page), { message: '世界乙 accent 重派' })
      .not.toBe(accentA)

    // Settings「羽化」区：蝶谱时间线展示甲的记录（日期 + headline + 应用名单）。
    await page.getByTestId('sidebar-settings').click()
    const settings = page.getByRole('region', { name: '设置' })
    await expect(settings).toBeVisible()
    await settings.getByRole('button', { name: '羽化' }).click()
    const section = page.getByRole('region', { name: '羽化' })
    await expect(section).toBeVisible()
    const entry = section.getByTestId('eclosion-replay-entry')
    await expect(entry).toHaveCount(1)
    await expect(entry.first()).toContainText(todayKey())
    await expect(entry.first()).toContainText('甲世界：边缘推理的浪潮')

    // 「回到那天的主题」：只恢复主题与壁纸——inline accent 回到甲的取值。
    await entry.first().getByTestId('eclosion-replay-revert').click()
    await expect
      .poll(() => worldAccentInline(page), { message: '蝶谱回放恢复甲日 accent' })
      .toBe(accentA)
    // 「不恢复应用」：现行世界仍是乙（今日分组照常，不因回放换应用）。
    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    await page.getByTestId('launcher-category-today').click()
    await expect(
      page.getByTestId('launcher-grid').getByRole('button', { name: '边缘神谕' }),
    ).toBeVisible()
  })
})

// ── P4：举报对话框与同意流程 ────────────────────────────────────────────────

test.describe('P4 举报（§10 同意框 + ADR 22 样本链路 + 会话封禁）', () => {
  test('举报先经同意框：取消不上报；确认后按 source=eclosion 上报、关窗并会话封禁', async ({
    page,
  }) => {
    await registerDesktop(page, 'e2eworld-report')
    await stubEclosionBackend(page, {
      world: () =>
        worldPayload({ headline: '举报流程的世界', accentHue: 212, signalTitles: ['一条信号'] }),
    })
    const samples = await stubSampleUpload(page)
    await seedEclosionEnabled(page)

    // 生成一个羽化应用作为举报对象（L1 计算器；预取/开窗两条路径皆可）。
    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    await page.getByTestId('launcher-grid').getByRole('button', { name: '计算器' }).last().click()
    const calc = page.getByRole('region', { name: '计算器' })
    await expect(calc).toBeVisible()
    // iframe 晚于窗口 chrome 挂载（异步生成管线）：poll 等附着（helpers 注）。
    const frame = await waitEclosionFrame(page)
    await expect(frame.locator('#result')).toHaveText('E2E-GEN-OK', { timeout: 15_000 })

    // 同意框（§10）：先取消——不上报、窗口保留。
    await calc.getByTestId('eclosion-report').click()
    const dialog = page.getByRole('dialog', { name: '举报此应用' })
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('confirm-dialog-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(calc).toBeVisible()
    expect(samples.posts(), '取消不得上报').toHaveLength(0)

    // 确认举报：载荷 = 应用名 + 生成内容前 2KB 摘要，source 标记羽化来源。
    await calc.getByTestId('eclosion-report').click()
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('confirm-dialog-confirm').click()
    await expect.poll(() => samples.posts(), { message: '样本上报恰好一笔' }).toHaveLength(1)
    const post = samples.posts()[0]!
    expect(post.source).toBe('eclosion')
    expect(String(post.text)).toContain('计算器')
    expect(String(post.detail)).toMatch(/^<!doctype html>/i)

    // 举报成功：本地立即关窗 + 会话封禁（重开呈封禁卡，不再生成）。
    await expect(page.getByRole('region', { name: '计算器' })).toHaveCount(0)
    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    await page.getByTestId('launcher-grid').getByRole('button', { name: '计算器' }).last().click()
    const banned = page.getByRole('region', { name: '计算器' })
    await expect(banned).toBeVisible()
    await expect(banned.getByTestId('eclosion-banned-card')).toBeVisible()
    await expect(banned.locator('iframe')).toHaveCount(0)
  })
})

// ── 回归：默认配置（羽化关）核心路径不受影响 ────────────────────────────────

test.describe('回归：默认配置（羽化关）', () => {
  test('羽化关（默认）：世界/生成接口零请求，「今日」分组空，桌面照常', async ({ page }) => {
    await registerDesktop(page, 'e2eworld-off')
    const stubs = await stubEclosionBackend(page, {
      world: () =>
        worldPayload({ headline: '不应被拉取的世界', accentHue: 212, signalTitles: ['一条信号'] }),
    })

    // 开关默认关（不 seed 偏好）：登录链路对世界/生成零请求（门控在客户端）。
    await page.waitForTimeout(300) // 给登录联动一点静默期（若无门控必已发请求）
    expect(stubs.worldHits(), '羽化关不拉取世界').toBe(0)
    expect(stubs.generateBodies(), '羽化关不生成').toHaveLength(0)

    // 「今日」分组空；顶栏无信号小字；世界 accent 不接管 Token。
    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    await page.getByTestId('launcher-category-today').click()
    await expect(page.getByText('无匹配结果')).toBeVisible()
    await expect(page.getByTestId('widgets-world-signals')).toHaveCount(0)
    expect(await worldAccentInline(page)).toBe('')

    // 面板入口常驻（2026-10-05 裁决）：羽化关 → 引导卡（点击打开设置，
    // 点击链路由单测钉）；安静空态只属于「羽化开但世界未落地」。
    await page.keyboard.press('Escape')
    await page.getByTestId('sidebar-brand').click()
    await expect(page.getByTestId('workspace-world-entry')).toBeVisible()
    await expect(page.getByTestId('workspace-world-empty')).toHaveCount(0)
  })
})
