import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

/**
 * M2-6 Notes / Settings 窄容器适配 E2E（结构契约归各应用 test 的窄容器组；
 * 真实视口几何 / 容器分支 / 核心流程归本文件，生产构建 + vite preview）：
 * - 窄容器（经 Mobile AppHost 打开，360×800）：Notes「列表↔编辑器」单面
 *   切换（新建保存 / 返回重开全流程可用）、Settings「分区列表↔分区详情」
 *   纵向单列（切分区 / 切设置项可用），两应用宿主面板零横向溢出，返回键
 *   命中区 ≥44px（§35.3）；
 * - 桌面回归：宽容器双栏原样（侧栏在场、窄容器单面结构不渲染），新建
 *   笔记保存 / 切分区与改前等价。
 *
 * 设备档与 e2e/mobile-files.spec.ts 同口径（360×800 + iPhone UA；判定
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

/** 经移动 Dock 位打开应用并断言宿主面板 open + 窗口落地。 */
async function openAppFromDock(page: Page, appId: string): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  await page.locator(`[data-testid="mobile-dock-app"][data-app-id="${appId}"]`).click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
}

/** 桌面开始菜单启动应用（任务栏自动隐藏，先唤出再点开始）。 */
async function launchFromStartMenu(page: Page, appName: RegExp): Promise<void> {
  await revealTaskbar(page)
  await taskbarStartButton(page).click()
  // 「最近」区会让同名瓦片出现两次（最近 + 全部网格），取全部网格项。
  await page
    .getByRole('list', { name: /开始/ })
    .getByRole('button', { name: appName })
    .last()
    .click()
}

/** 宿主面板零横向溢出 + 指定按钮命中区（实测包围盒）≥44×44 的几何探针。 */
function overflowContract(page: Page, probeSelectors: string[]) {
  return page.evaluate((selectors) => {
    const body = document.querySelector('[data-testid="mobile-app-body"]')
    if (!(body instanceof HTMLElement)) return null
    const targets = selectors
      .map((selector) => document.querySelector(selector))
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
    return {
      bodyOverflow: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth },
      hitBoxes: targets.map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          minHeight: getComputedStyle(el).minHeight,
        }
      }),
    }
  }, probeSelectors)
}

/** 命中区契约断言：探针命中目标且每个包围盒 ≥44×44（§35.3）。 */
async function expectTouchTargets(
  page: Page,
  probeSelectors: string[],
): Promise<void> {
  const contract = await overflowContract(page, probeSelectors)
  expect(contract).not.toBeNull()
  expect(contract!.bodyOverflow.scrollWidth).toBe(contract!.bodyOverflow.clientWidth)
  // 探针必须真的命中目标（防选择器失效后循环空转的假通过）。
  expect(contract!.hitBoxes.length).toBe(probeSelectors.length)
  for (const box of contract!.hitBoxes) {
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
}

test.describe('mobile context（360×800 iPhone UA）：Notes 窄容器', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('列表↔编辑器单面切换：新建保存 / 返回重开可用，零横向溢出', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilenotes')
    await openAppFromDock(page, 'com.ageha.notes')

    // 宽容器双栏（侧栏）整块不渲染，首面 = 列表面。
    await expect(page.getByRole('complementary')).toHaveCount(0)
    const host = page.getByTestId('mobile-app-host')
    const listPane = page.getByTestId('notes-list-pane')
    await expect(listPane).toBeVisible()
    await expect(page.getByTestId('notes-editor-pane')).toHaveCount(0)

    // 新建：对话框 → 确定后直接进编辑器面（新建即选中 → 单面切换）。
    await host.getByRole('button', { name: '新建文本文件' }).click()
    const dialog = page.getByRole('dialog', { name: '新建文本文件' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('m2-6-note.txt')
    await dialog.getByRole('button', { name: '确定' }).click()
    await expect(page.getByTestId('notes-editor-pane')).toBeVisible()
    await expect(host.getByText('/Documents/m2-6-note.txt')).toBeVisible()

    // 编辑 + 保存：落 VFS 后保存键禁用（流程与宽容器同一条 save）。
    const editor = host.getByRole('textbox', { name: '笔记编辑器' })
    await editor.fill('hello from narrow')
    const save = host.getByRole('button', { name: '保存' })
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled()

    // 返回列表面 → 重开同一条笔记：持久化内容回读。
    await page.getByTestId('notes-back-to-list').click()
    await expect(listPane).toBeVisible()
    const row = host.getByRole('button', { name: /m2-6-note\.txt/ })
    await expect(row).toHaveAttribute('aria-current', 'true')
    await row.click()
    await expect(page.getByTestId('notes-editor-pane')).toBeVisible()
    await expect(host.getByRole('textbox', { name: '笔记编辑器' })).toHaveValue(
      'hello from narrow',
    )

    // 几何契约：宿主面板零横向溢出；返回键 / 保存键命中区 ≥44×44（§35.3）。
    await expectTouchTargets(page, [
      '[data-testid="notes-back-to-list"]',
      '[data-testid="notes-save"]',
    ])
  })
})

test.describe('mobile context（360×800 iPhone UA）：Settings 窄容器', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('分区列表↔分区详情纵向单列：切分区 / 切设置项可用，零横向溢出', async ({ page }) => {
    await registerAndReachShell(page, 'e2emobilesettings')
    await openAppFromDock(page, 'com.ageha.settings')

    // 双栏（侧栏）不渲染，首面 = 纵向单列分区列表；分区内容默认不挂载。
    await expect(page.getByRole('complementary')).toHaveCount(0)
    const host = page.getByTestId('mobile-app-host')
    const nav = page.getByTestId('settings-section-nav')
    await expect(nav).toBeVisible()
    await expect(page.getByRole('region', { name: '外观' })).toHaveCount(0)

    // 切分区：点入外观 → 单列详情面（一次只挂载当前分区）。
    await nav.getByRole('button', { name: '外观' }).click()
    await expect(page.getByTestId('settings-section-pane')).toBeVisible()
    await expect(page.getByRole('region', { name: '外观' })).toBeVisible()

    // 切设置项：主题切深色真实生效（真实能力开关，非摆设）。
    const dark = host.getByRole('button', { name: '深色' })
    await dark.click()
    await expect(dark).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('dark')),
    ).toBe(true)

    // 返回分区列表：当前分区高亮（aria-current）。
    await page.getByTestId('settings-back-to-sections').click()
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button', { name: '外观' })).toHaveAttribute('aria-current', 'true')

    // 再切一个分区：详情面跟手（分区切换本身可用）。
    await nav.getByRole('button', { name: '语言' }).click()
    await expect(page.getByTestId('settings-section-pane')).toBeVisible()
    await expect(page.getByRole('region', { name: '语言' })).toBeVisible()

    // 几何契约：宿主面板零横向溢出；返回键命中区 ≥44×44（§35.3）。
    await expectTouchTargets(page, ['[data-testid="settings-back-to-sections"]'])
  })
})

test.describe('desktop context 回归：两应用宽容器与改前等价', () => {
  test('桌面 Notes：双栏原样（侧栏在场、单面结构缺席）、新建保存流程不变', async ({ page }) => {
    await page.goto('/')
    const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
    await expect(loginForm).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '没有账户？创建一个' }).click()
    await page.getByLabel('用户名').fill('e2edesknotes')
    await page.getByLabel('密码').fill('secret123')
    await page.getByRole('button', { name: '注册' }).click()

    await launchFromStartMenu(page, /记事/)
    const notesWindow = page.getByRole('region', { name: '记事' })
    await expect(notesWindow).toBeVisible()

    // 宽容器（默认窗口 720×480 > 560 断点）：侧栏在场、窄容器单面结构不渲染。
    const sidebar = page.getByRole('complementary').filter({ hasText: '/Documents' })
    await expect(sidebar).toBeVisible()
    await expect(page.getByTestId('notes-list-pane')).toHaveCount(0)
    await expect(page.getByTestId('notes-editor-pane')).toHaveCount(0)
    await expect(page.getByTestId('notes-back-to-list')).toHaveCount(0)

    // 桌面流程原样：新建 → 编辑器列出现 → 编辑保存。
    await page.getByRole('button', { name: '新建文本文件' }).click()
    const dialog = page.getByRole('dialog', { name: '新建文本文件' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('desktop-note.txt')
    await dialog.getByRole('button', { name: '确定' }).click()
    const editor = page.getByRole('textbox', { name: '笔记编辑器' })
    await expect(editor).toBeVisible()
    await editor.fill('hello from desktop')
    const save = page.getByRole('button', { name: '保存' })
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled()
    // 双栏仍在场（宽容器无单面切换）。
    await expect(sidebar).toBeVisible()
  })

  test('桌面 Settings：双栏原样（侧栏在场、单列结构缺席）、切分区流程不变', async ({ page }) => {
    await page.goto('/')
    const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
    await expect(loginForm).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '没有账户？创建一个' }).click()
    await page.getByLabel('用户名').fill('e2edesksettings')
    await page.getByLabel('密码').fill('secret123')
    await page.getByRole('button', { name: '注册' }).click()

    await launchFromStartMenu(page, /设置/)
    const settingsWindow = page.getByRole('region', { name: '设置' })
    await expect(settingsWindow).toBeVisible()

    // 宽容器（默认窗口 840×560 > 560 断点）：侧栏在场、默认挂载外观分区；
    // 窄容器单列结构（分区列表 nav / 详情面 / 返回键）不渲染。
    const sidebar = page.getByRole('complementary').filter({ hasText: '外观' })
    await expect(sidebar).toBeVisible()
    await expect(page.getByRole('region', { name: '外观' })).toBeVisible()
    await expect(page.getByTestId('settings-section-nav')).toHaveCount(0)
    await expect(page.getByTestId('settings-section-pane')).toHaveCount(0)
    await expect(page.getByTestId('settings-back-to-sections')).toHaveCount(0)

    // 桌面流程原样：侧栏切分区 → 分区内容替换。
    await sidebar.getByRole('button', { name: '语言' }).click()
    await expect(page.getByRole('region', { name: '语言' })).toBeVisible()
    await expect(page.getByRole('region', { name: '外观' })).toHaveCount(0)
    await expect(sidebar).toBeVisible()
  })
})
