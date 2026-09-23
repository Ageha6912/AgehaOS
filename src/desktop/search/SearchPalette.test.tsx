import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { registerBuiltinApps, resetAppStore } from '@/store/app-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'
import { resetNotificationStore } from '@/store/notification-store'
import { systemVfs } from '@/services/vfs'

import { SearchPalette } from './SearchPalette'

async function seedFile(): Promise<void> {
  await systemVfs.writeFile('/Documents/meeting-notes.txt', 'agenda')
}

beforeEach(async () => {
  resetSearchStore()
  resetAppStore()
  registerBuiltinApps()
  resetWindowStore()
  resetNotificationStore()
  await seedFile()
})

function openPalette(): void {
  act(() => {
    useSearchStore.getState().setOpen(true)
  })
}

describe('SearchPalette (PRD §15)', () => {
  it('is hidden until opened and shows app results while typing', async () => {
    render(<SearchPalette />)
    expect(screen.queryByTestId('search-palette')).toBeNull()

    openPalette()
    expect(screen.getByTestId('search-palette')).toBeInTheDocument()

    await userEvent.type(screen.getByTestId('search-input'), '记')
    await waitFor(() => expect(screen.getAllByTestId('search-result-app')).toHaveLength(1))
    expect(screen.getByText('记事')).toBeInTheDocument()
    expect(screen.getByText('应用')).toBeInTheDocument()
  })

  it('finds files by name alongside apps and opens the active result with Enter', async () => {
    render(<SearchPalette />)
    openPalette()

    await userEvent.type(screen.getByTestId('search-input'), 'meeting')
    await waitFor(() => expect(screen.getAllByTestId('search-result-file')).toHaveLength(1))

    // 应用域为空 → 活动项即文件结果；Enter 打开 Files（§24.3 携参启动待办）。
    await userEvent.type(screen.getByTestId('search-input'), '{Enter}')
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(1)
    expect(windows[0]?.appId).toBe('com.ageha.files')
    expect(useSearchStore.getState().open).toBe(false)
  })

  it('moves the active result with arrow keys', async () => {
    render(<SearchPalette />)
    openPalette()

    // notes + settings 同含字母 e 的应用域：记事/设置/文件 应用三选。
    await userEvent.type(screen.getByTestId('search-input'), 'e')
    const input = screen.getByTestId('search-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const results = screen.getAllByTestId('search-result-app')
    expect(results[2]?.className).toContain('bg-primary/10')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByTestId('search-result-app')[1]?.className).toContain('bg-primary/10')
  })

  it('shows the empty state for queries with no matches', async () => {
    render(<SearchPalette />)
    openPalette()

    await userEvent.type(screen.getByTestId('search-input'), 'zzzz')
    await waitFor(() => expect(screen.getByText('无匹配结果')).toBeInTheDocument())
  })

  it('closes on backdrop click and Escape', async () => {
    render(<SearchPalette />)
    openPalette()

    fireEvent.click(screen.getByTestId('search-backdrop'))
    expect(useSearchStore.getState().open).toBe(false)

    openPalette()
    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' })
    expect(useSearchStore.getState().open).toBe(false)
  })
})
