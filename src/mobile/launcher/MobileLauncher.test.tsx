import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { resetAppStore, useAppStore } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'

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
 */

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

    // 全量条数（boot = 10），前 7 = 常量优先序，羽化 L1 按本地化展示名排后。
    const registrySize = useAppStore.getState().apps.length
    expect(registrySize).toBe(10)
    const ids = renderedAppIds()
    expect(ids).toHaveLength(registrySize)
    expect(ids.slice(0, MOBILE_APP_ORDER.length)).toEqual([...MOBILE_APP_ORDER])
    expect(ids[0]).toBe('com.ageha.dynamic.panel')

    // 搜索框：placeholder 与可访问名同一句（桌面启动器 §0.6 口径）+ 打开即聚焦。
    const search = screen.getByTestId('mobile-launcher-search')
    expect(search).toHaveAttribute('placeholder', '搜索应用…')
    expect(search).toHaveAttribute('aria-label', '搜索应用…')
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
    expect(screen.getByTestId('mobile-launcher-empty')).toHaveTextContent('没有匹配的应用')

    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: '' } })
    expect(screen.queryByTestId('mobile-launcher-empty')).toBeNull()
    expect(renderedAppIds()).toHaveLength(10)
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
      'Search apps…',
    )
    fireEvent.change(screen.getByTestId('mobile-launcher-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('mobile-launcher-empty')).toHaveTextContent('No matching apps')
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
    expect(renderedAppIds()).toHaveLength(10)
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
