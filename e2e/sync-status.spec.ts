import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar } from './helpers'

/**
 * M4-3 云同步状态面 E2E。
 *
 * 坑 46：E2E 跑无 env 干净构建（本地认证）——同步服务装配已与远程认证构建
 * 解绑（main.tsx 幂等启动，按同步开关自门控），因此这里用 localStorage 种下
 * 同步开关（`agehaos.sync.enabled.v1`）模拟「已开启同步」的用户，走**真实拉取
 * 管线**（boot pull → 状态库 → 设置分区呈现），与 eclosion spec 种 per-user
 * 偏好的口径一致：测的是开启后的运行路径，非绕过准入（开关入口在本地构建
 * 的账户分区不可达）。`/api/sync/*` 全部经 page.route 桩（e2e 无后端）。
 *
 * 断言覆盖：
 * - 降级：本地认证模式行（默认构建的真实能力边界）+ 离线行（真实浏览器
 *   offline 仿真）；
 * - 状态展示：桩 200 → 「上次同步成功」；桩 500 → 「上次同步失败」。
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
  await expect(taskbarStart(page)).toBeVisible({ timeout: 15_000 })
}

/** 任务栏开始按钮（与 helpers 同口径，避免拉入未用的导出）。 */
function taskbarStart(page: Page) {
  return page.getByRole('contentinfo').getByRole('button', { name: /开始/ })
}

async function openSyncSection(page: Page): Promise<void> {
  await revealTaskbar(page)
  await page.getByTestId('sidebar-settings').click()
  const settings = page.getByRole('region', { name: '设置' })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '同步' }).click()
}

/** 桩掉同步 KV（无后端）：settings 域按场景给结果，files 域恒空（首推语义）。 */
async function stubSyncApi(
  page: Page,
  settingsStatus: number,
  settingsBody: string,
): Promise<void> {
  await page.route('**/api/sync/data/files', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) }),
  )
  await page.route('**/api/sync/data', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: settingsStatus, contentType: 'application/json', body: settingsBody })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

function seedSyncEnabled(page: Page): Promise<void> {
  return page.addInitScript(() => {
    localStorage.setItem('agehaos.sync.enabled.v1', '1')
  }).then(() => undefined)
}

test.describe('Settings「同步」区（M4-3 云同步状态面）', () => {
  test('本地认证构建如实降级：模式行在场，无状态块、无开关行', async ({ page }) => {
    await registerDesktop(page, 'e2esync-local')

    await openSyncSection(page)

    const settings = page.getByRole('region', { name: '设置' })
    await expect(settings.getByTestId('sync-mode-local')).toBeVisible()
    await expect(settings.getByTestId('sync-status')).toHaveCount(0)
    // 开关入口仅远程认证渲染，「开关已关闭」行在本地构建不摆。
    await expect(settings.getByTestId('sync-disabled')).toHaveCount(0)
  })

  test('page.route 桩 200：boot 拉取成功 → 「上次同步成功」+ 时间', async ({ page }) => {
    let settingsGets = 0
    await page.route('**/api/sync/data', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        return
      }
      settingsGets += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: JSON.stringify({ settings: { theme: 'dark', fontSize: 'medium', locale: 'zh-CN' } }),
        }),
      })
    })
    await page.route('**/api/sync/data/files', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) }),
    )
    await seedSyncEnabled(page)

    await registerDesktop(page, 'e2esync-ok')

    // boot 拉取确实走了桩（而非状态面凭空显示）。
    expect(settingsGets).toBeGreaterThan(0)

    await openSyncSection(page)

    const line = page.getByRole('region', { name: '设置' }).getByTestId('sync-status-line')
    await expect(line).toContainText('上次同步成功')
    await expect(line).toContainText(/\d/)
  })

  test('page.route 桩 500：真实拉取失败 → 「上次同步失败」', async ({ page }) => {
    await stubSyncApi(page, 500, JSON.stringify({ error: 'boom' }))
    await seedSyncEnabled(page)

    await registerDesktop(page, 'e2esync-fail')

    await openSyncSection(page)

    await expect(page.getByRole('region', { name: '设置' }).getByTestId('sync-status-line')).toContainText(
      '上次同步失败',
    )
  })

  test('离线仿真：离线行如实出现，恢复联网后消失', async ({ page }) => {
    await stubSyncApi(page, 200, JSON.stringify({ data: null }))
    await seedSyncEnabled(page)

    await registerDesktop(page, 'e2esync-offline')
    await openSyncSection(page)

    const settings = page.getByRole('region', { name: '设置' })
    await expect(settings.getByTestId('sync-status')).toBeVisible()
    await expect(settings.getByTestId('sync-offline')).toHaveCount(0)

    await page.context().setOffline(true)
    await expect(settings.getByTestId('sync-offline')).toBeVisible()

    await page.context().setOffline(false)
    await expect(settings.getByTestId('sync-offline')).toHaveCount(0)
  })
})
