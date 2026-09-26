import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { APP_UI_META } from './builtin'
import { APP_BADGES } from './app-badges'
import { AppIcon } from './app-icon'

describe('AppIcon', () => {
  it('gives every built-in app a designed badge', () => {
    for (const appId of Object.keys(APP_UI_META)) {
      expect(APP_BADGES[appId], `missing badge for ${appId}`).toBeDefined()
    }
  })

  it('renders a gradient tile with the glyph at the requested size', () => {
    const { container } = render(<AppIcon appId="com.ageha.files" size={40} />)

    const tile = container.firstElementChild as HTMLElement
    expect(tile.style.width).toBe('40px')
    expect(tile.style.height).toBe('40px')
    expect(tile.style.backgroundImage).toContain('linear-gradient')
    // jsdom 将十六进制色规范化为 rgb() 形式。
    expect(tile.style.backgroundImage).toContain('rgb(59, 108, 246)')
    expect(tile.querySelector('svg')).not.toBeNull()
  })

  it('exposes the label for screen readers when provided', () => {
    render(<AppIcon appId="com.ageha.notes" label="记事" />)

    expect(screen.getByRole('img', { name: '记事' })).toBeInTheDocument()
  })

  it('stays decorative without a label', () => {
    const { container } = render(<AppIcon appId="com.ageha.notes" />)

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('renders a deterministic generated badge for unknown apps', () => {
    const first = render(<AppIcon appId="com.example.unknown" size={20} label="外部应用" />)
    const tile = first.container.firstElementChild as HTMLElement
    expect(tile.style.backgroundImage).toContain('linear-gradient')
    expect(tile.querySelector('svg')).not.toBeNull()

    // 同一 appId 永远同一徽章（跨会话稳定的视觉身份）。
    const second = render(<AppIcon appId="com.example.unknown" size={20} />)
    const tile2 = second.container.firstElementChild as HTMLElement
    expect(tile2.style.backgroundImage).toBe(tile.style.backgroundImage)
  })
})
