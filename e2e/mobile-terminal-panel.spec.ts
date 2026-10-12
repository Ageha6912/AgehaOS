import { expect, test, type Page } from '@playwright/test'

/**
 * M3-5 Terminal / 今日世界面板 窄容器适配 E2E（结构契约归各自 *.test.tsx 的
 * 窄容器组；真实视口几何 / 容器分支 / 核心流程归本文件，生产构建 +
 * vite preview）：
 * - 窄容器（经 Mobile AppHost 打开，360×800）：应用网格 → 终端——输入行
 *   触控档 ≥44px 且字号 ≥16px（iOS 聚焦不缩放）、echo 长行折行在输出井内
 *   （井与宿主零横向溢出）、执行一条命令有输出；应用网格 → 今日世界面板
 *   （com.ageha.dynamic.panel）——卡片单列（同列 x 对齐）、刷新钮 44×44、
 *   刷新后卡片照常、宿主零横向溢出；
 * - M4-4 终端快捷键行（窄容器）：五个触控键在场且 ≥44px、行贴终端根底缘
 *   （软键盘弹起时根由 keyboard-inset 让高、行贴键盘上沿——流内几何在此
 *   钉扎，键盘本身归真机冒烟）、点 Tab 补全命令名、点 Ctrl+C 回显 ^C 且
 *   终端仍可用；
 * - 软键盘避让（visualViewport）的样式直写/清理钉在 TerminalApp.test.tsx
 *   （stub visualViewport）；Chromium 模拟无法弹起真软键盘，真机键盘行为
 *   归真机冒烟（HANDOFF 记 notes）；
 * - 桌面既有断言不归本文件（e2e/dynamic-panel.spec.ts 即桌面面板回归，
 *   本切片运行验证；桌面终端无既有 e2e，宽容器 DOM 等价由单测字面组钉住）。
 *
 * 设备档与 e2e/mobile-calculator-store.spec.ts 同口径（360×800 + iPhone UA；
 * 判定不在测试里复算，只断言用户可见结果）。
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

test.describe('mobile context（360×800 iPhone UA）：Terminal / 今日世界面板 窄容器', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('终端：输入行触控档 ≥44px 且 ≥16px、echo 长行折行不溢出、执行命令有输出、零横向溢出', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobileterm')
    await openAppFromGrid(page, 'com.ageha.terminal')

    // 触控档：输入行命中区 ≥44px（§35.3，min-h 类由计算样式证实——
    // isMobile 模拟下 boundingBox 带视觉缩放，44px CSS 盒实测 ~43.8，
    // 与 mobile-calculator-store.spec 的商店键同口径走计算样式）；字号
    // ≥16px——iOS Safari 聚焦小字号输入框会触发页面自动缩放（窄分支
    // text-base 档）。
    const input = page.getByTestId('terminal-input')
    await expect(input).toBeVisible()
    expect(await input.evaluate((el) => getComputedStyle(el).minHeight)).toBe('44px')
    expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize)))
      .toBeGreaterThanOrEqual(16)

    // 核心流程：执行一条命令有输出——回显「命令 pwd」+ 执行结果「/」在
    // 输出井相邻落行（textContent 拼接为 'pwd/'；未出结果时只有 'pwd'）。
    await input.fill('pwd')
    await input.press('Enter')
    await expect(page.getByTestId('terminal-output')).toContainText('pwd/')

    // 等宽长行折行：80 字符 echo 在 328px 内容盒内折行，井自身零横向溢出。
    await input.fill(`echo ${'a'.repeat(80)}`)
    await input.press('Enter')
    await expect(page.getByTestId('terminal-output')).toContainText('a'.repeat(40))
    const well = await page
      .getByTestId('terminal-output')
      .evaluate((el: HTMLElement) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
    expect(well.scrollWidth).toBeLessThanOrEqual(well.clientWidth)

    await expectNoHorizontalOverflow(page)
    await backToHomeFromApp(page)
  })

  test('今日世界面板：卡片单列、刷新钮 44×44、浏览与刷新可用、零横向溢出', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilepanel')
    await openAppFromGrid(page, 'com.ageha.dynamic.panel')

    // 浏览：问候/建议/提示卡照常装配（动态桌面默认关，无壁纸卡）。
    const cards = page.getByTestId('dynamic-panel-cards')
    await expect(cards.getByTestId('panel-card-greeting')).toBeVisible()
    await expect(cards.getByTestId('panel-card-suggest')).toBeVisible()
    await expect(cards.getByTestId('panel-card-tip')).toBeVisible()

    // 单列化：问候卡与提示卡同列（x 对齐；isMobile 模拟的视觉缩放有
    // 亚像素抖动，取 0.5px 容差——双列档下两列 x 相差约半幅 ~170px）、
    // 纵向排列。
    const greetingBox = (await cards.getByTestId('panel-card-greeting').boundingBox())!
    const tipBox = (await cards.getByTestId('panel-card-tip').boundingBox())!
    expect(greetingBox.x).toBeCloseTo(tipBox.x, 0)
    expect(greetingBox.y).toBeLessThan(tipBox.y)

    // 刷新钮触控档 44×44（§35.3，计算样式口径同上）+ 点击重装配卡片仍在。
    const refresh = page.getByTestId('dynamic-panel-refresh')
    const refreshSize = await refresh.evaluate((el: HTMLElement) => {
      const style = getComputedStyle(el)
      return { height: style.height, width: style.width }
    })
    expect(parseFloat(refreshSize.height)).toBe(44)
    expect(parseFloat(refreshSize.width)).toBe(44)
    await refresh.click()
    await expect(cards.getByTestId('panel-card-greeting')).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await backToHomeFromApp(page)
  })

  test('终端快捷键行：五键触控档、行贴终端根底缘、Tab 补全命令、Ctrl+C 中断回显且终端仍可用', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobiletermkeys')
    await openAppFromGrid(page, 'com.ageha.terminal')

    // 五键在场（Esc/Tab/Ctrl+C/↑/↓）且触控档 ≥44px（§35.3，计算样式口径
    // 同上——isMobile 模拟的视觉缩放取计算样式）。
    const row = page.getByTestId('terminal-key-row')
    await expect(row).toBeVisible()
    for (const id of ['esc', 'tab', 'ctrl-c', 'arrow-up', 'arrow-down']) {
      const key = page.getByTestId(`terminal-key-${id}`)
      await expect(key).toBeVisible()
      expect(await key.evaluate((el) => getComputedStyle(el).minHeight)).toBe('44px')
    }

    // 流内几何：快捷键行在输入行之下不遮挡（行顶 ≥ 输入行底），且贴终端
    // 根底缘——软键盘弹起时根由 keyboard-inset 让高，行即贴键盘上沿
    // （键盘本身归真机冒烟，这里钉不遮挡 + 底缘对齐的结构前提）。
    const rootBox = (await page.getByTestId('terminal-root').boundingBox())!
    const inputBox = (await page.getByTestId('terminal-input').boundingBox())!
    const rowBox = (await row.boundingBox())!
    expect(rowBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1)
    expect(Math.abs(rowBox.y + rowBox.height - (rootBox.y + rootBox.height))).toBeLessThan(2)

    // Tab：唯一前缀补全命令名 + 尾随空格（readline/bash 同款）。
    const input = page.getByTestId('terminal-input')
    await input.fill('ec')
    await page.getByTestId('terminal-key-tab').click()
    await expect(input).toHaveValue('echo ')

    // Ctrl+C：中断当前行——回显「提示符 / 草稿^C」并清空输入。
    await input.fill('pwd')
    await page.getByTestId('terminal-key-ctrl-c').click()
    await expect(page.getByTestId('terminal-output')).toContainText('pwd^C')
    await expect(input).toHaveValue('')

    // 中断后终端仍可用：命令照常执行（username 即 whoami 输出）。
    await input.fill('whoami')
    await input.press('Enter')
    await expect(page.getByTestId('terminal-output')).toContainText('e2emobiletermkeys')

    await expectNoHorizontalOverflow(page)
    await backToHomeFromApp(page)
  })
})
