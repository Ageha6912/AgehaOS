import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar, taskbarStartButton } from './helpers'

const SPACES_STORAGE_KEY = 'agehaos.spaces.v1'

/**
 * W3 首个 Space E2E（审计 .tmp/spaces-audit.md §6）：**播种法建 Space**——
 * `addInitScript` 预写合法 `agehaos.spaces.v1`（W1 schema：version 1 + 两
 * Space + activeSpaceId；故意不带 W3 的 activeWindowId 字段，顺带钉扎 hydrate
 * 缺省回落），禁生产测试钩子。
 */
async function seedTwoSpaces(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value)
    },
    {
      key: SPACES_STORAGE_KEY,
      value: JSON.stringify({
        version: 1,
        spaces: [
          { id: 'space-default', name: 'Desktop 1', index: 0, createdAt: 1000, updatedAt: 1000 },
          { id: 'space-work', name: 'Desktop 2', index: 1, createdAt: 1000, updatedAt: 1000 },
        ],
        activeSpaceId: 'space-default',
      }),
    },
  )
}

function persistedActiveSpaceId(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) =>
      (JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
        activeSpaceId?: string
      } | null)?.activeSpaceId ?? null,
    SPACES_STORAGE_KEY,
  )
}

/** W8：读完整持久化载荷（含四档绑定表）。 */
function persistedSpacesPayload(page: Page): Promise<{
  activeSpaceId?: string
  spaces?: unknown[]
  workspaceBindings?: Record<string, string>
} | null> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    SPACES_STORAGE_KEY,
  )
}

test('switching spaces with Ctrl+Alt+arrows hides windows without unmounting them', async ({
  page,
}) => {
  await seedTwoSpaces(page)
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('spacesuser')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()

  // 开窗（provider 缺省归属当前 Space = space-default）。
  const startButton = taskbarStartButton(page)
  await expect(startButton).toBeVisible()
  const notesItem = page
    .getByRole('list', { name: /开始/ })
    .getByRole('button', { name: /记事/ })
    .last()
  await revealTaskbar(page)
  await startButton.click()
  await notesItem.click()

  // CSS 定位器（getByRole 默认跳过 display:none 元素，隐藏断言会失真）。
  const notes = page.locator('section[aria-label="记事"]')
  await expect(notes).toBeVisible()
  // DOM 探针：切换若发生卸载重挂（React 树 reload），dataset 标记会消失——
  // 钉扎「渲染过滤=可见性非卸载，切换不销毁窗口」（审计 §6）。
  await notes.evaluate((el) => {
    ;(el as HTMLElement).dataset.spaceProbe = 'alive'
  })

  // Ctrl+Alt+Right → 切到 Desktop 2：窗口不可见但 DOM 存活、active Space 落盘。
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(notes).toBeHidden()
  await expect(notes).toHaveCount(1)
  await expect(notes).toHaveAttribute('data-space-probe', 'alive')
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-work')

  // Ctrl+Alt+Left → 切回：同一 DOM 节点重新可见（应用状态存活、React 树稳定不 reload）。
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(notes).toBeVisible()
  await expect(notes).toHaveAttribute('data-space-probe', 'alive')
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-default')

  // 快捷键往返（审计 §6 验收）：再切走、再切回，行为一致。
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect(notes).toBeHidden()
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(notes).toBeVisible()
})

/**
 * W9（审计 .tmp/spaces-audit.md §12）：Dock Space 感知两档指示 + 跨 Space
 * 点击往返。窗口经 W2 持久化播种（`agehaos.spaces.windows.v1`：files 走瓷贴
 * 代表、动态面板走运行行，均落 space-work），桌面引导进 space-default——
 * 钉扎瓷贴 elsewhere 圆点/运行行降档标注/点击=switchSpace+restore/focus 往返。
 */
test('dock shows two-tier space indicators; cross-space click switches and restores (W9)', async ({
  page,
}) => {
  await seedTwoSpaces(page)
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value)
    },
    {
      key: 'agehaos.spaces.windows.v1',
      value: JSON.stringify({
        version: 1,
        windows: [
          {
            id: 'seed-files',
            appId: 'com.ageha.files',
            title: '文件',
            x: 120,
            y: 90,
            width: 720,
            height: 480,
            state: 'normal',
            spaceId: 'space-work',
            restoreBounds: null,
            zIndex: 2,
          },
          {
            id: 'seed-panel',
            appId: 'com.ageha.dynamic.panel',
            title: '动态面板',
            x: 180,
            y: 130,
            width: 520,
            height: 380,
            state: 'normal',
            spaceId: 'space-work',
            restoreBounds: null,
            zIndex: 3,
          },
        ],
      }),
    },
  )
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('spaces-w9-user')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })

  // ① 瓷贴 elsewhere 档（files 窗在 space-work）：subtle 圆点 + 「在其他空间」
  //    标注，无 primary 条（W9 决定 1）。
  const filesPin = page.getByTestId('dock-pin-com.ageha.files')
  await expect(filesPin.locator('[data-dock-indicator="elsewhere"]')).toBeVisible()
  await expect(filesPin.locator('[data-dock-indicator="active"]')).toHaveCount(0)
  await expect(filesPin).toContainText('在其他空间')

  // ② 运行行 elsewhere 档（动态面板在 space-work）：在列、降透明度、带标注。
  const panelItem = page.getByTestId('taskbar-item-seed-panel')
  await expect(panelItem).toBeVisible()
  await expect(panelItem).toHaveClass(/opacity-60/)
  await expect(panelItem.locator('..')).toContainText('在其他空间')

  // ③ 点击跨 Space 运行行=switchSpace+restore/focus（决定 2）：窗口可见、
  //    activeSpaceId 落盘 space-work；行升档、瓷贴 elsewhere 圆点退场。
  await panelItem.click()
  const panel = page.getByRole('region', { name: '动态面板' })
  await expect(panel).toBeVisible()
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-work')
  await expect(panelItem).not.toHaveClass(/opacity-60/)
  await expect(filesPin.locator('[data-dock-indicator="elsewhere"]')).toHaveCount(0)

  // ④ 当前 Space 瓷贴点击=既有 toggle 语义零变化：聚焦未聚焦的 files 窗→条亮。
  await filesPin.click()
  await expect(filesPin.locator('[data-dock-indicator="active"]')).toBeVisible()

  // ⑤ 快捷键切回 space-default（往返）：窗口隐藏、files 瓷贴回到 elsewhere 档。
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(panel).toBeHidden()
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-default')
  await expect(filesPin.locator('[data-dock-indicator="elsewhere"]')).toBeVisible()
})

/**
 * W8（审计 .tmp/spaces-audit.md §11）：selector 四档映射 Primary Space——
 * personal 首点收养默认 Space（不新播）；study/dev/creative 首点各自播种并
 * 绑定；往返直切；**绑定持久化 round-trip**（刷新后映射保持，再点直切）；
 * 副指示圆点与活跃 Space 一致。全新引导（不预写持久化）验证播种全链路。
 */
test('workspace selector tiers seed, bind and switch spaces; mapping survives reload (W8)', async ({
  page,
}) => {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill('spaces-w8-user')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })

  // 展开面板（品牌钮 pin，交互与鼠标位置解耦）。
  await page.getByTestId('sidebar-brand').click()

  // ① personal 首点：收养默认 Space（不新播、活跃保持、圆点亮在 personal）。
  await page.getByTestId('workspace-option-personal').click()
  await expect(page.getByTestId('workspace-space-dot-personal')).toBeVisible()
  await expect
    .poll(async () => (await persistedSpacesPayload(page))?.workspaceBindings?.personal ?? null)
    .toBe('space-default')
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-default')

  // ② study/dev/creative 首点：各自播种一个 Space 并绑定、活跃跟随、圆点移动。
  const boundIds: Record<string, string> = { personal: 'space-default' }
  for (const tier of ['study', 'dev', 'creative'] as const) {
    await page.getByTestId(`workspace-option-${tier}`).click()
    await expect
      .poll(async () => (await persistedSpacesPayload(page))?.workspaceBindings?.[tier] ?? null)
      .not.toBeNull()
    const bound = ((await persistedSpacesPayload(page))?.workspaceBindings ?? {})[tier]!
    boundIds[tier] = bound
    await expect.poll(() => persistedActiveSpaceId(page)).toBe(bound)
    await expect(page.getByTestId(`workspace-space-dot-${tier}`)).toBeVisible()
    await expect(page.getByTestId('workspace-space-dot-personal')).toHaveCount(0)
  }
  // 四档各一个 Space，共 4 个（无重复 "Desktop 1"）。
  await expect.poll(async () => (await persistedSpacesPayload(page))?.spaces?.length).toBe(4)

  // ③ 往返：点 personal 直切回默认 Space（绑定存活直切，不新播）。
  await page.getByTestId('workspace-option-personal').click()
  await expect.poll(() => persistedActiveSpaceId(page)).toBe('space-default')
  await expect(page.getByTestId('workspace-space-dot-personal')).toBeVisible()
  await expect(page.getByTestId('workspace-space-dot-study')).toHaveCount(0)

  // ④ 绑定持久化 round-trip：刷新后映射保持，点 study 直切回绑定 Space。
  await page.reload()
  await page.getByTestId('sidebar').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
  await page.getByTestId('sidebar-brand').click()
  await page.getByTestId('workspace-option-study').click()
  await expect.poll(() => persistedActiveSpaceId(page)).toBe(boundIds.study)
  await expect(page.getByTestId('workspace-space-dot-study')).toBeVisible()
})
