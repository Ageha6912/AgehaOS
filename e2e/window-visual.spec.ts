import { expect, test, type Page } from '@playwright/test'

/**
 * Shell 3.0 STEP 7 窗口视觉精修契约（计算样式探针实测，禁止心算 rem）：
 * - 窗体：radius 28px（2026-10-10 空间化裁决 2，--sp-window-radius 档）+
 *   半透明玻璃面 + 40px backdrop blur（.spatial-window 体系）。
 * - 头部：44px（ask 档 44-50）。
 * - 深度层级：active = 更高面实度（0.84）+ 中性强边 + 更深空间软影
 *   （--sp-shadow-window-active）+ 全强度标题；inactive = 基底面（0.72）+
 *   常规边 + 空间基底影（--sp-shadow-window）+ muted 标题。
 * - active 禁止整体变蓝：聚焦描边必须是中性 border-strong（#b9cbe6），
 *   不得再是 primary/50（rgba(47,95,232,0.5)）。
 * 截图取证写 .tmp/shots/（gitignored，永不入库）。
 */

async function register(page: Page): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`winvis-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
}

function probeVisual(regionName: string) {
  return async (page: Page) =>
    page.evaluate((name) => {
      const section = document.querySelector(`section[aria-label="${name}"]`)
      if (!section) return null
      const style = getComputedStyle(section)
      const header = section.querySelector('header')
      const title = header?.querySelector('span.truncate')
      return {
        radius: style.borderRadius,
        blur: style.backdropFilter,
        background: style.backgroundColor,
        border: style.borderTopColor,
        shadow: style.boxShadow,
        headerHeight: header ? header.getBoundingClientRect().height : 0,
        titleColor: title ? getComputedStyle(title).color : '',
      }
    }, regionName)
}

test('window chrome: radius/blur/header + active-inactive depth hierarchy without blue focus', async ({
  page,
}) => {
  await register(page)

  // 开两个窗：后开的「记事」成为 active（前台），「文件」退到 inactive。
  await page.getByTestId('dock-pin-com.ageha.files').click()
  const files = page.getByRole('region', { name: '文件' })
  await expect(files).toBeVisible()
  await page.getByTestId('dock-pin-com.ageha.notes').click()
  const notes = page.getByRole('region', { name: '记事' })
  await expect(notes).toBeVisible()
  await page.waitForTimeout(450) // 开窗飞行动画落定后再探针。

  const visualOf = (name: string) => probeVisual(name)
  const active = await visualOf('记事')(page)
  const inactive = await visualOf('文件')(page)
  expect(active).not.toBeNull()
  expect(inactive).not.toBeNull()

  // 窗体材质（两态同底）：radius 28px 空间档 + 40px 深玻璃 blur。
  expect(active!.radius).toBe('28px')
  expect(inactive!.radius).toBe('28px')
  expect(active!.blur).toContain('blur(40px)')
  expect(inactive!.blur).toContain('blur(40px)')

  // 头部 44px（Shell 3.0 STEP 7 档 44-50）。
  expect(active!.headerHeight).toBeCloseTo(44, 0)
  expect(inactive!.headerHeight).toBeCloseTo(44, 0)

  // 深度层级：active 面更实（84% vs 72%）+ 中性强边 + 更强软影 + 全强度标题。
  expect(active!.background).toBe('rgba(255, 255, 255, 0.84)')
  expect(inactive!.background).toBe('rgba(255, 255, 255, 0.72)')
  expect(active!.border).toBe('rgb(185, 203, 230)') // --ag-border-strong
  expect(inactive!.border).toBe('rgb(217, 227, 244)') // --ag-border
  expect(active!.shadow).toContain('0px 40px 112px') // --sp-shadow-window-active
  expect(inactive!.shadow).toContain('0px 32px 96px') // --sp-shadow-window
  expect(active!.titleColor).toBe('rgb(24, 32, 44)') // text-text
  expect(inactive!.titleColor).toBe('rgb(90, 107, 130)') // text-text-muted
  // active 禁止整体变蓝：聚焦描边不得是 primary（rgb(47, 95, 232)）系。
  expect(active!.border).not.toContain('47, 95, 232')

  // 对照截图 ①：active 记事（前台）+ inactive 文件（后退）。
  await page.mouse.move(10, 300) // 移开指针，避免 Dock 悬停态入镜。
  await page.screenshot({ path: '.tmp/shots/step7-active-inactive.png' })

  // 焦点迁移（Dock 瓷贴单实例激活语义）：点「文件」瓷贴 → 深度层级随迁。
  await page.getByTestId('dock-pin-com.ageha.files').click()
  await page.waitForTimeout(450)
  const switched = await visualOf('文件')(page)
  const dimmed = await visualOf('记事')(page)
  expect(switched!.background).toBe('rgba(255, 255, 255, 0.84)')
  expect(switched!.border).toBe('rgb(185, 203, 230)')
  expect(dimmed!.background).toBe('rgba(255, 255, 255, 0.72)')

  // 对照截图 ②：焦点切换后的 active/inactive 对照。
  await page.mouse.move(10, 300)
  await page.screenshot({ path: '.tmp/shots/step7-focus-switched.png' })
})
