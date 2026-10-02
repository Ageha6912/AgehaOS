import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPopoverStore, usePopoverStore } from '@/store/popover-store'

import { usePopoverDismiss, type PopoverDismissReason } from './use-popover-dismiss'

function Popover({
  id,
  onClose,
  dismissible,
}: {
  id: string
  onClose: (reason: PopoverDismissReason) => void
  dismissible?: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  usePopoverDismiss(
    id,
    open,
    (reason) => {
      setOpen(false)
      onClose(reason)
    },
    { insideRefs: [panelRef], dismissible },
  )
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open-{id}
      </button>
      {open && (
        <div ref={panelRef} data-testid={`panel-${id}`}>
          <input aria-label={`field-${id}`} />
        </div>
      )}
    </div>
  )
}

beforeEach(() => {
  resetPopoverStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePopoverDismiss（UI 评审 P0-2 弹层关闭契约）', () => {
  it('closes on Escape even when focus is outside the panel', () => {
    const onClose = vi.fn()
    render(<Popover id="a" onClose={onClose} />)
    fireEvent.click(screen.getByText('open-a'))

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledWith('escape')
    expect(screen.queryByTestId('panel-a')).toBeNull()
  })

  it('closes on an outside press but not on a press inside the panel', () => {
    const onClose = vi.fn()
    render(
      <>
        <Popover id="a" onClose={onClose} />
        <p>elsewhere</p>
      </>,
    )
    fireEvent.click(screen.getByText('open-a'))

    fireEvent.pointerDown(screen.getByLabelText('field-a'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(onClose).toHaveBeenCalledWith('outside')
  })

  it('lets an external data-popover-trigger toggle without a close-then-reopen race', () => {
    const onClose = vi.fn()
    render(
      <>
        <Popover id="a" onClose={onClose} />
        <button type="button" data-popover-trigger="a">
          sidebar-toggle
        </button>
      </>,
    )
    fireEvent.click(screen.getByText('open-a'))

    fireEvent.pointerDown(screen.getByText('sidebar-toggle'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when focus moves into an app iframe, but not on a bare window blur', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(
      <>
        <Popover id="a" onClose={onClose} />
        <iframe title="app" />
      </>,
    )
    fireEvent.click(screen.getByText('open-a'))

    // 切走浏览器标签页：window blur 但焦点不在 iframe 里——保持打开。
    act(() => {
      window.dispatchEvent(new FocusEvent('blur'))
      vi.runAllTimers()
    })
    expect(onClose).not.toHaveBeenCalled()

    // jsdom 不会把焦点交给 iframe：直接模拟浏览器点进 iframe 后的 activeElement。
    const active = vi
      .spyOn(document, 'activeElement', 'get')
      .mockReturnValue(screen.getByTitle('app'))
    act(() => {
      window.dispatchEvent(new FocusEvent('blur'))
      vi.runAllTimers()
    })
    active.mockRestore()
    expect(onClose).toHaveBeenCalledWith('outside')
  })

  it('keeps at most one popover open: opening another supersedes the first', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    render(
      <>
        <Popover id="a" onClose={onCloseA} />
        <Popover id="b" onClose={onCloseB} dismissible={false} />
      </>,
    )
    fireEvent.click(screen.getByText('open-a'))
    expect(usePopoverStore.getState().active).toBe('a')

    fireEvent.click(screen.getByText('open-b'))

    expect(onCloseA).toHaveBeenCalledWith('superseded')
    expect(screen.queryByTestId('panel-a')).toBeNull()
    expect(screen.getByTestId('panel-b')).toBeInTheDocument()
    expect(usePopoverStore.getState().active).toBe('b')
  })

  it('leaves Escape and outside presses to non-dismissible popovers', () => {
    const onClose = vi.fn()
    render(<Popover id="menu" onClose={onClose} dismissible={false} />)
    fireEvent.click(screen.getByText('open-menu'))

    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerDown(document.body)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('panel-menu')).toBeInTheDocument()
  })

  it('releases the slot on close', () => {
    render(<Popover id="a" onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('open-a'))
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(usePopoverStore.getState().active).toBeNull()
  })
})
