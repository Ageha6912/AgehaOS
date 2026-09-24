import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { seedSessionForTests } from '@/store/session-store'

import { TerminalApp } from './TerminalApp'

beforeEach(() => {
  seedSessionForTests({ id: 'u-t', username: 'alice', createdAt: '', updatedAt: '' })
})

async function runCommand(command: string): Promise<void> {
  const input = screen.getByTestId('terminal-input')
  await userEvent.type(input, command)
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TerminalApp (PRD §26)', () => {
  it('exposes the terminal-input hook the stylesheet uses to drop the focus ring', () => {
    render(<TerminalApp />)

    // index.css 以 [data-testid='terminal-input']:focus-visible 关闭全局焦点环
    // （终端本身就是焦点所在）；此断言固定该选择器契约，防止改名导致焦点环回归。
    expect(screen.getByTestId('terminal-input')).toBeInTheDocument()
  })

  it('echoes the prompt and command output', async () => {
    render(<TerminalApp />)

    await runCommand('pwd')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('/'),
    )
    expect(screen.getByTestId('terminal-output').textContent).toContain('alice@agehaos')
  })

  it('creates a file with touch and lists it', async () => {
    render(<TerminalApp />)

    await runCommand('touch hello.txt')
    await runCommand('ls')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('hello.txt'),
    )
  })

  it('reports unknown commands with the localized error', async () => {
    render(<TerminalApp />)

    await runCommand('frobnicate')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('未知命令：frobnicate'),
    )
  })

  it('clears the output on the clear command', async () => {
    render(<TerminalApp />)

    await runCommand('pwd')
    await waitFor(() => expect(screen.getByTestId('terminal-output').textContent).toContain('pwd'))
    await runCommand('clear')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).not.toContain('pwd'),
    )
  })

  it('recalls previous commands with the arrow keys', async () => {
    render(<TerminalApp />)

    await runCommand('whoami')
    await waitFor(() => expect(screen.getByTestId('terminal-output').textContent).toContain('alice'))

    const input = screen.getByTestId('terminal-input')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('whoami')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('')
  })

  it('renders error tone for failed commands', async () => {
    render(<TerminalApp />)

    await runCommand('cat missing.txt')
    await waitFor(() =>
      expect(screen.getByTestId('terminal-output').textContent).toContain('/missing.txt：不存在'),
    )
  })
})
