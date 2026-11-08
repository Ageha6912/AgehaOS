import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryAdapter, Vfs } from '@/core/filesystem'
import type { VfsNode } from '@/core/filesystem'

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

  it('未保存草稿时切换笔记需确认（不静默覆盖）', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'first draft')
    await vfs.writeFile('/Documents/diary.txt', 'day 1')

    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByText('ideas.txt'))
    const editor = await screen.findByRole('textbox', { name: '笔记编辑器' })
    fireEvent.change(editor, { target: { value: 'edited' } })

    fireEvent.click(screen.getByText('diary.txt'))
    const dialog = await screen.findByRole('dialog', { name: '切换笔记？' })

    // 取消：保留当前草稿，不切走。
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('dialog', { name: '切换笔记？' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '笔记编辑器' })).toHaveValue('edited')

    // 确认：切到目标笔记，且原笔记磁盘内容未被静默改写。
    fireEvent.click(screen.getByText('diary.txt'))
    fireEvent.click(await screen.findByTestId('confirm-dialog-confirm'))
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '笔记编辑器' })).toHaveValue('day 1')
    })
    expect(await vfs.readFile('/Documents/ideas.txt')).toBe('first draft')
  })

  it('attributes a late save to its own note, not the newly selected one (D2 审查)', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/a.txt', 'A')
    await vfs.writeFile('/Documents/b.txt', 'B')
    const originalWrite = vfs.writeFile.bind(vfs)
    const pending: { release?: () => void } = {}
    const writeSpy = vi.spyOn(vfs, 'writeFile').mockImplementation((path, content) => {
      if (path === '/Documents/a.txt') {
        return new Promise<VfsNode>((resolve) => {
          pending.release = () => {
            void originalWrite(path, content).then(resolve)
          }
        })
      }
      return originalWrite(path, content)
    })

    try {
      render(<NotesApp vfs={vfs} windowId="w-notes" />)
      fireEvent.click(await screen.findByText('a.txt'))
      const editor = await screen.findByRole('textbox', { name: '笔记编辑器' })
      fireEvent.change(editor, { target: { value: 'A2' } })
      // 写盘在途时切到 B（脏草稿确认 → 放弃并切换）。
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      fireEvent.click(screen.getByText('b.txt'))
      fireEvent.click(await screen.findByRole('button', { name: '放弃并切换' }))
      await waitFor(() => expect(editor).toHaveValue('B'))

      // A 的保存现在才落地：不得把 B 的 savedContent 记成 A 的内容。
      pending.release?.()
      await waitFor(async () => {
        expect(await vfs.readFile('/Documents/a.txt')).toBe('A2')
      })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '保存' })).toBeDisabled(),
      )
      expect(editor).toHaveValue('B')
    } finally {
      writeSpy.mockRestore()
    }
  })

  it('closes the editor when the selected note is deleted externally (D2 审查)', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/a.txt', 'A')
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByText('a.txt'))
    expect(await screen.findByRole('textbox', { name: '笔记编辑器' })).toHaveValue('A')

    await act(async () => {
      await vfs.remove('/Documents/a.txt')
    })

    // 选中项消失 → 退出编辑器（旧实现保留 selectedPath，再保存会把文件复活）。
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: '笔记编辑器' })).toBeNull(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('找不到该路径')
  })

  it('follows an external edit while the draft is clean (D2 审查)', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/a.txt', 'v1')
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    fireEvent.click(await screen.findByText('a.txt'))
    const editor = await screen.findByRole('textbox', { name: '笔记编辑器' })
    expect(editor).toHaveValue('v1')

    await act(async () => {
      await vfs.writeFile('/Documents/a.txt', 'v2 externally')
    })

    await waitFor(() => expect(editor).toHaveValue('v2 externally'))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
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

/**
 * 窄容器分支（M2-6）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；几何级断言（横向
 * 溢出 / 命中区实测）归 e2e/mobile-notes-settings.spec.ts 真实视口。
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

describe('NotesApp 窄容器（M2-6）', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderNarrow(vfs: Vfs) {
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })
  }

  it('窄容器：列表↔编辑器二选一——首面只有列表面，侧栏与编辑器不渲染', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'think')
    await renderNarrow(vfs)

    // 宽容器的双栏（aside 列表栏 + 编辑器列）整块不渲染，单面列表面接管。
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '笔记编辑器' })).not.toBeInTheDocument()
    expect(screen.queryByText('选择或新建一条笔记')).not.toBeInTheDocument()
    expect(screen.getByTestId('notes-list-pane')).toBeInTheDocument()

    // 触控 ≥44px（§35.3）：列表行 + 新建按钮命中区抬档，列表头容住命中区。
    const row = await screen.findByRole('button', { name: /ideas\.txt/ })
    expect(row.className).toContain('min-h-[44px]')
    expect(screen.getByRole('button', { name: '新建文本文件' }).className).toContain('min-h-[44px]')
    expect(screen.getByTestId('notes-list-pane').firstElementChild?.className).toContain('min-h-14')
  })

  it('窄容器：选中进编辑器面（内容载入、可编辑保存），返回键回列表面且选中态保持', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'first draft')
    await renderNarrow(vfs)

    // 选中：列表项点击 → 编辑器面出现并载入内容。
    fireEvent.click(await screen.findByRole('button', { name: /ideas\.txt/ }))
    expect(await screen.findByTestId('notes-editor-pane')).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: '笔记编辑器' })
    expect(editor).toHaveValue('first draft')

    // 保存流程不变：编辑 → 保存可用 → 落 VFS → 保存禁用。
    const save = screen.getByRole('button', { name: '保存' })
    expect(save.className).toContain('min-h-[44px]')
    fireEvent.change(editor, { target: { value: 'second draft' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    expect(await vfs.readFile('/Documents/ideas.txt')).toBe('second draft')

    // 返回：编辑器面退出、列表面回归，选中态（aria-current）保持。
    fireEvent.click(screen.getByTestId('notes-back-to-list'))
    expect(screen.getByTestId('notes-list-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('notes-editor-pane')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ideas\.txt/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('窄容器：新建成功直接进编辑器面，内容持久化后可从列表面重开', async () => {
    const vfs = await createVfs()
    await renderNarrow(vfs)

    fireEvent.click(screen.getByRole('button', { name: '新建文本文件' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fresh.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))

    // 新建即选中 → 窄容器直接切到编辑器面（流程与宽容器同一条 createNote）。
    expect(await screen.findByTestId('notes-editor-pane')).toBeInTheDocument()
    expect(screen.getByText('/Documents/fresh.txt')).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: '笔记编辑器' })
    fireEvent.change(editor, { target: { value: 'hello narrow' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    })
    expect(await vfs.readFile('/Documents/fresh.txt')).toBe('hello narrow')

    // 返回列表面重开：持久化内容回读。
    fireEvent.click(screen.getByTestId('notes-back-to-list'))
    fireEvent.click(await screen.findByRole('button', { name: /fresh\.txt/ }))
    expect(await screen.findByTestId('notes-editor-pane')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '笔记编辑器' })).toHaveValue('hello narrow')
  })

  it('宽容器（720px 桌面窗口档）：双栏原样、单面结构缺席、单击列表项编辑器同步出现', async () => {
    const vfs = await createVfs()
    await vfs.writeFile('/Documents/ideas.txt', 'think')
    render(<NotesApp vfs={vfs} windowId="w-notes" />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(720)
    })

    // 双栏在场：aside 列表栏 + 编辑器列空态；单面 testid 不渲染。
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    expect(screen.getByText('选择或新建一条笔记')).toBeInTheDocument()
    expect(screen.queryByTestId('notes-list-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notes-editor-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notes-back-to-list')).not.toBeInTheDocument()
    // 桌面密度档保持：列表行不带 44px 抬档。
    const row = await screen.findByRole('button', { name: /ideas\.txt/ })
    expect(row.className).not.toContain('min-h-[44px]')

    // 宽容器交互原样：单击列表项，编辑器列同步出现（无双面切换）。
    fireEvent.click(row)
    expect(await screen.findByRole('textbox', { name: '笔记编辑器' })).toHaveValue('think')
    expect(screen.getByRole('complementary')).toBeInTheDocument()
  })
})
