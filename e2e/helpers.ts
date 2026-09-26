import { expect, type Page } from '@playwright/test'

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
