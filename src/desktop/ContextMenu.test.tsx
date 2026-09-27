import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import { launchApp } from '@/apps/launch'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'

import { ContextMenu } from './ContextMenu'

vi.mock('@/services/dynamic-desktop', () => ({
  systemDynamicDesktop: { refresh: vi.fn() },
}))
vi.mock('@/apps/launch', () => ({ launchApp: vi.fn() }))

function Harness({ pos }: { pos: { x: number; y: number } }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setPosition(pos)} />
      <ContextMenu position={position} onClose={() => setPosition(null)} />
    </>
  )
}

const menu = () => screen.getByTestId('context-menu')
const menuOrNull = () => screen.queryByTestId('context-menu')

beforeEach(() => {
  vi.useFakeTimers()
  window.innerWidth = 1280
  window.innerHeight = 720
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ContextMenu（桌面右键菜单）', () => {
  it('opens at the requested position with the section-14 motion classes', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))

    const el = menu()
    expect(el.className).toContain('animate-os-pop-in')
    expect(el.style.left).toBe('900px')
    expect(el.style.top).toBe('500px')
  })

  it('clamps the menu inside the viewport near the bottom-right edge', () => {
    // jsdom 无布局：在原型上定义尺寸（spyOn 对 jsdom 的 offsetWidth 不可用），
    // 越界位置必须收进视口（8px 留白）
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 192,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 120,
    })

    render(<Harness pos={{ x: 1270, y: 710 }} />)
    fireEvent.click(screen.getByTestId('opener'))

    expect(menu().style.left).toBe(`${1280 - 192 - 8}px`)
    expect(menu().style.top).toBe(`${720 - 120 - 8}px`)
  })

  it('closes on outside pointerdown and on Escape', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))
    expect(menu()).toBeInTheDocument()

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(menuOrNull()).toBeNull()

    fireEvent.click(screen.getByTestId('opener'))
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(menuOrNull()).toBeNull()
  })

  it('runs the renew-wallpaper action and closes', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))

    fireEvent.click(screen.getByTestId('context-menu-renew-wallpaper'))
    expect(systemDynamicDesktop.refresh).toHaveBeenCalledTimes(1)
    expect(menuOrNull()).toBeNull()
  })

  it('opens the store and settings apps', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))
    fireEvent.click(screen.getByTestId('context-menu-open-store'))
    expect(launchApp).toHaveBeenCalledWith('com.ageha.store')

    fireEvent.click(screen.getByTestId('opener'))
    fireEvent.click(screen.getByTestId('context-menu-open-settings'))
    expect(launchApp).toHaveBeenCalledWith('com.ageha.settings')
  })

  it('closes on viewport resize', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))
    expect(menu()).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(menuOrNull()).toBeNull()
  })

  it('keeps working after close/reopen cycles', () => {
    render(<Harness pos={{ x: 900, y: 500 }} />)
    fireEvent.click(screen.getByTestId('opener'))
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    fireEvent.click(screen.getByTestId('opener'))
    expect(menu().className).toContain('animate-os-pop-in')
  })
})
