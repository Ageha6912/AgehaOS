import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AtmosphereLayer } from './AtmosphereLayer'

describe('AtmosphereLayer', () => {
  it('renders a passive, out-of-tree atmosphere surface (DESIGN.md §18)', () => {
    render(<AtmosphereLayer />)

    const layer = screen.getByTestId('atmosphere-layer')
    // 坑 55：类断言用 classList.contains，避免子串误撞。
    expect(layer.classList.contains('atmosphere-layer')).toBe(true)
    expect(layer.classList.contains('pointer-events-none')).toBe(true)
    expect(layer.classList.contains('absolute')).toBe(true)
    // 层序契约：压壁纸、垫光晕(z-[5])/图标(z-10)/窗口(z-30)。
    expect(layer.classList.contains('z-[2]')).toBe(true)
    // 纯装饰层：不进可达树。
    expect(layer.getAttribute('aria-hidden')).toBe('true')
  })
})
