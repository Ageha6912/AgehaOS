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
