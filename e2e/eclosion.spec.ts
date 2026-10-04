import { expect, test, type Page } from '@playwright/test'

import { dragWindowClearOfRails, revealTaskbar, taskbarStartButton, waitEclosionFrame } from './helpers'

/**
 * 羽化模式 P1 端到端（AI-GENERATED-APPS-DESIGN §12 P1 验收 / §9.3 准入）：
 * 默认构建（本地认证、无后端、羽化关）下的桌面回归 + Settings「羽化」区 +
 * 开启态两条真浏览器路径（经 page.route 桩 /api/eclosion/*，产物走真实
 * dist 里的 iframe 沙箱与 runner）。
 *
 * 沙箱本身的 CSP 禁网/不透明 origin/增量渲染/破茧在 eclosion-runtime.spec.ts
 * （切片一）覆盖，此处不重复；「远程认证 + 真 LLM 上游流式」不在默认 E2E 环境
 * （无后端、本地认证），服务端交互以 route 桩驱动，真实上游验收属 P0 spike
 * 手工口径（docs/PITFALLS.md）。
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

/** 启动器网格里点击应用瓦片（最近区可能同名重复，取网格内最后一枚）。 */
async function launchFromLauncher(page: Page, appName: string | RegExp): Promise<void> {
  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  await page.getByTestId('launcher-grid').getByRole('button', { name: appName }).last().click()
}

/** 桩掉羽化 API（route 跨 reload 存活，须在重新加载前安装）。 */
async function stubEclosionApi(
  page: Page,
  generate: { status: number; body: string; contentType: string },
  quotaTiers?: Partial<Record<'basic' | 'today' | 'imagine', { used: number; limit: number }>>,
): Promise<void> {
  const tiers = {
    basic: quotaTiers?.basic ?? { used: 0, limit: 10 },
    today: quotaTiers?.today ?? { used: 0, limit: 30 },
    imagine: quotaTiers?.imagine ?? { used: 0, limit: 20 },
  }
  await page.route('**/api/eclosion/quota', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: generate.status === 200 || generate.status === 429,
        quotas: tiers,
        resetAtIso: '2026-10-04T00:00:00.000Z',
      }),
    }),
  )
  await page.route('**/api/eclosion/generate', (route) =>
    route.fulfill({
      status: generate.status,
      contentType: generate.contentType,
      body: generate.body,
    }),
  )
}

/**
 * 模拟「远程模式下已开启羽化」的用户：登录后按其真实 userId 写入按用户分键的
 * 持久化偏好，再 reload 让装配链 hydrate（本地认证下无法经 UI 开启——置灰是
 * 设计 §9.3 的准入裁决，此处测的是开启后的运行路径，非绕过准入）。
 */
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

/** 桩用的「生成计算器」：骨架 + 脚本（破茧后脚本真实执行并写结果）。 */
const GENERATED_CALCULATOR_SSE = [
  'event: meta',
  'data: {"requestId":"e2e","model":"stub-model"}',
  '',
  'event: think',
  'data: {"chars":42}',
  '',
  'event: delta',
  'data: {"text":"<!doctype html><html><head><style>#result{font-size:24px}</style></head><body><div id=\\"result\\">booting</div><button id=\\"inc\\" type=\\"button\\">+1</button>"}',
  '',
  'event: delta',
  "data: {\"text\":\"<script>document.getElementById('result').textContent = 'E2E-GEN-OK';document.getElementById('inc').addEventListener('click',function(){var r=document.getElementById('result');r.textContent='E2E-CLICK-'+(1+1);});</script></body></html>\"}",
  '',
  'event: done',
  'data: {"bytes":300,"ms":12}',
  '',
  '',
].join('\n')

/** 桩用的「生成时钟」：破茧后脚本经 AgehaOS.storage 记忆并回读城市清单（SDK 端到端）。 */
const GENERATED_CLOCK_SSE = [
  'event: meta',
  'data: {"requestId":"e2e-clock","model":"stub-model"}',
  '',
  'event: think',
  'data: {"chars":9}',
  '',
  'event: delta',
  'data: {"text":"<!doctype html><html><head><style>#clocks{font:14px/1.6 system-ui}</style></head><body><div id=\\"clocks\\">booting</div>"}',
  '',
  'event: delta',
  "data: {\"text\":\"<script>(function(){var el=document.getElementById('clocks');if(!window.AgehaOS||!AgehaOS.storage){el.textContent='NO-STORAGE';return}AgehaOS.storage.set('clocks',['Asia/Tokyo','Europe/Berlin']).then(function(){return AgehaOS.storage.get('clocks')}).then(function(v){el.textContent='CLOCKS-'+v.join('|')}).catch(function(e){el.textContent='ERR-'+e.message})})()</script></body></html>\"}",
  '',
  'event: done',
  'data: {"bytes":320,"ms":14}',
  '',
  '',
].join('\n')

test.describe('默认配置（羽化关）核心路径不受影响', () => {
  test('启动器只有原生计算器入口，原生实现可正常计算', async ({ page }) => {
    await registerDesktop(page, 'e2ecol-off')

    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    const grid = page.getByTestId('launcher-grid')
    // 三件套隐藏：同名「计算器」瓦片恰一枚（羽化版接管时才会两枚都出现是
    // 不可能的——接管时原生被隐藏；这里钉「关 → 仅原生」）。
    await expect(grid.getByRole('button', { name: '计算器' })).toHaveCount(1)
    await grid.getByRole('button', { name: '计算器' }).click()

    const calculator = page.getByRole('region', { name: '计算器' })
    await expect(calculator).toBeVisible()
    const display = calculator.getByTestId('calculator-display')
    await expect(display).toBeVisible() // 原生组件（非 iframe 宿主）
    await expect(calculator.locator('iframe')).toHaveCount(0)
    await expect(calculator.getByTestId('eclosion-regenerate')).toHaveCount(0)

    // 原生计算器功能照常（§12 P1 验收末条：默认路径不受 AI 可用性影响）。
    await calculator.getByTestId('calculator-key-1').click()
    await calculator.getByTestId('calculator-key-+').click()
    await calculator.getByTestId('calculator-key-2').click()
    await calculator.getByTestId('calculator-key-=').click()
    await expect(display).toHaveText('3')
  })
})

test.describe('Settings「羽化」区（本地认证默认构建）', () => {
  test('分区在场、总开关默认关且本地认证置灰并提示原因', async ({ page }) => {
    await registerDesktop(page, 'e2ecol-local')

    await page.getByTestId('sidebar-settings').click()
    const settings = page.getByRole('region', { name: '设置' })
    await expect(settings).toBeVisible()
    await settings.getByRole('button', { name: '羽化' }).click()

    const section = page.getByRole('region', { name: '羽化' })
    await expect(section).toBeVisible()

    // §9.3 准入：本地认证下总开关置灰 + 提示原因；默认关。
    const toggle = section.getByTestId('eclosion-enable-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(toggle).toBeDisabled()
    await expect(
      section.getByText('羽化模式仅在远程认证模式下可用；本地认证下始终使用原生应用。'),
    ).toBeVisible()

    // 三件套生成方式子开关随总开关置灰（默认羽化位）。
    const calcMode = section.getByTestId('eclosion-mode-calculator-toggle')
    await expect(calcMode).toHaveAttribute('aria-checked', 'true')
    await expect(calcMode).toBeDisabled()

    // 额度探测优雅降级：无后端时显示不可用（而非报错）。
    await expect(section.getByTestId('eclosion-quota')).toContainText('暂无法获取额度')
  })
})

test.describe('开启态（按用户持久化偏好，route 桩驱动）', () => {
  test('无 Key（503 ai-not-configured）→ 回落原生计算器，可计算且标题栏提示', async ({ page }) => {
    await registerDesktop(page, 'e2ecol-503')
    await stubEclosionApi(page, {
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'ai-not-configured' }),
    })
    await seedEclosionEnabled(page)

    // 开启态：启动器由羽化计算器接管（仍恰一枚同名瓦片）。
    await revealTaskbar(page)
    await taskbarStartButton(page).click()
    const grid = page.getByTestId('launcher-grid')
    await expect(grid.getByRole('button', { name: '计算器' })).toHaveCount(1)
    await grid.getByRole('button', { name: '计算器' }).click()

    // 503 属确定性失败（不重试）→ 立即回落原生实现，标题栏标注。
    const fallenBack = page.getByRole('region', { name: '计算器 · 已回落经典版' })
    await expect(fallenBack).toBeVisible({ timeout: 15_000 })
    const display = fallenBack.getByTestId('calculator-display')
    await expect(display).toBeVisible()
    await fallenBack.getByTestId('calculator-key-7').click()
    await fallenBack.getByTestId('calculator-key-×').click()
    await fallenBack.getByTestId('calculator-key-6').click()
    await fallenBack.getByTestId('calculator-key-=').click()
    await expect(display).toHaveText('42')

    // 重新羽化按钮在场（回落态也保留恢复入口；AI 徽标已按 2026-10-03 裁决移除）。
    await expect(fallenBack.getByTestId('eclosion-regenerate')).toBeVisible()
  })

  test('SSE 桩 → 真浏览器完整管线：沙箱挂载、破茧脚本执行、进度条收起', async ({ page }) => {
    await registerDesktop(page, 'e2ecol-sse')
    await stubEclosionApi(page, {
      status: 200,
      contentType: 'text/event-stream',
      body: GENERATED_CALCULATOR_SSE,
    })
    await seedEclosionEnabled(page)

    await launchFromLauncher(page, '计算器')
    const calcWindow = page.getByRole('region', { name: '计算器' })
    await expect(calcWindow).toBeVisible()

    // 真实沙箱：iframe 指向 dist 内运行时页（带 ?v= 破缓存）。
    const iframe = calcWindow.locator('iframe')
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(iframe).toHaveAttribute('src', /\/apps\/runtime\/eclosion\.html\?v=/)

    // 破茧后生成代码真实执行（脚本由宿主截留、power-on 注入）。
    // iframe 晚于窗口 chrome 挂载（异步生成管线）：poll 等附着（helpers 注）。
    const frame = await waitEclosionFrame(page)
    await expect(frame.locator('#result')).toHaveText('E2E-GEN-OK', { timeout: 15_000 })

    // 生成代码的事件绑定在沙箱内可用（点击 → 脚本改写结果）。
    // 先把窗口拖出系统栏组遮盖带（z 契约上轨盖窗，见 helpers）。
    await dragWindowClearOfRails(page, calcWindow)
    await frame.locator('#inc').click()
    await expect(frame.locator('#result')).toHaveText('E2E-CLICK-2')

    // 破茧完成：进度条消失、标题不回落、宿主配件在场。
    await expect(page.getByTestId('eclosion-progress')).toHaveCount(0)
    await expect(calcWindow.getByTestId('eclosion-regenerate')).toBeVisible()

    // 重启秒开（§12 P1 验收）：生成产物已落 IndexedDB，重开走缓存。
    await calcWindow.getByRole('button', { name: '关闭窗口' }).click()
    await launchFromLauncher(page, '计算器')
    const reopened = page.getByRole('region', { name: '计算器' })
    await expect(reopened).toBeVisible()
    // 帧定位必须锚定新窗口自己的 iframe：关窗退场 ghost 在动画播完前仍挂着
    // 旧 iframe（保留 E2E-CLICK-2 状态），page.frame({url}) 会先撞上它（高负载
    // 下 rAF 停滞、ghost 更晚卸载——实测偶发）。
    const cachedFrame = reopened.locator('iframe').contentFrame()
    await expect(cachedFrame.locator('#result')).toHaveText('E2E-GEN-OK', { timeout: 15_000 })
  })

  test('时钟（规格授予 storage）→ AgehaOS.storage 端到端：沙箱客户端经宿主桥落 appId 命名空间', async ({
    page,
  }) => {
    await registerDesktop(page, 'e2ecol-sdk')
    await stubEclosionApi(page, {
      status: 200,
      contentType: 'text/event-stream',
      body: GENERATED_CLOCK_SSE,
    })
    await seedEclosionEnabled(page)

    await launchFromLauncher(page, '时钟')
    const clockWindow = page.getByRole('region', { name: '时钟' })
    await expect(clockWindow).toBeVisible()

    // power-on 能力声明按 clock 规格推导（theme + storage）→ AgehaOS.storage 在场，
    // 生成脚本 set→get 往返真实宿主桥（逐请求规格权限 + appId 命名空间）。
    // iframe 晚于窗口 chrome 挂载：poll 等附着（helpers 注）。
    const frame = await waitEclosionFrame(page)
    await expect(frame.locator('#clocks')).toHaveText('CLOCKS-Asia/Tokyo|Europe/Berlin', {
      timeout: 15_000,
    })

    const stored = await page.evaluate(() =>
      localStorage.getItem('agehaos.sdk.storage.com.ageha.eclosion.clock'),
    )
    expect(stored).toContain('Asia/Tokyo')
    expect(stored).toContain('Europe/Berlin')
  })
})

/**
 * 想象搜索（AI-GENERATED-APPS-DESIGN §7 / §12 P3 验收）：Ctrl+K 输入 → 想象项
 * 出现 → Enter 生成窗口打开（route 桩 SSE 驱动真实沙箱管线）；违规输入不出现
 * 想象项（客户端 filterContentText 半场）。
 */
test.describe('想象搜索（开启态，P3）', () => {
  test('Ctrl+K 输入「番茄钟」→ Enter 生成可用窗口；违规词不出现想象项', async ({ page }) => {
    await registerDesktop(page, 'e2ecol-imagine')
    await stubEclosionApi(page, {
      status: 200,
      contentType: 'text/event-stream',
      body: GENERATED_CALCULATOR_SSE,
    })
    await seedEclosionEnabled(page)

    // Ctrl+K 呼出搜索面板（§15/§24）。
    await page.keyboard.press('Control+k')
    const input = page.getByTestId('search-input')
    await expect(input).toBeVisible()

    // 想象域出现在两域之后；文案形如「✦ 即时羽化「番茄钟」应用」。
    const item = page.getByTestId('search-result-imagine')
    await input.fill('番茄钟')
    await expect(item).toBeVisible()
    await expect(item).toContainText('即时羽化「番茄钟」应用')

    // 违规词（客户端 filterContentText violation）：不显示想象项，无生成。
    await input.fill('赌博')
    await expect(page.getByTestId('search-result-imagine')).toHaveCount(0)
    // 羽化关闭时同 query 也不出现（门控另一半场由单测钉死，此处只验正向路径）。

    // 回到合法 query，Enter 即生成（非 launchApp）。
    await input.fill('番茄钟')
    await expect(item).toBeVisible()
    await input.press('Enter')
    await expect(page.getByTestId('search-palette')).toHaveCount(0)

    // 生成窗口打开：标题 = query；真实沙箱 iframe + 破茧脚本执行。
    const win = page.getByRole('region', { name: '番茄钟' })
    await expect(win).toBeVisible({ timeout: 15_000 })
    const iframe = win.locator('iframe')
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    const frame = await waitEclosionFrame(page)
    await expect(frame.locator('#result')).toHaveText('E2E-GEN-OK', { timeout: 15_000 })
    await expect(win.getByTestId('eclosion-regenerate')).toBeVisible()
  })

  test('额度耗尽（429 quota-exceeded）→ 想象应用错误卡：剩余额度 + 重置时间提示清晰', async ({
    page,
  }) => {
    await registerDesktop(page, 'e2ecol-quota')
    await stubEclosionApi(
      page,
      {
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'quota-exceeded', scope: 'imagine' }),
      },
      { imagine: { used: 20, limit: 20 } },
    )
    await seedEclosionEnabled(page)

    // Ctrl+K 想象搜索照常出项（客户端门控不知晓服务端额度），Enter 触发生成。
    await page.keyboard.press('Control+k')
    const input = page.getByTestId('search-input')
    await input.fill('番茄钟')
    await expect(page.getByTestId('search-result-imagine')).toBeVisible()
    await input.press('Enter')

    // 429 属确定性失败：不重试、无原生兜底（L3）→ 错误卡；提示带当档
    // 剩余额度（20/20 已用完）与重置时间（§9.3：客户端显示剩余额度与重置时间）。
    const win = page.getByRole('region', { name: '番茄钟' })
    await expect(win).toBeVisible({ timeout: 15_000 })
    const card = win.getByTestId('eclosion-error-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('今日生成额度已用完（20/20）')
    await expect(card).toContainText('重置')
    // 不留无解死局：重试入口在场（额度重置后可手动再来）。
    await expect(win.getByTestId('eclosion-error-retry')).toBeVisible()
  })
})
