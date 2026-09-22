import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MemoryAdapter } from '@/core/filesystem'
import { Vfs } from '@/core/filesystem'

import { FileManager } from './FileManager'

async function createVfs() {
  const vfs = new Vfs({
    adapter: new MemoryAdapter(),
    generateId: (() => {
      let counter = 0
      return () => `id-${++counter}`
    })(),
  })
  await vfs.ready()
  return vfs
}

async function renderInDocuments(vfs: Vfs) {
  render(<FileManager vfs={vfs} windowId="w-files" />)
  // enter /Documents via the sidebar
  fireEvent.click(
    await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
  )
  await screen.findByText('此文件夹为空')
}

describe('FileManager', () => {
  it('shows the sidebar quick access and the root directories', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)

    expect(screen.getByText('快速访问')).toBeInTheDocument()
    expect(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
    ).toBeInTheDocument()
    expect(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /System/ }),
    ).toBeInTheDocument()
  })

  it('enters a directory and shows its empty state', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)
  })

  it('creates a folder through the prompt dialog', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'projects' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(await screen.findByText('projects')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports a name clash inside the dialog', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/dup.txt', 'x')
    render(<FileManager vfs={vfs} windowId="w-files" />)
    fireEvent.click(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
    )
    await screen.findByText('dup.txt')

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'dup.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('同名项目已存在')
  })

  it('creates a text file and previews its content', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)

    fireEvent.click(screen.getByRole('button', { name: '新建文本文件' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'note.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    fireEvent.doubleClick(await screen.findByText('note.txt'))
    const preview = await screen.findByRole('dialog', { name: '文件预览' })
    expect(preview).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(screen.queryByRole('dialog', { name: '文件预览' })).not.toBeInTheDocument()
  })

  it('renames a selected entry', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/old.txt', 'x')
    render(<FileManager vfs={vfs} windowId="w-files" />)
    fireEvent.click(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
    )
    const tile = await screen.findByRole('button', { name: /old\.txt/ })

    fireEvent.click(tile)
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    expect(await screen.findByText('new.txt')).toBeInTheDocument()
    expect(screen.queryByText('old.txt')).not.toBeInTheDocument()
  })

  it('deletes a selected entry to the trash', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/temp.txt', 'x')
    render(<FileManager vfs={vfs} windowId="w-files" />)
    fireEvent.click(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
    )
    const tile = await screen.findByRole('button', { name: /temp\.txt/ })

    fireEvent.click(tile)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(screen.queryByText('temp.txt')).not.toBeInTheDocument()
    })
  })

  it('restores and permanently deletes from the trash view', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/gone.txt', 'x')
    const node = await vfs.remove('/Documents/gone.txt')

    render(<FileManager vfs={vfs} windowId="w-files" />)
    fireEvent.click(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /回收站/ }),
    )
    const tile = await screen.findByRole('button', { name: /gone\.txt/ })

    fireEvent.click(tile)
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    await waitFor(() => {
      expect(screen.queryByText('gone.txt')).not.toBeInTheDocument()
    })
    expect((await vfs.list('/Documents')).map((n) => n.name)).toContain('gone.txt')

    // delete again, then purge permanently
    await vfs.remove('/Documents/gone.txt')
    fireEvent.click(await screen.findByRole('button', { name: /gone\.txt/ }))
    fireEvent.click(screen.getByRole('button', { name: '彻底删除' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /gone\.txt/ })).not.toBeInTheDocument()
    })
    await expect(vfs.restore(node.id)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('searches the current subtree', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/report-q3.txt', 'x')
    await vfs.writeFile('/Documents/todo.txt', 'x')
    render(<FileManager vfs={vfs} windowId="w-files" />)
    fireEvent.click(
      await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ }),
    )
    await screen.findByText('todo.txt')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'report' } })

    // Wait for the search to replace the stale listing, which still shows
    // both files for a tick after the query changes.
    await waitFor(() => {
      expect(screen.queryByText('todo.txt')).not.toBeInTheDocument()
    })
    expect(screen.getByText('report-q3.txt')).toBeInTheDocument()
  })

  it('shows an error banner when listing fails', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)
    await within(screen.getByRole('complementary')).findByRole('button', { name: /Documents/ })

    vi.spyOn(vfs, 'list').mockRejectedValue(new Error('boom'))
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: /Music/ }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试')
  })
})
