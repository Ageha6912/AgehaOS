import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetPopoverStore, usePopoverStore } from '@/store/popover-store'
import { resetSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { resetWindowSwitcher, windowSwitcher } from './use-switcher'
import { WindowSwitcher } from './WindowSwitcher'

/**
 * Window Switcher 面板钉扎。**W12 Windows Alt+Tab 同款语义（审计
 * .tmp/spaces-audit.md §14，用户确认）**：按住 Alt+W 面板驻留（提交触发点=
 * Alt keyup，在 use-global-shortcuts.test.tsx 钉扎）、底部提示改「alt 松开
 * 提交 · w 循环 · shift+w 反向 · esc 取消」、点击条目=提交该窗（保留手势）、
 * backdrop 点击与 window blur=取消不提交（W11 改判沿用）。popover 互斥
 * （claim/release/被顶替不提交）与关窗竞态顺延（live store 派生）护栏保留。
 * **真机反馈第三轮（用户裁决「向任务视图的窗口对齐、大小一致」）**：条目从
 * 「图标+标题 chip」改为与 Mission Control 窗口卡同款同尺寸的共享卡片脸
 * （WindowCardFace，224×152），选中态=主色描边/光晕——交互语义零变化。
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

describe('WindowSwitcher 面板（W6 边缘态 + W12 Windows 语义）', () => {
  it('面板关闭时零渲染', () => {
    const { container } = render(<WindowSwitcher />)

    expect(container.firstChild).toBeNull()
  })

  it('渲染 z 降序条目 + 选中=z 序下一位高亮 + 标题（i18n aria-label）', () => {
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
    // W11：open 选中=z 序下一位（聚焦窗 second 的下一位=first）
    const selected = getByTestId('window-switcher-layer').querySelector('[data-selected="true"]')
    expect(selected?.getAttribute('data-window-id')).toBe(first)
    expect(selected?.getAttribute('aria-current')).toBe('true')
  })

  it('Roving TabIndex：选中条目 tabIndex 0、其余 -1；箭头键走 cycle 语义且焦点跟随', () => {
    const { first, second } = openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    const buttons = Array.from(
      getByTestId('window-switcher-layer').querySelectorAll<HTMLButtonElement>(
        '[data-testid="window-switcher-item"] button',
      ),
    )
    // z 降序条目（second 在前）；open 选中=z 序下一位=first。
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0])

    // → = 正向 cycle：first → second（wrap）；DOM 焦点随选中挪动。
    // （keydown 派发在条目按钮上——handler 挂在 ul，按钮冒泡进处理器。）
    fireEvent.keyDown(buttons[1]!, { key: 'ArrowRight' })
    expect(windowSwitcher.getState().selectedId).toBe(second)
    expect(document.activeElement).toBe(buttons[0])
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1])

    // ← = 反向 cycle：second → first。
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowLeft' })
    expect(windowSwitcher.getState().selectedId).toBe(first)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('条目=与 Mission Control 同款卡片脸（共享 WindowCardFace 单一来源）：w-56 + 拟态窗脸 + 无 ❌', () => {    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    const item = getByTestId('window-switcher-layer').querySelector(
      '[data-testid="window-switcher-item"]',
    ) as HTMLElement
    // 真机反馈第三轮「向任务视图对齐、大小一致」：li 定宽 w-56(224px)，与
    // WindowCard 定位容器同档；卡面=共享拟态窗脸（AppIcon+标题+红黄绿控点
    // +占位条，与 MC 卡同结构→同尺寸 224×152）。
    expect(item.className).toContain('w-56')
    expect(item.querySelectorAll('[aria-hidden="true"] span[class*="bg-wl-"]')).toHaveLength(3)
    // ❌ 关闭钮是 MC 专属：切换器条目只有一个 button（卡片脸本体），无嵌套
    // button、无 mission-control 关闭钮挂载点。
    expect(item.querySelectorAll('button')).toHaveLength(1)
    expect(item.querySelector('[data-testid="mission-control-card-close"]')).toBeNull()
    // 同一硬性设计决定（禁 clone/禁截图）：零应用内容挂载点。
    expect(item.querySelector('iframe, canvas, img, object, embed')).toBeNull()
  })

  it('选中态=主色描边/光晕（--ag-capsule-active 族既有 primary token：border/ring/float）', () => {
    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    const selected = getByTestId('window-switcher-layer').querySelector('[data-selected="true"]')
    expect(selected?.querySelector('button')?.className).toContain('border-primary')
    expect(selected?.querySelector('button')?.className).toContain('ring-primary')
    expect(selected?.querySelector('button')?.className).toContain('shadow-float')
    // 非选中卡微降透明度（与选中卡 opacity-100 形成主次）。
    const unselected = getByTestId('window-switcher-layer').querySelector(
      '[data-testid="window-switcher-item"]:not([data-selected])',
    )
    expect(unselected?.querySelector('button')?.className).toContain('opacity-80')
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

  it('底部提示=「alt 松开提交 · w 循环 · shift+w 反向 · esc 取消」（W12 §14 目标 6）', () => {
    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    const footer = getByTestId('window-switcher-footer')
    expect(footer.textContent).toContain('松开提交')
    expect(footer.textContent).toContain('循环')
    expect(footer.textContent).toContain('反向')
    expect(footer.textContent).toContain('取消')
    // W11 的「Enter 提交 / 点击选择」提示随 W12 主路径（松开 Alt）切换移除
    // （两手势保留，不再占提示位）
    expect(footer.textContent).not.toContain('点击选择')
  })

  it('外层容器 pointer-events-none（指针穿透桌面），面板盒 pointer-events-auto（条目可点击）', () => {
    openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)

    expect(getByTestId('window-switcher-layer').className).toContain('pointer-events-none')
    expect(getByTestId('window-switcher').className).toContain('pointer-events-auto')
  })

  it('点击条目=提交该窗（choose；W12 §14 目标 5 保留手势）', () => {
    const { first, second } = openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)
    // open 选中=z-next（first）；点击 second 的条目 → second 聚焦、面板关
    const itemButton = getByTestId('window-switcher-layer').querySelector(
      `[data-testid="window-switcher-item"][data-window-id="${second}"] button`,
    ) as HTMLButtonElement

    fireEvent.click(itemButton)

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === second)?.focused).toBe(true)
    expect(windows.find((win) => win.id === first)?.focused).toBe(false)
    expect(windowSwitcher.getState().open).toBe(false)
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
      windowSwitcher.openFromLive() // W11：选中=z-next=second（minimized，不即时聚焦）
    })
    const { unmount } = render(<WindowSwitcher />)
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

  it('window blur=取消不提交（W11 改判、W12 §14 目标 4 沿用：切走即取消）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second) // first 持焦点
    act(() => {
      windowSwitcher.openFromLive() // 选中 second（minimized，未还原）
    })
    const { unmount } = render(<WindowSwitcher />)
    expect(windowSwitcher.getState().open).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    // 取消而非提交：second 仍最小化（提交会 restore+focus）、焦点保持 first
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.state).toBe(
      'minimized',
    )
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    expect(windowSwitcher.getState().open).toBe(false)
    unmount()
  })

  it('backdrop 点击（面板外 pointerdown）=取消不提交（W12 §14 目标 4，W11 改判沿用）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const second = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(second)
    act(() => {
      windowSwitcher.openFromLive() // 选中 second（minimized）
    })
    const { getByTestId, unmount } = render(<WindowSwitcher />)

    // 面板外按下（如桌面空白处）→ 取消；second 不被还原
    fireEvent.pointerDown(getByTestId('window-switcher-layer'))
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === second)?.state).toBe(
      'minimized',
    )
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
    unmount()
  })

  it('面板内按下不算 backdrop（不取消）；点条目才提交', () => {
    const { second } = openTwoAndShowPanel()
    const { getByTestId } = render(<WindowSwitcher />)
    const panel = getByTestId('window-switcher')

    fireEvent.pointerDown(panel)
    expect(windowSwitcher.getState().open).toBe(true) // 面板内 pointerdown 不取消

    fireEvent.click(panel.querySelector(`[data-window-id="${second}"] button`)!)
    expect(windowSwitcher.getState().open).toBe(false) // 显式点击条目才提交
  })

  it('面板开启期间关窗：选中失效顺延；关到 <2 窗自动收面板', () => {
    const a = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const b = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const c = useWindowStore.getState().open({ appId: 'com.ageha.settings', title: '设置' })
    act(() => {
      windowSwitcher.openFromLive()
    })
    const { getByTestId, unmount } = render(<WindowSwitcher />)
    // W11：open 选中=z-next（聚焦窗 c 的下一位=b）
    expect(windowSwitcher.getState().selectedId).toBe(b)

    // 选中窗被关：同位顺延（会话序列 [c, b, a] → [b, a]，b 存活选中保持）
    act(() => {
      useWindowStore.getState().close(c)
    })
    getByTestId('window-switcher-layer') // 面板仍在场
    expect(windowSwitcher.getState().selectedId).toBe(b)
    expect(windowSwitcher.getState().open).toBe(true)

    // 再关一扇（选中 b）：<2 窗 → 自动收面板（顺延不提交）
    act(() => {
      useWindowStore.getState().close(b)
    })
    expect(windowSwitcher.getState().open).toBe(false)
    expect(useWindowStore.getState().windows.some((win) => win.id === a)).toBe(true)
    unmount()
  })

  it('面板关闭后 blur 与 backdrop 监听不残留（防悬挂双保险）', () => {
    openTwoAndShowPanel()
    const { unmount } = render(<WindowSwitcher />)

    act(() => {
      windowSwitcher.cancel()
    })
    // blur / 面板外按下处理器随面板关闭卸除：此后不再触发任何路径
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    fireEvent.pointerDown(document.body)
    expect(windowSwitcher.getState().open).toBe(false)
    expect(usePopoverStore.getState().active).toBeNull()

    unmount()
  })

  it('点击条目提交后 popover 槽位释放（choose 路径与 Esc 同源收尾）', () => {
    openTwoAndShowPanel()
    const { getByTestId, unmount } = render(<WindowSwitcher />)
    expect(usePopoverStore.getState().active).toBe('window-switcher')

    fireEvent.click(
      getByTestId('window-switcher-layer').querySelector('[data-testid="window-switcher-item"] button')!,
    )

    expect(usePopoverStore.getState().active).toBeNull()
    unmount()
  })
})
