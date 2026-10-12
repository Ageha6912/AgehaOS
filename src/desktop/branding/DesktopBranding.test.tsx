import { Profiler } from 'react'

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetLauncherStore, useLauncherStore } from '@/store/launcher-store'
import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import { resetPopoverStore, usePopoverStore } from '@/store/popover-store'
import { resetSearchStore, useSearchStore } from '@/store/search-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { DesktopBranding } from './DesktopBranding'

beforeEach(() => {
  resetWindowStore()
  resetSpaceStore()
  resetLauncherStore()
  resetSearchStore()
  resetNotificationStore()
  resetPopoverStore()
})

/** 在 act 内执行 store 变更（同步冲刷订阅渲染，渲染计数可精确断言）。 */
function actStore(mutate: () => void): void {
  act(() => {
    mutate()
  })
}

describe('DesktopBranding（STEP 5 Desktop Environment Branding 状态化）', () => {
  it('keeps the wordmark block contract: position, decoration exemption, copy', () => {
    render(<DesktopBranding />)

    const branding = screen.getByTestId('desktop-branding')
    // 位置基线不动（§33.4：50%x 与 Dock 中线对齐 / 30% y 对齐壁纸蝴蝶）。
    expect(branding.className).toContain('left-1/2')
    expect(branding.className).toContain('top-[30%]')
    // 过渡复用既有 motion：300ms ease-out opacity 过渡，无第二套动效。
    expect(branding.className).toContain('transition-opacity')
    expect(branding.className).toContain('duration-300')
    expect(branding.className).toContain('ease-out')
    // 纯装饰恒成立：辅助树隐形 + 指针穿透（右键空白等桌面契约不受影响）。
    expect(branding.getAttribute('aria-hidden')).toBe('true')
    expect(branding.className).toContain('pointer-events-none')
    // 文案保留（STEP 5 契约：AgehaOS / Your Web OS, Your Space. 不动）。
    expect(branding.textContent).toContain('AgehaOS')
    expect(branding.textContent).toContain('Your Web OS, Your Space.')
  })

  it('wears the cool-violet wordmark gradient (shell 2.0 裁决 C: no pink residue)', () => {
    render(<DesktopBranding />)

    const osSpan = screen.getByTestId('desktop-branding').querySelector('p > span + span') as HTMLElement
    expect(osSpan.className).toContain('bg-gradient-to-r')
    expect(osSpan.classList.contains('to-[#d8ceff]')).toBe(true)
    expect(osSpan.className).not.toContain('to-[#f4bde4]')
  })

  it('idle desktop shows the brand at full strength (100%，取代 Shell 2.0 的 90%)', () => {
    render(<DesktopBranding />)

    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-100')
    expect(screen.getByTestId('desktop-branding').className).not.toContain('opacity-90')
  })

  it('steps down the ladder with visible windows: one → 40%, many → 15%', () => {
    const { rerender } = render(<DesktopBranding />)

    let first = ''
    actStore(() => {
      first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    })
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.calculator', title: '计算器' }))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-15')

    // 最小化其一 → 回单窗档；全最小化 → 回空闲满档。
    actStore(() => useWindowStore.getState().minimize(first))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    actStore(() =>
      useWindowStore
        .getState()
        .windows.filter((win) => win.state !== 'minimized')
        .forEach((win) => useWindowStore.getState().minimize(win.id)),
    )
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-100')
  })

  it('可见计数只算当前 Space：其他 Space 窗口不触发降档（W2，审计 §5 决定 4）', () => {
    render(<DesktopBranding />)

    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' }))
    actStore(() =>
      useWindowStore
        .getState()
        .open({ appId: 'com.ageha.calculator', title: '计算器', spaceId: 'space-other' }),
    )
    expect(useSpaceStore.getState().activeSpaceId).not.toBe('space-other')

    // 只有一扇当前 Space 可见窗 → 单窗档 40%（若误计其他 Space 会是 15%）。
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')
  })

  it('hides while any chrome overlay is open and restores the window tier on close', () => {
    const { rerender } = render(<DesktopBranding />)
    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' }))
    rerender(<DesktopBranding />)

    // ① 启动器（launcher-store 直接开关）。
    actStore(() => useLauncherStore.getState().setLauncherOpen(true))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')
    actStore(() => useLauncherStore.getState().setLauncherOpen(false))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    // ② 全局搜索（search-store）。
    actStore(() => useSearchStore.getState().setOpen(true))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')
    actStore(() => useSearchStore.getState().close())
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    // ③ 通知中心（notification-store.panelOpen）。
    actStore(() => useNotificationStore.getState().setPanelOpen(true))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')
    actStore(() => useNotificationStore.getState().setPanelOpen(false))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    // ④ popover 互斥槽兜底的其余弹层（菜单栏下拉/用户菜单/右键菜单等）。
    actStore(() => usePopoverStore.getState().claim('menubar'))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')
    actStore(() => usePopoverStore.getState().release('menubar'))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')
  })

  it('still hides for the world-signals popover slot after the STEP 3 migration（hidden 档完整性）', () => {
    const { rerender } = render(<DesktopBranding />)
    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' }))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')

    // 世界信号弹层（Shell 3.1 STEP 3 自顶栏迁入 widgets/WorldSignals.tsx，
    // 槽名 'world-signals' 不变）仍经 popover 互斥槽兜底触发 hidden 档。
    actStore(() => usePopoverStore.getState().claim('world-signals'))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')
    actStore(() => usePopoverStore.getState().release('world-signals'))
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-40')
  })

  it('keeps the fade transition mounted and the opacity ladder monotonic（平滑无跳变）', () => {
    const { rerender } = render(<DesktopBranding />)
    const branding = () => screen.getByTestId('desktop-branding')
    // 每次档位变化后：过渡三件套恒挂（300ms ease-out 渐变而非跳切）且
    // opacity 工具类恰一个（单值决定，同一渲染周期档位只变一次）。
    const expectFadeMountedWithSingleTier = (tier: string): void => {
      for (const cls of ['transition-opacity', 'duration-300', 'ease-out']) {
        expect(branding().className).toContain(cls)
      }
      expect(branding().className.match(/opacity-\d+/g)).toEqual([tier])
    }

    expectFadeMountedWithSingleTier('opacity-100')

    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' }))
    rerender(<DesktopBranding />)
    expectFadeMountedWithSingleTier('opacity-40')

    actStore(() => useWindowStore.getState().open({ appId: 'com.ageha.calculator', title: '计算器' }))
    rerender(<DesktopBranding />)
    expectFadeMountedWithSingleTier('opacity-15')

    actStore(() => useLauncherStore.getState().setLauncherOpen(true))
    rerender(<DesktopBranding />)
    expectFadeMountedWithSingleTier('opacity-0')

    actStore(() => useLauncherStore.getState().setLauncherOpen(false))
    rerender(<DesktopBranding />)
    // 关闭后精确回窗档（15%）——逐档回归而非跳回满档。
    expectFadeMountedWithSingleTier('opacity-15')
  })

  it('renders only on tier changes: high-frequency move/focus commits stay render-free', () => {
    let renders = 0
    render(
      <Profiler
        id="desktop-branding"
        onRender={() => {
          renders += 1
        }}
      >
        <DesktopBranding />
      </Profiler>,
    )
    const baseline = renders // 初始挂载后基准

    // 开窗：full→dim，恰一次渲染。
    let id = ''
    actStore(() => {
      id = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    })
    expect(renders).toBe(baseline + 1)

    // 高频 commit（拖拽 = 连续 move + focus，每次 commit 新数组引用）：
    // 计数选择器输出不变 → 零重渲染（STEP 5 验收：状态切换不引发高频 re-render）。
    for (let step = 0; step < 20; step += 1) {
      actStore(() => {
        useWindowStore.getState().move(id, 120 + step, 90)
        useWindowStore.getState().focus(id)
      })
    }
    expect(renders).toBe(baseline + 1)

    // 再开一窗：dim→faint，又恰一次。
    actStore(() =>
      useWindowStore.getState().open({ appId: 'com.ageha.calculator', title: '计算器' }),
    )
    expect(renders).toBe(baseline + 2)
  })
})
