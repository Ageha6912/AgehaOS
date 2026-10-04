import { expect, type Frame, type Locator, type Page } from '@playwright/test'

/**
 * 开机覆盖层（docs/DESIGN.md §11）：reload 后立即交互时，退场中的覆盖层会吞掉
 * 指针事件——静止指针之后不会再触发 hover 链，任务栏将永远唤不出。先等覆盖层
 * 卸载（从不曾出现也立即通过），再做任务栏交互。
 */
async function waitForBootLayerDetached(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="boot-screen"]', {
    state: 'detached',
    timeout: 15_000,
  })
}

/**
 * 任务栏自动隐藏（docs/DESIGN.md §9）：把指针移到屏幕底缘唤出任务栏，
 * 等 300ms 滑入动画完成（toHaveAttribute 自带重试）。
 * 每次任务栏收起后再次交互前都要调用。
 */
export async function revealTaskbar(page: Page): Promise<void> {
  await waitForBootLayerDetached(page)
  const size = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.mouse.move(size.width / 2, size.height - 3)
  await expect(page.getByRole('contentinfo')).toHaveAttribute('data-state', 'revealed')
}

/**
 * 开始按钮（限定任务栏）：动态面板自动打开后，其「应用到开始菜单」
 * 按钮也会匹配 /开始/ 正则——不限定作用域会触发 strict mode 冲突。
 */
export function taskbarStartButton(page: Page): Locator {
  return page.getByRole('contentinfo').getByRole('button', { name: /开始/ })
}

/**
 * 动态面板（DDS 域③）：2026-10-02 用户裁决起进桌面不再自动开窗——测试需要
 * 面板时经 Ctrl+K 搜索手动打开，返回面板 region 定位器。
 */
export async function openDynamicPanel(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k')
  const palette = page.getByTestId('search-palette')
  await expect(palette).toBeVisible()
  await palette.getByRole('textbox').fill('动态面板')
  await page.keyboard.press('Enter')
  const panel = page.getByRole('region', { name: '动态面板' })
  await expect(panel).toBeVisible({ timeout: 10_000 })
  return panel
}

/**
 * 把窗口拖出系统栏组的遮盖带（2026-10-03）：system-rails 组（左栏 + 今日
 * 应用列，z-40 chrome）按 z 契约盖在普通窗口（z-30）之上——级联落点恰在
 * 栏带（16~166px）内时，窗口左条带的沙箱内点击会被栏的瓷贴吃掉（坑 75
 * 同族的 E2E 竞态：窗口 x 随级联/动画时相漂移，命中与否随运行轮盘）。
 * 抓标题栏中部右移 180px + 等 400ms 动画落定，使 iframe 交互区离开栏带。
 * 先例：window-resize.spec 的「拖出左栏浮轨下方」。
 */
export async function dragWindowClearOfRails(page: Page, region: Locator): Promise<void> {
  const box = (await region.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 14)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 14, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const moved = (await region.boundingBox())!
  expect(moved.x).toBeGreaterThanOrEqual(170)
}

/**
 * 等待羽化运行时 iframe 附着（生成是异步管线：窗口 chrome 先可见、iframe
 * 后挂载）。⚠️ 不能写 `expect(page.frame(...)).toBeDefined()`——Playwright
 * 1.63 对非 locator 值的 toBeDefined 不做重试、null 也误判为过（实测
 * probe），高负载下 frame 未挂载时会以 TypeError 在下一行爆掉（坑：eclosion-
 * world 举报用例第 3 轮门禁）。用 poll 轮询真实查找。
 */
export async function waitEclosionFrame(page: Page): Promise<Frame> {
  const findFrame = (): Frame | null =>
    page.frames().find((candidate) => /eclosion\.html/.test(candidate.url())) ?? null
  await expect
    .poll(findFrame, {
      timeout: 15_000,
      message: 'sandboxed runner frame (eclosion.html)',
    })
    .not.toBeNull()
  return findFrame()!
}
