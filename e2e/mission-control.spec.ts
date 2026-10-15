import { expect, test, type Page } from '@playwright/test'

/**
 * Mission Control E2E（W7，审计 .tmp/spaces-audit.md §10 门禁流）：
 * 入口打开 → Space 条渲染（名称+计数）→ 拖卡到另一 Space 胶囊 →
 * 切过去窗口可见且内容存活（dataset 探针）→ Esc 关闭。
 *
 * 播种法建 Space（`addInitScript` 预写合法 `agehaos.spaces.v1`，spaces.spec
 * 同款，禁生产测试钩子）。拖拽走 Playwright mouse（pointer 事件模型与生产
 * 拖卡路径一致）；「应用零重启」以 dataset 探针钉扎——窗口若 remount，
 * 自定义 dataset 会随 DOM 节点消失。
 */

// 2-worker 高负载下开窗飞行动画/入场 zoom-out 未落定的偶发毛刺重试即愈
//（window-switcher.spec 同款环境级处置）。
test.describe.configure({ retries: 2 })

const SPACES_STORAGE_KEY = 'agehaos.spaces.v1'

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

async function registerAndOpenNotes(page: Page): Promise<void> {
  await page.goto('/')

  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`mc-e2e-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })

  // 开一扇记事窗（provider 缺省归属当前 Space = space-default）；Dock 常驻
  // 瓷贴（§32）z-40 盖过窗口 z-30，无需先唤任务栏。
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  await expect(page.locator('section[aria-label="记事"]')).toBeVisible()
}

test('F4 打开任务视图：拖卡到另一 Space 胶囊，切过去窗口内容存活，Esc 关闭', async ({
  page,
}) => {
  await seedTwoSpaces(page)
  await registerAndOpenNotes(page)

  const notes = page.locator('section[aria-label="记事"]')
  // DOM 探针：窗口若 remount（React 树 reload），dataset 标记会消失。
  await notes.evaluate((el) => {
    ;(el as HTMLElement).dataset.mcProbe = 'alive'
  })

  // 入口打开（F4）→ Space 条渲染：两胶囊 + 名称 + N Apps 计数 + 新建钮。
  await page.keyboard.press('F4')
  const layer = page.getByTestId('mission-control-layer')
  await expect(layer).toBeVisible()
  await expect(layer).toHaveAttribute('aria-label', '任务视图')
  const bar = page.getByTestId('mission-control-spaces')
  await expect(bar.getByTestId('mission-control-space')).toHaveCount(2)
  await expect(bar).toContainText('Desktop 1')
  await expect(bar).toContainText('Desktop 2')
  await expect(bar).toContainText('1 个应用')

  // 拖卡到 Desktop 2 胶囊落点：moveWindowToSpace（拖拽期间禁发 switchSpace）。
  // 删除钮同挂 data-space-id——限定胶囊本体 testid 消歧。
  const card = page.getByTestId('mission-control-card')
  const cardBox = (await card.boundingBox())!
  const target = bar.locator('[data-testid="mission-control-space"][data-space-id="space-work"]')
  const targetBox = (await target.boundingBox())!
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 10 },
  )
  await page.mouse.up()

  // drop 后：卡片随归属迁移从当前 Space 卡片区消失，Desktop 2 计数变 1；
  // active Space 仍未动（切换只由显式的胶囊点击/快捷键触发）。
  await expect(page.getByTestId('mission-control-card')).toHaveCount(0)
  await expect(target).toContainText('1 个应用')
  await expect(
    bar.locator('[data-testid="mission-control-space"][data-space-id="space-default"]'),
  ).toContainText('0 个应用')

  // 切过去（drop 后才动）：窗口可见且 dataset 探针存活——应用零重启。
  await target.click()
  await expect(notes).toBeVisible()
  await expect(notes).toHaveAttribute('data-mc-probe', 'alive')

  // Esc 关闭：层卸载，窗口保持可见。
  await page.keyboard.press('Escape')
  await expect(layer).toHaveCount(0)
  await expect(notes).toBeVisible()
})

test('菜单入口打开任务视图：「+」新建桌面，Esc 关闭', async ({ page }) => {
  await seedTwoSpaces(page)
  await registerAndOpenNotes(page)

  // 菜单入口：窗口菜单 → 任务视图（F4 同款 toggle）。限定菜单栏作用域——
  // 窗口控制钮（关闭/最小化/最大化窗口）的名字都含「窗口」。
  await page.getByTestId('menu-bar').getByRole('button', { name: '窗口' }).click()
  await page.getByRole('menuitem', { name: '任务视图' }).click()
  await expect(page.getByTestId('mission-control-layer')).toBeVisible()

  const bar = page.getByTestId('mission-control-spaces')
  await expect(bar.getByTestId('mission-control-space')).toHaveCount(2)

  // 「+」=createSpace：第 3 枚胶囊出现，计数 0 个应用。
  await page.getByTestId('mission-control-new-space').click()
  await expect(bar.getByTestId('mission-control-space')).toHaveCount(3)
  await expect(bar).toContainText('0 个应用')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mission-control-layer')).toHaveCount(0)
})
