import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GlassSurface } from './GlassSurface'

describe('GlassSurface (空间玻璃面壳，空间化地基切片)', () => {
  it('renders a div with the spatial-window base class and content by default', () => {
    const { container } = render(<GlassSurface>面板内容</GlassSurface>)

    const el = container.firstElementChild
    expect(el?.tagName).toBe('DIV')
    // 默认类组合 = 仅基类：无深度、无浮动、无静态直切。
    expect(el?.className).toBe('spatial-window')
    expect(el).toHaveTextContent('面板内容')
  })

  it('maps each depth tier to its class', () => {
    const { container, rerender } = render(<GlassSurface depth="near" />)
    expect(container.firstElementChild).toHaveClass('sp-depth-near')

    rerender(<GlassSurface depth="middle" />)
    expect(container.firstElementChild).toHaveClass('sp-depth-middle')

    rerender(<GlassSurface depth="far" />)
    expect(container.firstElementChild).toHaveClass('sp-depth-far')
  })

  it('float adds the ambient float class and motionStatic adds the static cutoff', () => {
    const { container, rerender } = render(<GlassSurface float />)
    expect(container.firstElementChild).toHaveClass('sp-ambient-float')
    expect(container.firstElementChild).not.toHaveClass('sp-motion-static')

    // 关档直切：静态类与浮动类共存，spatial.css 内源序让 animation: none
    // 必胜（与 mobile 静态类同口径）。
    rerender(<GlassSurface float motionStatic />)
    expect(container.firstElementChild).toHaveClass('sp-ambient-float')
    expect(container.firstElementChild).toHaveClass('sp-motion-static')

    rerender(<GlassSurface motionStatic />)
    expect(container.firstElementChild).not.toHaveClass('sp-ambient-float')
    expect(container.firstElementChild).toHaveClass('sp-motion-static')
  })

  it('passes className and style through', () => {
    const { container } = render(
      <GlassSurface className="absolute inset-0" style={{ width: 320 }}>
        面板
      </GlassSurface>,
    )

    const el = container.firstElementChild
    expect(el).toHaveClass('spatial-window', 'absolute', 'inset-0')
    expect(el).toHaveStyle({ width: '320px' })
  })
})
