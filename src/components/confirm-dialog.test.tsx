import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('renders title, body and both action buttons', () => {
    render(
      <ConfirmDialog
        title="上传样本供复审？"
        body="该内容将匿名上传。"
        confirmLabel="同意上传"
        cancelLabel="仅本机撤下"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('dialog', { name: '上传样本供复审？' })).toBeInTheDocument()
    expect(screen.getByText('该内容将匿名上传。')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('同意上传')
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('仅本机撤下')
  })

  it('invokes the matching callback for each button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="t"
        body="b"
        confirmLabel="ok"
        cancelLabel="no"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while busy', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="t"
        body="b"
        confirmLabel="ok"
        cancelLabel="no"
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled()
    // 忙态不得锁死弹层（网络悬挂时用户必须能退出）。
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeEnabled()
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('shows an inline error with role=alert', () => {
    render(
      <ConfirmDialog
        title="t"
        body="b"
        confirmLabel="ok"
        cancelLabel="no"
        error="上传失败"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('上传失败')
  })
})
