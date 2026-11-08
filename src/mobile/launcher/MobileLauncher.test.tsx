import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VfsNode, VfsSearchResult } from '@/core/filesystem'
import { setLocale, useLocaleStore } from '@/core/i18n'
import { resetAppStore, useAppStore } from '@/store/app-store'
import { resetFilesTargetStore, useFilesTargetStore } from '@/store/files-target-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'
import { systemVfs } from '@/services/vfs'

import { MOBILE_APP_ORDER } from '../shared/mobile-app-order'
import { MobileLauncher } from './MobileLauncher'

/**
 * M2-1 启动器 Bottom Sheet 契约：
 * - 打开渲染 = 全部已安装应用（boot 10 条）按 mobile-app-order 序 + 顶部
 *   搜索框（placeholder 走 i18n，打开即聚焦）；
 * - 过滤 = manifest.name 大小写不敏感子串（./launcher-filter 纯函数，边界
 *   另测），无命中渲染空态文案；
 * - 关闭 = backdrop 点击 / Esc（document 捕获阶段）回调 onClose；open→false
 *   后保留一拍退场帧（data-state='leaving'）再卸载（MobileAppHost 同款）；
 * - 选中 = openApp 推进导航（真实启动归 AppHost）+ onClose；
 * - 动效尊重 = motion-prefs「窗口切换转场」关档追加 .mobile-launcher-static
 *   （reduced-motion 由 index.css 全局塌缩承接，不建第二套开关）；
 * - 触控纪律 = 列表行命中区 ≥44×44（§35.3）。
 *
 * M4-1 全域搜索契约（文件域）：
 * - 空查询 = 仅应用列表（M2-1 现状不变：无分组标题、零 VFS 调用）；
 * - 输入防抖 200ms 才发起一次 systemVfs.search('/'),连续输入只保留最后一次；
 * - 分组渲染（应用组在前/文件组在后，标题 i18n）+ 文件行显示完整路径；
 * - 每组截断 8 条 + 静态截断提示（全量计数 + 上限，无假按钮）；
 * - 点击文件行 = files-target-store 定位分发（dirname）+ openApp('files')
 *   + onClose；
 * - 搜索失败安全回退空文件域；重开抽屉文件域复位。
 */

vi.mock('@/services/vfs', () => ({
  systemVfs: { search: vi.fn(() => Promise.resolve([])) },
}))

const searchMock = vi.mocked(systemVfs.search)

/** 构造最小合法 VfsNode（仅文件域结果行的展示字段被消费）。 */
function fileNode(name: string, id = `id-${name}`): VfsNode {
  return {
    id,
    parentId: 'parent',
    name,
    type: 'file',
    content: '',
    size: 1,
    trashed: false,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  }
}

function searchResult(name: string, path: string): VfsSearchResult {
  return { node: fileNode(name), path }
}

/** 渲染结果里的列表行 appId 序（= 排序纯函数输出序，过滤后为其子序；
 *  空结果返回空数组而非抛错——空态断言要用）。 */
function renderedAppIds(): string[] {
  return screen
    .queryAllByTestId('mobile-launcher-item')
    .map((item) => item.getAttribute('data-app-id') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  // 内建清单入场（7 内置 + 羽化 L1 三件套 = 10，与 MobileAppGrid.test 同口径）。
  resetAppStore()
  resetMobileNavStore()
  resetMotionPrefsStore()
  resetFilesTargetStore()
  // 每用例复位 mock 并回默认空结果实现（mockReset 会清掉工厂实现）。
  searchMock.mockReset()
  searchMock.mockImplementation(() => Promise.resolve([]))
})

afterEach(() => {
  // en 档测试不向同文件后续用例泄漏 locale（MobileAppGrid.test 同口径）。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileLauncher', () => {
  it('打开渲染：dialog 角色 + 全部注册表按 mobile-app-order 序 + 搜索框 i18n 且自动聚焦', () => {
    const onClose = vi.fn()
    render(<MobileLauncher open onClose={onClose} />)

    // sheet = dialog，可访问名走 i18n（zh：搜索应用）。
    const sheet = screen.getByTestId('mobile-launcher-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAttribute('aria-label', '搜索应用')
    // backdrop 在场（点击关闭的承接面）。
    expect(screen.getByTestId('mobile-launcher-backdrop')).toBeInTheDocument()

    // 全量条数（boot = 11），前 8 = 常量优先序，羽化 L1 按本地化展示名排后。
    const registrySize = useAppStore.getState().apps.length
    expect(registrySize).toBe(11)
    const ids = renderedAppIds()
    expect(ids).toHaveLength(registrySize)
    expect(ids.slice(0, MOBILE_APP_ORDER.length)).toEqual([...MOBILE_APP_ORDER])
    expect(ids[0]).toBe('com.ageha.dynamic.panel')

    // 搜索框：placeholder 与可访问名同一句（桌面启动器 §0.6 口径，M4-1 起
    // 升为双域口径）+ 打开即聚焦。
    const search = screen.getByTestId('mobile-launcher-search')
    expect(search).toHaveAttribute('placeholder', '搜索应用与文件…')
    expect(search).toHaveAttribute('aria-label', '搜索应用与文件…')
    expect(search).toHaveFocus()
  })

  it('触控纪律：列表行与搜索框命中区 ≥44px（类钉位，§35.3）', () => {
    render(<MobileLauncher open onClose={vi.fn()} />)

    for (const item of screen.getAllByTestId('mobile-launcher-item')) {
      expect(item).toHaveClass('min-h-[44px]')
    }
    expect(screen.getByTestId('mobile-launcher-search')).toHaveClass('h-11')
  })

  it('backdrop 点击关闭：onClose 恰好一次', () => {
    const onClose = vi.fn()
    render(<MobileLauncher open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-launcher-backdrop'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭：document 捕获阶段监听，onClose 恰好一次；非 Esc 键不误关', () => {
    const onClose = vi.fn()
    render(<MobileLauncher open onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('实时过滤：manifest.name 大小写不敏感（files / FILES 都只余 Files）', () => {
    render(<MobileLauncher open onClose={vi.fn()} />)

    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'files' } })
    expect(renderedAppIds()).toEqual(['com.ageha.files'])

    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'FILES' } })
    expect(renderedAppIds()).toEqual(['com.ageha.files'])
  })

  it('无结果空态：文案走 i18n，列表清空；清空查询即回归全量', () => {
    render(<MobileLauncher open onClose={vi.fn()} />)

    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'zzz' } })

    expect(renderedAppIds()).toHaveLength(0)
    expect(screen.getByTestId('mobile-launcher-empty')).toHaveTextContent('没有匹配的结果')

    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: '' } })
    expect(screen.queryByTestId('mobile-launcher-empty')).toBeNull()
    expect(renderedAppIds()).toHaveLength(11)
  })

  it('en 档：sheet 可访问名 / placeholder / 空态文案随词典切换（双词典对齐）', () => {
    const { rerender } = render(<MobileLauncher open onClose={vi.fn()} />)

    setLocale('en')
    rerender(<MobileLauncher open onClose={vi.fn()} />)

    expect(screen.getByTestId('mobile-launcher-sheet')).toHaveAttribute(
      'aria-label',
      'Search apps',
    )
    expect(screen.getByTestId('mobile-launcher-search')).toHaveAttribute(
      'placeholder',
      'Search apps and files…',
    )
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('mobile-launcher-empty')).toHaveTextContent('No matching results')
  })

  it('选中分发：点击列表行 = openApp 推进导航 + onClose（真实启动归 AppHost）', () => {
    const onClose = vi.fn()
    render(<MobileLauncher open onClose={onClose} />)
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })

    const notes = screen
      .getAllByTestId('mobile-launcher-item')
      .find((item) => item.getAttribute('data-app-id') === 'com.ageha.notes')
    expect(notes).toBeDefined()
    fireEvent.click(notes!)

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('列表展示名 = appDisplayName 本地化名（数据不入典，zh「记事」非 manifest.name 原文）', () => {
    render(<MobileLauncher open onClose={vi.fn()} />)

    const sheet = screen.getByTestId('mobile-launcher-sheet')
    expect(within(sheet).getAllByText('记事').length).toBeGreaterThanOrEqual(1)
    expect(within(sheet).queryByText('Notes')).toBeNull()
  })

  it('退场帧：open→false 保留一拍（data-state=leaving + aria-hidden + pointer-events-none）再卸载', async () => {
    const { rerender } = render(<MobileLauncher open onClose={vi.fn()} />)
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'open')

    rerender(<MobileLauncher open={false} onClose={vi.fn()} />)

    const leaving = screen.getByTestId('mobile-launcher')
    expect(leaving).toHaveAttribute('data-state', 'leaving')
    expect(leaving).toHaveAttribute('aria-hidden', 'true')
    expect(leaving).toHaveClass('pointer-events-none')

    // 退场动画（--ag-motion-base 200ms）播完卸载。
    await waitFor(
      () => expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
  })

  it('重开复位：查询串不残留上一次过滤；过滤态关闭重开 = 全量列表', async () => {
    const { rerender } = render(<MobileLauncher open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'files' } })
    expect(renderedAppIds()).toEqual(['com.ageha.files'])

    rerender(<MobileLauncher open={false} onClose={vi.fn()} />)
    await waitFor(
      () => expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument(),
      { timeout: 600 },
    )

    rerender(<MobileLauncher open onClose={vi.fn()} />)
    expect(screen.getByTestId('mobile-launcher-search')).toHaveValue('')
    expect(renderedAppIds()).toHaveLength(11)
  })

  it('motion-prefs「窗口切换转场」关档：根上追加 .mobile-launcher-static 直切', () => {
    act(() => {
      useMotionPrefsStore.getState().setPref('windowTilt', false)
    })
    render(<MobileLauncher open onClose={vi.fn()} />)

    expect(screen.getByTestId('mobile-launcher')).toHaveClass('mobile-launcher-static')
  })

  it('closed 且无退场帧：open=false 初始渲染 = 不渲染任何节点', () => {
    const { container } = render(<MobileLauncher open={false} onClose={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('MobileLauncher 全域搜索（M4-1 文件域，fake timers 驱动防抖）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetAppStore()
    resetMobileNavStore()
    resetMotionPrefsStore()
    resetFilesTargetStore()
    searchMock.mockReset()
    searchMock.mockImplementation(() => Promise.resolve([]))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    useLocaleStore.setState(useLocaleStore.getInitialState())
  })

  /** 打开抽屉后输入查询并推进防抖窗口（结果 promise 随 microtask 落地）；
   *  返回 render 工具（rerender 等给退场类断言复用）。 */
  async function openAndSearch(query: string): Promise<RenderResult> {
    const utils = render(<MobileLauncher open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), {
      target: { value: query },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    return utils
  }

  it('空查询 = 仅应用列表（现状不变）：零 VFS 调用、无分组标题', () => {
    render(<MobileLauncher open onClose={vi.fn()} />)

    expect(searchMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('mobile-launcher-group-apps')).toBeNull()
    expect(screen.queryByTestId('mobile-launcher-group-files')).toBeNull()
    expect(screen.getByTestId('mobile-launcher-items')).toBeInTheDocument()
    expect(renderedAppIds()).toHaveLength(11)
  })

  it('防抖：停满 200ms 才发起一次搜索，期间连续输入只保留最后一次', async () => {
    render(<MobileLauncher open onClose={vi.fn()} />)
    const search = screen.getByTestId('mobile-launcher-search')

    fireEvent.change(search, { target: { value: 'no' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120)
    })
    expect(searchMock).not.toHaveBeenCalled()

    // 120ms 后再变：计时器重置，旧查询 'no' 被吞。
    fireEvent.change(search, { target: { value: 'note' } })
    expect(searchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith('/', 'note')
  })

  it('分组渲染：应用组在前/文件组在后（标题 i18n），文件行显示名称与完整路径', async () => {
    // 'note' 命中应用（Notes）+ 文件域一条。
    searchMock.mockResolvedValueOnce([searchResult('note.txt', '/Documents/note.txt')])
    await openAndSearch('note')

    const appGroup = screen.getByTestId('mobile-launcher-group-apps')
    const fileGroup = screen.getByTestId('mobile-launcher-group-files')
    expect(appGroup).toHaveTextContent('应用')
    expect(fileGroup).toHaveTextContent('文件')
    // 'note' 双命中：内置 Notes + 羽化 L1 Notes（mobile-app-order 常量优先序）。
    expect(renderedAppIds()).toEqual(['com.ageha.notes', 'com.ageha.eclosion.notes'])

    const fileRow = screen.getByTestId('mobile-launcher-file-item')
    expect(fileRow).toHaveAttribute('data-file-path', '/Documents/note.txt')
    expect(within(fileRow).getByText('note.txt')).toBeInTheDocument()
    expect(within(fileRow).getByText('/Documents/note.txt')).toBeInTheDocument()
  })

  it('退场帧保留文件域结果（F1 审查：退场动画内容不塌陷）', async () => {
    searchMock.mockResolvedValue([searchResult('note.txt', '/Documents/note.txt')])
    const { rerender } = await openAndSearch('note')
    expect(screen.getByTestId('mobile-launcher-group-files')).toBeInTheDocument()

    rerender(<MobileLauncher open={false} onClose={vi.fn()} />)
    // leaving 相位内文件组原样保留（旧实现退场即清空、sheet 高度收缩）。
    expect(screen.getByTestId('mobile-launcher')).toHaveAttribute('data-state', 'leaving')
    expect(screen.getByTestId('mobile-launcher-group-files')).toBeInTheDocument()
  })

  it('reduced-motion 退场立即收尾（F1 审查：不再看 200ms 静止遮罩）', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    try {
      const utils = render(<MobileLauncher open onClose={vi.fn()} />)
      utils.rerender(<MobileLauncher open={false} onClose={vi.fn()} />)
      // 关档退场 0ms：fake timers 推进一拍即卸载。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('截断：文件域 11 条只渲染 8 行 + 静态提示（共 11 条、上限 8）；应用组不缺席标题', async () => {
    searchMock.mockResolvedValueOnce(
      Array.from({ length: 11 }, (_, index) =>
        searchResult(`doc-${index}.txt`, `/Documents/doc-${index}.txt`),
      ),
    )
    await openAndSearch('doc')

    expect(screen.getAllByTestId('mobile-launcher-file-item')).toHaveLength(8)
    expect(screen.getByTestId('mobile-launcher-truncated')).toHaveTextContent(
      '共 11 条，仅显示前 8 条',
    )
    // 'doc' 无应用命中：应用组整组缺席（空态铁律——缺席的是组不是抽屉）。
    expect(screen.queryByTestId('mobile-launcher-group-apps')).toBeNull()
  })

  it('定位分发：点击文件行 = dirname 入 files-target-store + openApp files + onClose', async () => {
    const onClose = vi.fn()
    searchMock.mockResolvedValueOnce([searchResult('note.txt', '/Documents/note.txt')])
    render(<MobileLauncher open onClose={onClose} />)
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), {
      target: { value: 'note' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    fireEvent.click(screen.getByTestId('mobile-launcher-file-item'))

    expect(useFilesTargetStore.getState().pending).toBe('/Documents')
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.files',
      windowId: null,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('搜索失败：安全回退空文件域（无假结果，双组皆空走空态文案）', async () => {
    searchMock.mockRejectedValueOnce(new Error('vfs unavailable'))
    render(<MobileLauncher open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), {
      target: { value: 'x' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(screen.queryByTestId('mobile-launcher-group-files')).toBeNull()
    expect(screen.getByTestId('mobile-launcher-empty')).toHaveTextContent('没有匹配的结果')
  })

  it('重开复位：文件域结果不残留（重开 = 空查询态，未再发起搜索）', async () => {
    searchMock.mockResolvedValueOnce([searchResult('note.txt', '/Documents/note.txt')])
    const { rerender } = render(<MobileLauncher open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), {
      target: { value: 'note' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByTestId('mobile-launcher-file-item')).toBeInTheDocument()

    rerender(<MobileLauncher open={false} onClose={vi.fn()} />)
    await act(async () => {
      // 退场帧（200ms）播完卸载。
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.queryByTestId('mobile-launcher')).not.toBeInTheDocument()

    rerender(<MobileLauncher open onClose={vi.fn()} />)
    expect(screen.getByTestId('mobile-launcher-search')).toHaveValue('')
    expect(screen.queryByTestId('mobile-launcher-file-item')).toBeNull()
    expect(renderedAppIds()).toHaveLength(11)
    expect(searchMock).toHaveBeenCalledTimes(1)
  })
})
