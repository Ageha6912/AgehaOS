import { expect, type Locator, type Page } from '@playwright/test'

/**
 * 任务栏自动隐藏（docs/DESIGN.md §9）：把指针移到屏幕底缘唤出任务栏，
 * 等 300ms 滑入动画完成（toHaveAttribute 自带重试）。
 * 每次任务栏收起后再次交互前都要调用。
 */
export async function revealTaskbar(page: Page): Promise<void> {
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
