import { expect, test, type Page } from '@playwright/test'

/**
 * M2-5 Files 窄容器适配 E2E（结构契约归 src/apps/files/FileManager.test.tsx；
 * 真实视口几何 / 容器分支 / 触屏语义归本文件，生产构建 + vite preview）：
 * - 窄容器（经 Mobile AppHost 打开 Files，360×800）：固定侧栏收起为顶部
 *   目录 chip 行，切换目录可用（文档 → 面包屑/页脚路径跟随）、「首击选中
 *   再击打开」进目录/开文件可用，宿主面板零横向溢出（横向交互只属于
 *   data-no-edge-back 豁免面：M2-4 的工具栏行 + 本片的 chip 行）；
 * - 桌面回归：菜单栏打开 Files 窗口——侧栏 w-44 在场、chip 行不渲染、
 *   单击仅选中 / 双击才进入（桌面 DOM 与交互和改前等价）。
 *
 * 设备档与 e2e/mobile-app-host.spec.ts 同口径（360×800 + iPhone UA；判定
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

/** 经移动 Dock 位打开 Files 并断言宿主面板 open + 窗口落地。 */
async function openFilesFromDock(page: Page): Promise<void> {
  const shell = page.locator('[data-shell="mobile"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-testid="mobile-dock-app"][data-app-id="com.ageha.files"]').click()
  const host = page.getByTestId('mobile-app-host')
  await expect(host).toHaveAttribute('data-state', 'open')
  await expect(host).not.toHaveAttribute('data-window-id', '')
  await expect(shell).toHaveAttribute('data-nav-view', 'app')
  await expect(shell).toHaveAttribute('data-window-count', '1')
}

test.describe('mobile context（360×800 iPhone UA）：Files 窄容器', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('侧栏收起为目录 chip 行：切换可用、进目录/开文件可用、宿主零横向溢出', async ({
    page,
  }) => {
    await registerAndReachShell(page, 'e2emobilefiles')
    await openFilesFromDock(page)

    // 侧栏收起（窄容器整块不渲染），chip 行接管目录切换。
    await expect(page.getByRole('complementary')).toHaveCount(0)
    const switcher = page.getByTestId('files-dir-switcher')
    await expect(switcher).toBeVisible()

    // 目录切换可用：点「文档」chip → 面包屑 + 页脚路径跟随。
    await switcher.getByRole('button', { name: '文档' }).click()
    await expect(page.getByText('/Documents', { exact: true })).toBeVisible()
    await expect(
      switcher.getByRole('button', { name: '文档' }),
    ).toHaveAttribute('aria-current', 'true')

    // 触屏建目录（工具栏操作簇可横滚到达）→ tile 出现。
    await page.getByRole('button', { name: '新建文件夹' }).click()
    const dialog = page.getByRole('dialog', { name: '新建文件夹' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('projects')
    await dialog.getByRole('button', { name: '确定' }).click()

    // 触屏语义：首击选中、再击进入目录（不依赖 dblclick）。
    const dirTile = page
      .locator('[data-window-id]')
      .getByRole('button', { name: /projects/ })
    await expect(dirTile).toBeVisible()
    await dirTile.click()
    await expect(dirTile).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('/Documents', { exact: true })).toBeVisible()
    await dirTile.click()
    await expect(page.getByText('/Documents/projects', { exact: true })).toBeVisible()

    // 文件：再击打开预览弹层，关闭可用。
    await page.getByRole('button', { name: '新建文本文件' }).click()
    const fileDialog = page.getByRole('dialog', { name: '新建文本文件' })
    await expect(fileDialog).toBeVisible()
    await fileDialog.getByRole('textbox').fill('note.txt')
    await fileDialog.getByRole('button', { name: '确定' }).click()
    const fileTile = page
      .locator('[data-window-id]')
      .getByRole('button', { name: /note\.txt/ })
    await expect(fileTile).toBeVisible()
    await fileTile.click()
    await expect(fileTile).toHaveAttribute('aria-pressed', 'true')
    await fileTile.click()
    const preview = page.getByRole('dialog', { name: '文件预览' })
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: '关闭预览' }).click()
    await expect(preview).toHaveCount(0)

    // 横向溢出契约（M2-4 同口径）：宿主面板零横向溢出，横向交互只属于
    // 豁免面（工具栏行 + chip 行），chip 命中区 ≥44px。
    const contract = await page.evaluate(() => {
      const body = document.querySelector('[data-testid="mobile-app-body"]')
      const switcherEl = document.querySelector('[data-testid="files-dir-switcher"]')
      const toolbar = document.querySelector('[data-testid="files-toolbar"]')
      if (
        !(body instanceof HTMLElement)
        || !(switcherEl instanceof HTMLElement)
        || !(toolbar instanceof HTMLElement)
      ) {
        return null
      }
      const chip = switcherEl.querySelector('button')
      return {
        bodyOverflow: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth },
        switcher: {
          exempt: switcherEl.hasAttribute('data-no-edge-back'),
          touchAction: getComputedStyle(switcherEl).touchAction,
          innerTouchAction: chip ? getComputedStyle(chip).touchAction : null,
          chipMinHeight: chip ? getComputedStyle(chip).minHeight : null,
          scrollWidth: switcherEl.scrollWidth,
          clientWidth: switcherEl.clientWidth,
        },
        toolbarExempt: toolbar.hasAttribute('data-no-edge-back'),
      }
    })
    expect(contract).not.toBeNull()
    expect(contract!.bodyOverflow.scrollWidth).toBe(contract!.bodyOverflow.clientWidth)
    expect(contract!.switcher.exempt).toBe(true)
    expect(contract!.switcher.touchAction).toBe('pan-x pan-y')
    expect(contract!.switcher.innerTouchAction).toBe('pan-x pan-y')
    expect(contract!.switcher.chipMinHeight).toBe('44px')
    // chip 行内容确实横向溢出（目录多于视口，豁免面名副其实）。
    expect(contract!.switcher.scrollWidth).toBeGreaterThan(contract!.switcher.clientWidth)
    expect(contract!.toolbarExempt).toBe(true)
  })
})

test.describe('desktop context 回归：Files 宽容器与改前等价', () => {
  test('桌面窗口：侧栏在场、chip 行不渲染、单击仅选中 / 双击才进入', async ({ page }) => {
    await registerAndReachShell(page, 'e2efilesdesk')

    const desktop = page.locator('[data-shell="desktop"]')
    await expect(desktop).toBeVisible({ timeout: 15_000 })

    // 菜单栏开 Files 窗口（既有桌面路径）。
    await page.getByTestId('menu-bar').getByRole('button', { name: '文件' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '打开文件管理器' }).click()
    const windowBody = page.locator('[data-window-id]').first()
    await expect(windowBody).toBeVisible()

    // 宽容器（默认窗口 880×560 > 560 断点）：固定侧栏在场，chip 行不渲染。
    // 桌面另有右栏 System Center（role=complementary），按侧栏内容过滤。
    const sidebar = page.getByRole('complementary').filter({ hasText: '快速访问' })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('button', { name: '文档' })).toBeVisible()
    await expect(page.getByTestId('files-dir-switcher')).toHaveCount(0)

    // 桌面交互语义原样：单击根目录 tile 仅选中，不进入。
    // 发现用 pressed:false（aria-pressed="false" 排除侧栏同名按钮——Playwright
    // 的 pressed 过滤只按显式属性匹配）；点击后属性翻 true，同一 locator
    // 不再命中，断言/后续交互改用 pressed:true 重定位。
    await windowBody.getByRole('button', { name: '文档', pressed: false }).click()
    const tile = windowBody.getByRole('button', { name: '文档', pressed: true })
    await expect(tile).toBeVisible()
    await expect(windowBody.getByRole('button', { name: '下载', pressed: false })).toBeVisible()

    // 双击进入目录（桌面既有行为）。
    await tile.dblclick()
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('button', { name: '文档' }),
    ).toBeVisible()
    await expect(windowBody.getByRole('button', { name: '下载', pressed: false })).toHaveCount(0)
  })
})
