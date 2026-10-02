import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MAX_FILE_BYTES, MemoryAdapter } from '@/core/filesystem'
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
    await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
  )
  await screen.findByText('此文件夹为空')
}

describe('FileManager', () => {
  it('shows the sidebar quick access and the root directories', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)

    expect(screen.getByText('快速访问')).toBeInTheDocument()
    expect(
      await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
    ).toBeInTheDocument()
    expect(
      await within(screen.getByRole('complementary')).findByRole('button', { name: '系统' }),
    ).toBeInTheDocument()
  })

  it('shows localized names for system folders while keeping the real path', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)

    const sidebarItem = await within(screen.getByRole('complementary')).findByRole('button', {
      name: '图片',
    })
    expect(sidebarItem).toHaveAttribute('title', '/Pictures')
    // 根目录网格同样显示中文名。
    expect(await screen.findByRole('button', { name: '下载', pressed: false })).toBeInTheDocument()

    fireEvent.click(sidebarItem)
    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(within(breadcrumb).getByRole('button', { name: '图片' })).toHaveAttribute('title', '/Pictures')
    expect(screen.getByText('/Pictures')).toBeInTheDocument()
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
      await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
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
      await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
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
      await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
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
      await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' }),
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
    await within(screen.getByRole('complementary')).findByRole('button', { name: '文档' })

    vi.spyOn(vfs, 'list').mockRejectedValue(new Error('boom'))
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: '音乐' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试')
  })
})

describe('FileManager upload（Phase 3 二进制承载 UI 面）', () => {
  it('uploads a local file into the current directory as binary', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)

    const input = screen.getByTestId('file-upload-input') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([0, 255, 1, 0])], 'photo.bin')] },
    })

    expect(await screen.findByText('photo.bin')).toBeInTheDocument()
    const stored = await vfs.get('/Documents/photo.bin')
    expect(stored?.bytes).toBeDefined()
    expect([...(stored?.bytes ?? [])]).toEqual([0, 255, 1, 0])
    expect(stored?.content).toBe('')
    // 允许连续重选同一文件：input 值在每次选择后被清空。
    expect(input.value).toBe('')
  })

  it('rejects an upload whose name already exists', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)

    fireEvent.change(screen.getByTestId('file-upload-input'), {
      target: { files: [new File([new Uint8Array([1])], 'a.bin')] },
    })
    await screen.findByText('a.bin')
    fireEvent.change(screen.getByTestId('file-upload-input'), {
      target: { files: [new File([new Uint8Array([2])], 'a.bin')] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('同名项目已存在')
    // 原文件未被覆盖。
    expect([...((await vfs.get('/Documents/a.bin'))?.bytes ?? [])]).toEqual([1])
  })

  it('rejects files above the 8 MB limit before reading them', async () => {
    const vfs = await createVfs()
    await renderInDocuments(vfs)
    const spy = vi.spyOn(vfs, 'writeFileBytes')

    fireEvent.change(screen.getByTestId('file-upload-input'), {
      target: { files: [new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.bin')] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('文件超过 8 MB 上限')
    expect(spy).not.toHaveBeenCalled()
    expect(await vfs.get('/Documents/huge.bin')).toBeNull()
  })

  it('keeps the upload button out of trash mode', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)
    await within(screen.getByRole('complementary')).findByRole('button', { name: '回收站' })

    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: '回收站' }))

    expect(screen.queryByTestId('file-upload-input')).toBeNull()
    expect(screen.queryByRole('button', { name: '上传文件' })).toBeNull()
  })
})
