import { expect, type Locator, type Page } from '@playwright/test'

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
