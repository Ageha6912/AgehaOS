import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ShortcutsDialog } from './ShortcutsDialog'

describe('ShortcutsDialog', () => {
  it('lists the space switching shortcut (Ageha Spaces W3 顺延补齐)', () => {
    render(<ShortcutsDialog onClose={() => undefined} />)
    expect(screen.getByRole('dialog', { name: '键盘快捷键' })).toBeInTheDocument()
    expect(screen.getByText('在上一个/下一个桌面（Space）之间切换')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Alt+←/→')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
