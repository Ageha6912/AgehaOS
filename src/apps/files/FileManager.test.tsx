import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('工具栏行是边缘手势豁免的横向滚动面（窄容器分支，M2-4 QA）', async () => {
    // 360px 移动视口下操作簇（新建/上传/重命名/删除 + 搜索）min-content
    // 超出视口，工具栏行按容器查询分支转为横向滚动行并打 data-no-edge-back
    // ——触屏可横滚 + 边缘返回手势豁免（hook 跳过 + index.css 重放 pan-x）。
    // 桌面宽容器无 @max 分支生效，布局与改前一致（桌面 E2E 为准）。
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)

    const row = screen.getByTestId('files-toolbar')
    expect(row).toHaveAttribute('data-no-edge-back')
    expect(row.className).toContain('@max-[640px]:overflow-x-auto')
    // 容器查询上下文在主列（行宽由列决定，containment 无布局副作用）。
    expect(row.parentElement).toHaveClass('@container')
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

/**
 * 窄容器分支（M2-5）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；几何级断言（横向
 * 溢出 / 命中区实测 / 触屏滚动语义）归 e2e/mobile-files.spec.ts 真实视口。
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  /** 手动喂一次观测回调（内容盒宽度）。真实 RO 在 observe 时必发初始帧。 */
  emit(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

describe('FileManager 窄容器（M2-5）', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderNarrow(vfs: Vfs) {
    render(<FileManager vfs={vfs} windowId="w-files" />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })
  }

  it('窄容器：固定侧栏收起为顶部目录 chip 行，操作簇触控抬到 44px', async () => {
    const vfs = await createVfs()
    await renderNarrow(vfs)

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    const switcher = screen.getByTestId('files-dir-switcher')
    expect(switcher).toHaveAttribute('data-no-edge-back')
    expect(switcher).toHaveAttribute('aria-label', '快速访问')
    expect(within(switcher).getByRole('button', { name: '文档' })).toBeInTheDocument()
    expect(within(switcher).getByRole('button', { name: '回收站' })).toBeInTheDocument()
    // 工具栏操作钮窄容器抬到 min-h-[44px]，行体 min-h-14 容住命中区。
    expect(screen.getByRole('button', { name: '新建文本文件' }).className).toContain('min-h-[44px]')
    expect(screen.getByTestId('files-toolbar').className).toContain('min-h-14')
    // M2-4 的横向滚动面契约保持在场（宽窄分支叠加，不互斥）。
    expect(screen.getByTestId('files-toolbar').className).toContain('@max-[640px]:overflow-x-auto')
  })

  it('窄容器：chip 行切换目录与回收站，aria-current 跟随当前视图', async () => {
    const vfs = await createVfs()
    await renderNarrow(vfs)

    const switcher = screen.getByTestId('files-dir-switcher')
    fireEvent.click(within(switcher).getByRole('button', { name: '文档' }))

    // 页脚路径跟随（真实路径保持英文——VFS/SDK 契约不动）。
    expect(screen.getByText('/Documents')).toBeInTheDocument()
    expect(within(switcher).getByRole('button', { name: '文档' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    fireEvent.click(within(switcher).getByRole('button', { name: '回收站' }))
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument()
    expect(within(switcher).getByRole('button', { name: '回收站' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(switcher).getByRole('button', { name: '文档' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('窄容器触屏语义：首击选中、再击打开（进目录 / 文件预览）', async () => {
    const vfs = await createVfs()
    await vfs.createDirectory('/Documents/projects')
    await vfs.writeFile('/Documents/projects/note.txt', 'hello')
    await renderNarrow(vfs)

    fireEvent.click(
      within(screen.getByTestId('files-dir-switcher')).getByRole('button', { name: '文档' }),
    )
    const dirTile = await screen.findByRole('button', { name: /projects/ })

    // 首击：仅选中（选中态接通工具栏重命名/删除），不进入目录。
    fireEvent.click(dirTile)
    expect(dirTile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('/Documents')).toBeInTheDocument()

    // 再击：进入目录。
    fireEvent.click(dirTile)
    expect(await screen.findByText('/Documents/projects')).toBeInTheDocument()

    // 文件：首击选中（无预览弹层），再击打开预览。
    const fileTile = await screen.findByRole('button', { name: /note\.txt/ })
    fireEvent.click(fileTile)
    expect(fileTile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog', { name: '文件预览' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /note\.txt/ }))
    expect(await screen.findByRole('dialog', { name: '文件预览' })).toBeInTheDocument()
  })

  it('窄容器：回收站深链（initialTrash）→ 回收站 chip 高亮、上传入口缺席', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/gone.txt', 'x')
    await vfs.remove('/Documents/gone.txt')
    render(<FileManager vfs={vfs} windowId="w-files" initialTrash />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })

    const switcher = screen.getByTestId('files-dir-switcher')
    expect(within(switcher).getByRole('button', { name: '回收站' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.queryByTestId('file-upload-input')).toBeNull()
  })

  it('宽容器（880px 桌面窗口档）：侧栏在场、chip 行不渲染、单击仍仅选中', async () => {
    const vfs = await createVfs()
    render(<FileManager vfs={vfs} windowId="w-files" />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(880)
    })

    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.queryByTestId('files-dir-switcher')).not.toBeInTheDocument()
    // 桌面交互语义原样：单击仅选中、不进入（网格 tile 以 pressed 过滤，
    // 与侧栏同名按钮区分）。
    const tile = await screen.findByRole('button', { name: '下载', pressed: false })
    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    // 未发生目录进入：根目录网格原样在场。
    expect(screen.getByRole('button', { name: '图片', pressed: false })).toBeInTheDocument()
  })
})
