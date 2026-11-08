import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RemoteCatalogResult } from '@/core/apps/remote-catalog'
import { permissionManager, resetPermissionManager } from '@/core/permissions'
import { resetAppStore } from '@/store/app-store'

import { StoreApp } from './StoreApp'

const remoteCatalog = vi.hoisted(() => ({
  result: { ok: false, reason: 'unavailable' } as RemoteCatalogResult,
}))

vi.mock('@/core/apps/remote-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/apps/remote-catalog')>()),
  fetchSignedCatalog: vi.fn(async () => remoteCatalog.result),
}))

beforeEach(() => {
  resetAppStore()
  resetPermissionManager()
  remoteCatalog.result = { ok: false, reason: 'unavailable' }
})

async function renderSettled() {
  render(<StoreApp />)
  await act(async () => {})
}

/** jsdom 无布局：伪造列表盒尺寸后派发 scroll，驱动 useScrollZone 重读快照。 */
function measureList(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const list = screen.getByTestId('store-list')
  Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true })
  Object.defineProperty(list, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: clientHeight, configurable: true })
  fireEvent.scroll(list)
}

describe('StoreApp', () => {
  it('renders every bundled catalog entry with install actions', () => {
    render(<StoreApp />)

    // 4 样例 + 4 小游戏。
    const names = ['时钟', '画板', '便签', '云笔记', '贪吃蛇', '2048', '记忆翻牌', '扫雷']
    for (const name of names) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('button', { name: '安装' })).toHaveLength(names.length)

    // 列表图标 = 应用徽章系统（DESIGN.md §8），逐条渲染白色字形。
    const badgeCount = screen.getByTestId('store-list').querySelectorAll('li svg').length
    expect(badgeCount).toBe(names.length)
  })

  it('shows the bottom scroll fade only while content extends below the fold', () => {
    render(<StoreApp />)

    // jsdom 下无溢出：无遮罩。
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()

    measureList(0, 1000, 300)
    expect(screen.getByTestId('scroll-fade')).toBeInTheDocument()

    measureList(700, 1000, 300)
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()
  })

  it('stays quiet when there is simply no remote catalog (local mode / offline)', async () => {
    for (const reason of ['unavailable', 'no-valid-apps'] as const) {
      remoteCatalog.result = { ok: false, reason }
      const { unmount } = render(<StoreApp />)
      await act(async () => {})
      expect(screen.queryByTestId('store-remote-invalid'), reason).toBeNull()
      unmount()
    }
  })

  it('warns only when a remote catalog arrived but failed verification', async () => {
    remoteCatalog.result = { ok: false, reason: 'bad-signature' }
    await renderSettled()

    expect(screen.getByTestId('store-remote-invalid')).toBeInTheDocument()
  })

  it('describes bundled apps in user terms, not developer jargon', () => {
    render(<StoreApp />)

    const text = screen.getByTestId('store-list').textContent ?? ''
    expect(text).not.toMatch(/Type B|SDK|沙箱/)
  })

  it('always exposes the thin-scrollbar class on the list', () => {
    render(<StoreApp />)

    expect(screen.getByTestId('store-list').className).toContain('scroll-thin')
  })

  it('wide container: action buttons keep the pre-change literal classes', () => {
    render(<StoreApp />)

    // 逐字钉住改前模板产物（含 wide 档类名），防后续重构悄悄动桌面 DOM。
    expect(screen.getAllByRole('button', { name: '安装' })[0]!.className).toBe(
      'rounded-md bg-primary px-3 py-1.5 text-xs text-primary-contrast hover:opacity-90',
    )
    expect(screen.getAllByRole('button', { name: '安装' })[0]!.className).not.toContain(
      'min-h-[44px]',
    )
  })
})

/**
 * 窄容器分支（M3-4）：jsdom 无 ResizeObserver 时 use-narrow-container 降级
 * 恒 wide（桌面兜底——上方全部既有用例即在此路径运行，零改动通过）。本组
 * stub 一个最小 ResizeObserver 显式喂容器宽度驱动窄分支；几何级断言（命中
 * 区实测 / 无横向溢出）归 e2e/mobile-calculator-store.spec.ts 真实视口
 * （与 NotesApp/FileManager 窄容器组同一分工口径）。
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

describe('StoreApp 窄容器（M3-4）', () => {
  beforeEach(() => {
    resetAppStore()
    remoteCatalog.result = { ok: false, reason: 'unavailable' }
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function renderNarrow() {
    render(<StoreApp />)
    await act(async () => {
      FakeResizeObserver.instances.at(-1)?.emit(360)
    })
  }

  it('窄容器：卡片转单列（操作行在内容行之下），安装键触控档 44px', async () => {
    await renderNarrow()

    const install = screen.getAllByRole('button', { name: '安装' })[0]!
    expect(install.className).toContain('min-h-[44px]')
    // 单列卡片：卡片根纵向排布，操作键是内容行的弟弟（不在同一行右侧）。
    const cardRoot = install.closest('li')!.firstElementChild as HTMLElement
    expect(cardRoot.className).toContain('flex-col')
    expect(cardRoot.firstElementChild!.className).toContain('items-start')
    // 徽章行可换行（名称 + Web 应用 + 已安装 不撑破 360px 文字块）。
    expect(cardRoot.querySelector('p')!.className).toContain('flex-wrap')
  })

  it('窄容器：安装确认流可用（安装 → 允许并安装 → 已安装），卸载键 44×44', async () => {
    await renderNarrow()

    fireEvent.click(screen.getAllByRole('button', { name: '安装' })[0]!)
    const dialog = screen.getByRole('dialog', { name: '应用权限申请' })
    fireEvent.click(within(dialog).getByRole('button', { name: '允许并安装' }))

    expect(await screen.findByText('已安装')).toBeInTheDocument()
    const uninstall = screen.getByRole('button', { name: '卸载 时钟' })
    expect(uninstall.className).toContain('h-11 w-11')
    expect(uninstall.className).toContain('active:opacity-80')
    // 打开键同步触控档。
    expect(screen.getByRole('button', { name: '打开' }).className).toContain('min-h-[44px]')
  })

  it('卸载需二次确认：取消保留安装，确认后卸载', async () => {
    await renderSettled()

    fireEvent.click(screen.getAllByRole('button', { name: '安装' })[0]!)
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '应用权限申请' })).getByRole('button', {
        name: '允许并安装',
      }),
    )
    await act(async () => {})

    // 垃圾桶单击只开确认弹层，不直接卸载（D2 审查）。
    fireEvent.click(screen.getByRole('button', { name: '卸载 时钟' }))
    const dialog = screen.getByRole('dialog', { name: '卸载应用' })
    expect(within(dialog).getByText(/卸载「时钟」/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '卸载 时钟' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '卸载 时钟' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '卸载应用' })).getByRole('button', {
        name: '卸载',
      }),
    )
    expect(screen.queryByRole('button', { name: '卸载 时钟' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '安装' }).length).toBeGreaterThan(0)
  })

  it('安装时只授予用户勾选的权限（取消勾选保持拒绝）', async () => {
    await renderSettled()

    const noteCard = screen.getByText('云笔记').closest('li')!
    fireEvent.click(within(noteCard).getByRole('button', { name: '安装' }))
    const dialog = screen.getByRole('dialog', { name: '应用权限申请' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '发送通知' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '允许并安装' }))
    await act(async () => {})

    expect(permissionManager.has('com.ageha.samples.fs-note', 'filesystem.read')).toBe(true)
    expect(permissionManager.has('com.ageha.samples.fs-note', 'filesystem.write')).toBe(true)
    expect(permissionManager.has('com.ageha.samples.fs-note', 'notification')).toBe(false)
  })
})
