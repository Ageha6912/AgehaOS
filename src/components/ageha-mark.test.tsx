import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AgehaMark } from './ageha-mark'

describe('AgehaMark (品牌标，DESIGN.md §10)', () => {
  it('renders the gradient tile with the butterfly geometry', () => {
    const { container } = render(<AgehaMark size={48} />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('width', '48')
    // 圆角底 + 蝶形（前翅/后翅/身体）+ 渐变定义。
    expect(svg?.querySelector('rect[rx]')).not.toBeNull()
    expect(svg?.querySelectorAll('polygon').length).toBe(4)
    expect(svg?.querySelector('linearGradient')).not.toBeNull()
  })

  it('stays decorative without a label and exposes img role with one', () => {
    const { container, rerender } = render(<AgehaMark size={16} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    rerender(<AgehaMark size={16} label="AgehaOS" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'AgehaOS')
  })
})
