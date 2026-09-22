import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { MemoryAdapter, Vfs } from '@/core/filesystem'

import { NotesApp } from './NotesApp'

async function createVfs() {
  const vfs = new Vfs({
    adapter: new MemoryAdapter(),
    generateId: (() => {
      let counter = 0
      return () => `note-${++counter}`
    })(),
  })
  await vfs.ready()
  return vfs
}

beforeEach(async () => {
  // Each test gets a fresh VFS through its own createVfs call.
})

describe('NotesApp', () => {
  it('lists existing text files from /Documents', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'think')
    await vfs.writeFile('/Documents/diary.txt', 'day 1')

    render(<NotesApp vfs={vfs} windowId="w-notes" />)

    expect(await screen.findByText('ideas.txt')).toBeInTheDocument()
    expect(screen.getByText('diary.txt')).toBeInTheDocument()
  })

  it('creates a note through the dialog and selects it', async () => {
    const vfs = await createVfs()
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByRole('button', { name: '新建文本文件' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fresh.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(await screen.findByText('/Documents/fresh.txt')).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: '笔记编辑器' })
    expect(editor).toHaveValue('')
  })

  it('opens a note, edits it and saves the content to the VFS', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'first draft')

    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByText('ideas.txt'))
    const editor = await screen.findByRole('textbox', { name: '笔记编辑器' })
    expect(editor).toHaveValue('first draft')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.change(editor, { target: { value: 'second draft' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })
    expect(await vfs.readFile('/Documents/ideas.txt')).toBe('second draft')
  })

  it('shows the empty state when no note is selected', async () => {
    const vfs = await createVfs()
    render(<NotesApp vfs={vfs} windowId="w-notes" />)

    expect(await screen.findByText('选择或新建一条笔记')).toBeInTheDocument()
  })

  it('reports name clashes inside the creation dialog', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/taken.txt', 'x')
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByRole('button', { name: '新建文本文件' }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'taken.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('同名项目已存在')
  })
})
