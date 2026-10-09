import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getLocale, useLocaleStore } from '@/core/i18n'
import { resetMotionPrefsStore, useMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetSessionStore, seedSessionForTests, useSessionStore } from '@/store/session-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'

import { MobileControlCenterSheet } from './MobileControlCenterSheet'

/**
 * M2-3 移动控制中心契约（真实能力，无伪造开关——每项断言都落到对应 store
 * 的真实分发与既有消费机制的可见效果）：
 * - 主题/字号 = settings-store setTheme/setFontSize（documentElement 的
 *   dark 类与根字号跟随——applyTheme/applyFontSize 是既有全局消费机制）；
 * - 语言 = settings-store.setLocale → core i18n localeStore（词典切换后
 *   本面板自身文案同步切英文，驱动全部 useTranslation 消费方重渲染）；
 * - 减弱动效 = motion-prefs-store.windowTilt 反相呈现（checked = !windowTilt；
 *   关档时本 sheet 自身追加 .mobile-controlcenter-static 直切）；
 * - 登出 = session-store.logout（与桌面 UserMenu 同：无二次确认，先收面板
 *   再登出）；登出后 App.tsx phase 分支回登录态属 App 层，不在本组件。
 * - 关闭 = backdrop 点击 / Esc（document 捕获阶段）回调 onClose；open→false
 *   播完退场帧（data-state='leaving' + aria-hidden）再卸载；
 * - 触控纪律 = 选项 chip / 动效开关整行 / 登出按钮命中区 ≥44px（§35.3）。
 */

const TEST_USER = {
  id: 'u-cc',
  username: 'e2econtrol',
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
}

function optionByValue(testId: string, value: string): HTMLElement {
  const option = screen
    .getAllByTestId(testId)
    .find((element) => element.dataset.value === value)
  if (!option) throw new Error(`option ${testId}[data-value="${value}"] not found`)
  return option
}

beforeEach(() => {
  localStorage.clear()
  resetSettingsStore()
  resetMotionPrefsStore()
  resetSessionStore()
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileControlCenterSheet 面板契约', () => {
  it('dialog 角色 + i18n 可访问名 + 玻璃档（surface-glass + glass-raise）', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    const sheet = screen.getByTestId('mobile-control-center-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAttribute('aria-label', '控制中心')
    expect(sheet.className).toContain('surface-glass')
    expect(sheet.className).toContain('glass-raise')
    expect(screen.getByTestId('mobile-control-center')).toHaveAttribute('data-state', 'open')
  })

  it('关闭路径：backdrop 点击与 Esc 都回调 onClose；退场帧播完再卸载', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<MobileControlCenterSheet open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-control-center-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    // 持有方置 open=false 后：退场帧（aria-hidden + pointer-events 在组件侧
    // class），播完 200ms 卸载。
    rerender(<MobileControlCenterSheet open={false} onClose={onClose} />)
    const root = screen.getByTestId('mobile-control-center')
    expect(root).toHaveAttribute('data-state', 'leaving')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.className).toContain('pointer-events-none')
    await waitFor(() => expect(screen.queryByTestId('mobile-control-center')).toBeNull())
  })
})

describe('MobileControlCenterSheet 各开关分发对应 store action', () => {
  it('主题 chip 反映当前档；点「深色」分发 setTheme 且 documentElement dark 类跟随', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    // chip 组：三档按 data-value 区分，当前档（出厂浅色）aria-pressed=true。
    const chips = screen.getAllByTestId('mobile-control-theme-option')
    expect(chips).toHaveLength(3)
    expect(optionByValue('mobile-control-theme-option', 'light')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(optionByValue('mobile-control-theme-option', 'dark'))

    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(optionByValue('mobile-control-theme-option', 'dark')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(optionByValue('mobile-control-theme-option', 'light')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // 切回浅色：dark 类同步退场（settings-store 既有 applyTheme 消费机制）。
    fireEvent.click(optionByValue('mobile-control-theme-option', 'light'))
    expect(useSettingsStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('字号 chip 分发 setFontSize：根字号写入 documentElement（18px 档）', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    expect(useSettingsStore.getState().fontSize).toBe('medium')

    fireEvent.click(optionByValue('mobile-control-fontsize-option', 'large'))

    expect(useSettingsStore.getState().fontSize).toBe('large')
    expect(document.documentElement.style.fontSize).toBe('18px')
    expect(optionByValue('mobile-control-fontsize-option', 'large')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('语言 chip 分发 setLocale：localeStore 切换且面板文案即时切英文', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    expect(getLocale()).toBe('zh-CN')

    fireEvent.click(optionByValue('mobile-control-locale-option', 'en'))

    expect(getLocale()).toBe('en')
    // 面板自身是 useTranslation 消费方：标题与分区标签即时切英文（状态栏等
    // 其余消费方同一机制，E2E 断状态栏可访问名）。
    expect(screen.getByTestId('mobile-control-center-sheet')).toHaveAttribute(
      'aria-label',
      'Control center',
    )
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByText('Font size')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()

    // 切回简体中文。
    fireEvent.click(optionByValue('mobile-control-locale-option', 'zh-CN'))
    expect(getLocale()).toBe('zh-CN')
    expect(screen.getByTestId('mobile-control-center-sheet')).toHaveAttribute(
      'aria-label',
      '控制中心',
    )
  })

  it('减弱动效开关分发 motion-prefs：checked = windowTilt 反相，点按翻转布尔', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    // 出厂 windowTilt=true（转场开）→「减弱动效」未勾选。
    const motion = screen.getByTestId('mobile-control-motion-switch')
    expect(useMotionPrefsStore.getState().windowTilt).toBe(true)
    expect(motion).toHaveAttribute('role', 'switch')
    expect(motion).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(motion)
    expect(useMotionPrefsStore.getState().windowTilt).toBe(false)
    expect(screen.getByTestId('mobile-control-motion-switch')).toHaveAttribute(
      'aria-checked',
      'true',
    )

    fireEvent.click(screen.getByTestId('mobile-control-motion-switch'))
    expect(useMotionPrefsStore.getState().windowTilt).toBe(true)
  })

  it('motion-prefs 转场关档时本 sheet 直切（.mobile-controlcenter-static）', () => {
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    expect(screen.getByTestId('mobile-control-center').className).toContain(
      'mobile-controlcenter-static',
    )
  })

  it('登出分发 session-store.logout（无二次确认，与桌面 UserMenu 对齐）并先收面板', async () => {
    seedSessionForTests(TEST_USER)
    const onClose = vi.fn()
    render(<MobileControlCenterSheet open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-control-logout'))

    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(useSessionStore.getState().user).toBeNull())
    expect(useSessionStore.getState().status).toBe('anonymous')
  })
})

describe('MobileControlCenterSheet 触控纪律（§35.3）', () => {
  it('选项 chip / 动效开关整行 / 登出按钮命中区 ≥44px', () => {
    render(<MobileControlCenterSheet open onClose={vi.fn()} />)

    for (const testId of [
      'mobile-control-theme-option',
      'mobile-control-fontsize-option',
      'mobile-control-locale-option',
    ]) {
      for (const option of screen.getAllByTestId(testId)) {
        expect(option.className).toContain('min-h-[44px]')
      }
    }
    expect(screen.getByTestId('mobile-control-motion-switch').className).toContain('min-h-[44px]')
    expect(screen.getByTestId('mobile-control-logout').className).toContain('min-h-[44px]')
  })
})
