import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DialogShell } from './dialog-shell'

/**
 * 共享弹层壳契约（E3 审查修复）：portal 到 body（spatial-window 的
 * backdrop-filter 会做 fixed 包含块）、aria-modal、初始焦点、Tab 焦点循环、
 * Esc 关闭（IME 组合期忽略）、遮罩点击取消、卸载回焦。
 */
describe('DialogShell', () => {
  function renderShell(onClose = vi.fn()) {
    const view = render(
      <div data-testid="window-host">
        <DialogShell title="确认" testId="shell" onClose={onClose}>
          <button type="button" data-autofocus>
            first
          </button>
          <button type="button">last</button>
        </DialogShell>
      </div>,
    )
    return { ...view, onClose }
  }

  it('transports to document.body (out of the window subtree)', () => {
    renderShell()
    const dialog = screen.getByTestId('shell')
    // 直接子级为 body：不在 window-host 里，避免 backdrop-filter 包含块/裁剪。
    expect(dialog.parentElement).toBe(document.body)
    expect(screen.getByTestId('window-host')).not.toContainElement(dialog)
    expect(dialog).toHaveAttribute('role', 'dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', '确认')
  })

  it('focuses [data-autofocus] on mount and restores the previous focus on unmount', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const { unmount } = renderShell()
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()

    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('cycles Tab focus inside the dialog (forward from last, backward from first)', () => {
    renderShell()
    const dialog = screen.getByTestId('shell')
    const first = screen.getByRole('button', { name: 'first' })
    const last = screen.getByRole('button', { name: 'last' })

    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(first).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('closes on Escape, but ignores Escape during IME composition', () => {
    const { onClose } = renderShell()

    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop pointerdown but not on clicks inside the panel', () => {
    const { onClose } = renderShell()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'first' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByTestId('shell'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
