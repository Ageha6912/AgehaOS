import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ScrollFadeList } from './scroll-fade-list'
import { fadeGradient } from './scroll-fade'

describe('fadeGradient（7 档幂律渐隐停靠点）', () => {
  it('生成 to top/to bottom 方向的 7 停靠点 color-mix 渐变', () => {
    const gradient = fadeGradient('to top')
    expect(gradient.startsWith('linear-gradient(to top,')).toBe(true)
    expect(gradient.split('color-mix(')).toHaveLength(8) // 7 个停靠点
    expect(gradient).toContain('var(--color-surface)')
    expect(fadeGradient('to bottom').startsWith('linear-gradient(to bottom,')).toBe(true)
  })

  it('alpha 沿 (1−t)^1.5 幂律衰减：贴边全遮、末端全透', () => {
    const gradient = fadeGradient('to top')
    // t=0 → 100%；t=1/6 → 76.07%；t=1 → 0%（幂律 γ=1.5 的采样值）。
    expect(gradient).toContain('100.00%, transparent) 0.00%')
    expect(gradient).toContain('76.07%, transparent) 16.67%')
    expect(gradient).toContain('35.36%, transparent) 50.00%')
    expect(gradient.trim().endsWith('transparent) 100.00%)')).toBe(true)
  })
})

describe('ScrollFadeList（双缘渐隐遮罩）', () => {
  /** jsdom 无布局：伪造 ul 的三度量后派发 scroll（use-scroll-edge.test 同款）。 */
  function measure(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
    fireEvent.scroll(el)
  }

  it('未到底显示底缘渐隐，到底换顶缘，无溢出双缘皆无', () => {
    render(
      <ScrollFadeList testId="list">
        <li>a</li>
      </ScrollFadeList>,
    )
    const list = screen.getByTestId('list')
    expect(screen.queryByTestId('scroll-fade')).toBeNull()
    expect(screen.queryByTestId('scroll-fade-top')).toBeNull()

    measure(list, 0, 1000, 300)
    const bottom = screen.getByTestId('scroll-fade')
    expect(bottom.style.backgroundImage).toContain('linear-gradient(to top')
    expect(screen.queryByTestId('scroll-fade-top')).toBeNull()

    measure(list, 700, 1000, 300)
    expect(screen.queryByTestId('scroll-fade')).toBeNull()
    const top = screen.getByTestId('scroll-fade-top')
    expect(top.style.backgroundImage).toContain('linear-gradient(to bottom')

    measure(list, 0, 300, 300)
    expect(screen.queryByTestId('scroll-fade')).toBeNull()
    expect(screen.queryByTestId('scroll-fade-top')).toBeNull()
  })
})
