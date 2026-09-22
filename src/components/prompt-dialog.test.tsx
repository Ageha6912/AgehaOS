import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PromptDialog } from './prompt-dialog'

describe('PromptDialog', () => {
  it('renders title, label and an empty input', () => {
    render(
      <PromptDialog
        title="新建文件夹"
        label="名称"
        confirmLabel="确定"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '新建文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled()
  })

  it('confirms with the trimmed input value', () => {
    const onConfirm = vi.fn()
    render(
      <PromptDialog
        title="新建文件夹"
        label="名称"
        confirmLabel="确定"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  projects  ' } })
    expect(screen.getByRole('button', { name: '确定' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(onConfirm).toHaveBeenCalledWith('projects')
  })

  it('supports submit via Enter and cancel via the cancel button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <PromptDialog
        title="重命名"
        label="名称"
        initialValue="a.txt"
        confirmLabel="确定"
        cancelLabel="取消"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(onConfirm).toHaveBeenCalledWith('a.txt')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows a validation error message', () => {
    render(
      <PromptDialog
        title="新建文件夹"
        label="名称"
        confirmLabel="确定"
        cancelLabel="取消"
        error="同名项目已存在"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('同名项目已存在')
  })
})
