import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetAppStore } from '@/store/app-store'

import { StoreApp } from './StoreApp'

beforeEach(() => {
  resetAppStore()
})

/** jsdom 无布局：伪造列表盒尺寸后派发 scroll，驱动 useScrollZone 重读快照。 */
function measureList(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const list = screen.getByTestId('store-list')
  Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true })
  Object.defineProperty(list, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: clientHeight, configurable: true })
  fireEvent.scroll(list)
}

describe('StoreApp', () => {
  it('renders every bundled catalog entry with install actions', () => {
    render(<StoreApp />)

    // 4 样例 + 4 小游戏。
    const names = ['时钟', '画板', '便签', '云笔记', '贪吃蛇', '2048', '记忆翻牌', '扫雷']
    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: '安装' })).toHaveLength(names.length)

    // 列表图标 = 应用徽章系统（DESIGN.md §8），逐条渲染白色字形。
    const badgeCount = screen.getByTestId('store-list').querySelectorAll('li svg').length
    expect(badgeCount).toBe(names.length)
  })

  it('shows the bottom scroll fade only while content extends below the fold', () => {
    render(<StoreApp />)

    // jsdom 下无溢出：无遮罩。
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()

    measureList(0, 1000, 300)
    expect(screen.getByTestId('scroll-fade')).toBeInTheDocument()

    measureList(700, 1000, 300)
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()
  })

  it('always exposes the thin-scrollbar class on the list', () => {
    render(<StoreApp />)

    expect(screen.getByTestId('store-list').className).toContain('scroll-thin')
  })
})
