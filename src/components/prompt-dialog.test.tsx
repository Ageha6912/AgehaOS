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

  it('blocks implicit submit while Enter confirms an IME composition, passes plain Enter through', () => {
    render(
      <PromptDialog
        title="重命名"
        label="名称"
        initialValue="a.txt"
        confirmLabel="确定"
        cancelLabel="取消"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const input = screen.getByRole('textbox')

    // 组合期 Enter（确认候选词）：preventDefault 阻断隐式表单提交。
    const composingEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    expect(fireEvent(input, composingEnter)).toBe(false)

    // 普通 Enter（组合已结束）：默认行为放行。
    const plainEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    expect(fireEvent(input, plainEnter)).toBe(true)
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
