import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import { scrollZoneKey, useScrollZone } from './use-scroll-edge'

describe('scrollZoneKey', () => {
  it('reports no overflow when content fits (with subpixel tolerance)', () => {
    expect(scrollZoneKey(0, 300, 300)).toBe('none')
    expect(scrollZoneKey(0, 301, 300)).toBe('none')
  })

  it('distinguishes more-below from at-bottom (with rounding tolerance)', () => {
    expect(scrollZoneKey(0, 1000, 300)).toBe('more')
    expect(scrollZoneKey(699, 1000, 300)).toBe('bottom')
    expect(scrollZoneKey(700, 1000, 300)).toBe('bottom')
    expect(scrollZoneKey(500, 1000, 300)).toBe('more')
  })
})

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  const zone = useScrollZone(ref)
  return <div ref={ref} data-testid="zone" data-zone={zone} />
}

/** jsdom 无布局：手动伪造 scrollTop/scrollHeight/clientHeight 后派发 scroll。 */
function measure(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  fireEvent.scroll(el)
}

describe('useScrollZone', () => {
  it('tracks the zone as the element scrolls', () => {
    render(<Harness />)
    const el = screen.getByTestId('zone')
    expect(el).toHaveAttribute('data-zone', 'none')

    measure(el, 0, 1000, 300)
    expect(el).toHaveAttribute('data-zone', 'more')

    measure(el, 700, 1000, 300)
    expect(el).toHaveAttribute('data-zone', 'bottom')

    measure(el, 0, 300, 300)
    expect(el).toHaveAttribute('data-zone', 'none')
  })
})
