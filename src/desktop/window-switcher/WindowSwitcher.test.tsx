import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetPopoverStore, usePopoverStore } from '@/store/popover-store'
import { resetSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { resetWindowSwitcher, windowSwitcher } from './use-switcher'
import { WindowSwitcher } from './WindowSwitcher'

/**
 * Window Switcher 面板（W6，审计 .tmp/spaces-audit.md §9）钉扎：z 序渲染、
 * 选中高亮、popover 互斥（claim/release/被顶替不提交）、window blur 兜底提交、
 * 面板开启期间关窗竞态（live store 派生）。
 */

beforeEach(() => {
  resetWindowStore()
  resetSpaceStore()
  resetPopoverStore()
  resetWindowSwitcher()
})

/** 开两窗（后开者持焦点）并经 live 派生开面板。 */
function openTwoAndShowPanel(): { first: string; second: string } {
  const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
  const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
  act(() => {
    windowSwitcher.openFromLive()
  })
  return { first, second }
}

describe('WindowSwitcher 面板（W6 审计 §9）', () => {
  it('面板关闭时零渲染', () => {
    const { container } = render(<WindowSwitcher />)

    expect(container.firstChild).toBeNull()
  })

  it('渲染 z 降序条目 + 选中高亮 + 标题（i18n aria-label）', () => {
    const { first, second } = openTwoAndShowPanel()
    const { getByRole, getByTestId } = render(<WindowSwitcher />)

    expect(getByRole('dialog')).toHaveAttribute('aria-label', '窗口切换')

    const items = getByTestId('window-switcher-layer').querySelectorAll(
      '[data-testid="window-switcher-item"]',
    )
    expect(items).toHaveLength(2)
    // z 降序：后开的 second（zIndex 2）在前
    expect(items[0]?.getAttribute('data-window-id')).toBe(second)
    expect(items[1]?.getAttribute('data-window-id')).toBe(first)
    // 选中=预选的聚焦窗（second）
    const selected = getByTestId('window-switcher-layer').querySelector('[data-selected="true"]')
    expect(selected?.getAttribute('data-window-id')).toBe(second)
    expect(selected?.getAttribute('aria-current')).toBe('true')
  })

  it('选中态走 --ag-capsule-active 族（Sidebar 同款 primary Active/Selected 配额）', () => {
    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    const selected = getByTestId('window-switcher-layer').querySelector('[data-selected="true"]')
    expect(selected?.className).toContain('[background:var(--ag-capsule-active)]')
  })

  it('minimized 条目带「已最小化」徽标', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(first)
    act(() => {
      windowSwitcher.openFromLive()
    })
    const { getByTestId, getByText } = render(<WindowSwitcher />)

    expect(getByTestId('window-switcher-layer').textContent).toContain('已最小化')
    expect(getByText('记事')).toBeTruthy()
  })

  it('面板容器 pointer-events-none（键盘驱动 MVP，指针穿透）', () => {
    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    expect(getByTestId('window-switcher-layer').className).toContain('pointer-events-none')
  })

  it('互斥：开面板 claim window-switcher，cancel 后 release', () => {
    openTwoAndShowPanel()
    const { unmount } = render(<WindowSwitcher />)

    expect(usePopoverStore.getState().active).toBe('window-switcher')

    act(() => {
      windowSwitcher.cancel()
    })
    expect(usePopoverStore.getState().active).toBeNull()

    unmount()
  })

  it('被顶替（active 变他值）→ 关闭且不提交（minimized 选中不被还原）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second) // first 持焦点
    act(() => {
      windowSwitcher.openFromLive()
    })
    const { unmount } = render(<WindowSwitcher />)
    act(() => {
      windowSwitcher.cycleFromLive() // 选中 second（minimized）
    })
    expect(windowSwitcher.getState().selectedId).toBe(second)

    act(() => {
      usePopoverStore.getState().claim('launcher') // 被其他弹层顶替
    })

    expect(windowSwitcher.getState().open).toBe(false) // 关闭
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.state).toBe(
      'minimized',
    ) // 不提交：未还原
    // 焦点也不动（first 保持持焦）
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(usePopoverStore.getState().active).toBe('launcher')
    unmount()
  })

  it('window blur 兜底提交（keyup 丢失不得悬挂）', () => {
    const { first, second } = openTwoAndShowPanel()
    const { unmount } = render(<WindowSwitcher />)
    act(() => {
      windowSwitcher.cycleFromLive() // 选中 first
    })

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    // 提交选中 first：焦点落到 first（原焦点在 second）
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
    unmount()
  })

  it('面板开启期间关窗：选中失效顺延；关到 <2 窗自动收面板', () => {
    const a = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const b = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const c = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    act(() => {
      windowSwitcher.openFromLive()
    })
    const { getByTestId, unmount } = render(<WindowSwitcher />)
    expect(windowSwitcher.getState().selectedId).toBe(c) // 预选聚焦窗

    // 选中窗被关：同位顺延（会话序列 [c, b, a] → [b, a]）
    act(() => {
      useWindowStore.getState().close(c)
    })
    getByTestId('window-switcher-layer') // 面板仍在场
    expect(windowSwitcher.getState().selectedId).toBe(b)
    expect(windowSwitcher.getState().open).toBe(true)

    // 再关一扇：<2 窗 → 自动收面板
    act(() => {
      useWindowStore.getState().close(b)
    })
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.some((win) => win.id === a)).toBe(true)
    unmount()
  })

  it('面板关闭后 blur 监听不残留（防悬挂双保险）', () => {
    openTwoAndShowPanel()
    const { unmount } = render(<WindowSwitcher />)

    act(() => {
      windowSwitcher.cancel()
    })
    // blur 处理器随面板关闭卸除：此后 blur 不再触发任何提交路径
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(windowSwitcher.getState().open).toBe(false)

    unmount()
  })
})
