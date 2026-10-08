import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { resetAppStore, uninstallApp } from '@/store/app-store'
import { resetMobileNavStore, useMobileNavStore } from '@/store/mobile-nav-store'

import { MobileDock } from './MobileDock'
import { MOBILE_DOCK_APP_IDS } from '../shared/mobile-dock-slots'

/**
 * M1-5 移动 Dock 契约：固定 5 位（Home 复位 + Files/Notes/今日世界/
 * Settings openApp）——
 * - 固定序渲染（MOBILE_DOCK_APP_IDS 表序 = 渲染序），Home 位恒首；
 * - 动作分发：应用位点击 = mobile-nav-store.openApp 导航推进（M1-6 起由
 *   MobileAppHost 消费为真实启动，Dock 自身不开窗）；Home 位 = backToHome；
 * - 当前位高亮：view='app' 且 appId 匹配（指示条 + aria-current），Home 位
 *   不参与高亮，非 Dock 应用在/app 时全部位不亮；
 * - 共享元数据/图标：应用位可访问名 = appDisplayName（titleKey 本地化名，
 *   非 manifest.name 原文）、徽章 = AppIcon 44px 装饰位；
 * - 注册表防御位：不在册的位不渲染（禁止死瓦片），卸载即刻重渲染；
 * - 视觉钉位：唯一一层玻璃（surface-glass + glass-raise）、命中区 ≥44px
 *   （§35.3 类名钉位，真实几何归 E2E）、文案走 i18n 双词典（§35.6）。
 */

/** 按 data-app-id 取应用位按钮（渲染序无关）。 */
function appTile(appId: string): HTMLElement {
  const tile = screen
    .getAllByTestId('mobile-dock-app')
    .find((el) => el.getAttribute('data-app-id') === appId)
  if (!tile) throw new Error(`dock app tile not rendered: ${appId}`)
  return tile
}

/** 渲染结果里的应用位 appId 序（= MOBILE_DOCK_APP_IDS 表序）。 */
function renderedAppIds(): string[] {
  return screen
    .queryAllByTestId('mobile-dock-app')
    .map((tile) => tile.getAttribute('data-app-id') ?? '')
}

beforeEach(() => {
  localStorage.clear()
  // 内建清单入场（与 MobileAppGrid.test.tsx 同口径）+ 导航归位。
  resetAppStore()
  resetMobileNavStore()
})

afterEach(() => {
  // en 档测试不向同文件后续用例泄漏 locale（与 RecentApps.test.tsx 同口径）。
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('MobileDock', () => {
  it('固定 5 位：Home 位恒首 + 4 应用位按 MOBILE_DOCK_APP_IDS 表序渲染', () => {
    render(<MobileDock />)

    const dock = screen.getByRole('navigation', { name: '程序坞' })
    expect(dock).toBe(screen.getByTestId('mobile-dock'))
    expect(screen.getByTestId('mobile-dock-home')).toHaveAttribute('aria-label', '主屏幕')
    expect(renderedAppIds()).toEqual([...MOBILE_DOCK_APP_IDS])
    expect(renderedAppIds()).toEqual([
      'com.ageha.files',
      'com.ageha.notes',
      'com.ageha.dynamic.panel',
      'com.ageha.settings',
    ])
  })

  it('动作分发：应用位点击 = openApp 导航推进（windowId 待 M1-6 AppHost 落地），应用间直切成立', () => {
    render(<MobileDock />)

    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
    fireEvent.click(appTile('com.ageha.files'))
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.files',
      windowId: null,
    })

    // 应用间直切：再点今日世界位直达（无「先回 home」中间态，windowId 复位）。
    fireEvent.click(appTile('com.ageha.dynamic.panel'))
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.dynamic.panel',
      windowId: null,
    })
  })

  it('动作分发：Home 位点击 = backToHome 复位（app 档起），home 档幂等', () => {
    useMobileNavStore.getState().openApp('com.ageha.notes')
    render(<MobileDock />)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: null,
    })

    fireEvent.click(screen.getByTestId('mobile-dock-home'))
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })

    // home 档再点：纯状态机等值跳过（mobile-nav-store 值语义），位置不变。
    fireEvent.click(screen.getByTestId('mobile-dock-home'))
    expect(useMobileNavStore.getState().nav).toEqual({ view: 'home' })
  })

  it('当前位高亮：view=home 全暗；openApp 后匹配位亮（指示条 + aria-current）其余不亮', () => {
    render(<MobileDock />)

    const noTileActive = (): void => {
      for (const tile of screen.getAllByTestId('mobile-dock-app')) {
        expect(tile).not.toHaveAttribute('aria-current')
        expect(within(tile).queryByTestId('mobile-dock-active-indicator')).toBeNull()
      }
    }
    noTileActive()

    fireEvent.click(appTile('com.ageha.notes'))
    expect(appTile('com.ageha.notes')).toHaveAttribute('aria-current', 'true')
    expect(
      within(appTile('com.ageha.notes')).getByTestId('mobile-dock-active-indicator'),
    ).toBeInTheDocument()
    expect(appTile('com.ageha.files')).not.toHaveAttribute('aria-current')

    // 非 Dock 位应用在/app（如从 Home 网格进的）：全部位不亮。
    act(() => {
      useMobileNavStore.getState().openApp('com.ageha.store')
    })
    noTileActive()
  })

  it('注册表防御位：卸载 Dock 位应用 → 该位即刻消失，其余位与 Home 照常（禁止死瓦片）', () => {
    render(<MobileDock />)
    expect(renderedAppIds()).toHaveLength(4)

    act(() => {
      expect(uninstallApp('com.ageha.notes')).toBe(true)
    })

    expect(renderedAppIds()).toEqual([
      'com.ageha.files',
      'com.ageha.dynamic.panel',
      'com.ageha.settings',
    ])
    expect(screen.getByTestId('mobile-dock-home')).toBeInTheDocument()
  })

  it('共享元数据/图标：应用位可访问名 = appDisplayName 本地化名（titleKey 非 manifest.name）', () => {
    render(<MobileDock />)

    // 判别位：files 的 manifest.name = 'Files'（英文原文），本地化名走
    // builtin titleKey = '文件'——断言 '文件' 即钉住同一解析来源。
    expect(appTile('com.ageha.files')).toHaveAttribute('aria-label', '文件')
    expect(appTile('com.ageha.notes')).toHaveAttribute('aria-label', '记事')
    expect(appTile('com.ageha.dynamic.panel')).toHaveAttribute('aria-label', '动态面板')
    expect(appTile('com.ageha.settings')).toHaveAttribute('aria-label', '设置')

    // 徽章 = AppIcon 复用（44px、装饰位 aria-hidden，可访问名由 aria-label 承担）。
    const badge = appTile('com.ageha.files').firstElementChild as HTMLElement
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveStyle({ width: '44px', height: '44px' })
  })

  it('触控纪律：5 位按钮命中区下限 44px（§35.3 类名钉位，真实几何归 E2E）', () => {
    render(<MobileDock />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-[44px]')
      expect(button).toHaveClass('min-w-[44px]')
    }
  })

  it('玻璃克制（§35.1）：唯一一层玻璃 = surface-glass + glass-raise，无第二档 blur 类', () => {
    render(<MobileDock />)

    const dock = screen.getByTestId('mobile-dock')
    expect(dock).toHaveClass('surface-glass')
    expect(dock).toHaveClass('glass-raise')
    for (const tier of [
      'glass-hint',
      'glass-veil',
      'panel-frost',
      'glass-deep',
      'glass-popover',
      'dock-glass',
      'desktop-chrome',
    ]) {
      expect(dock).not.toHaveClass(tier)
    }
  })

  it('文案走 i18n：zh-CN 地标「程序坞」+ Home「主屏幕」，en 档同步切换', () => {
    const { rerender } = render(<MobileDock />)

    expect(screen.getByTestId('mobile-dock')).toHaveAttribute('aria-label', '程序坞')
    expect(screen.getByTestId('mobile-dock-home')).toHaveAttribute('aria-label', '主屏幕')

    setLocale('en')
    rerender(<MobileDock />)
    expect(screen.getByTestId('mobile-dock')).toHaveAttribute('aria-label', 'Dock')
    expect(screen.getByTestId('mobile-dock-home')).toHaveAttribute('aria-label', 'Home Screen')
    // 应用位名称跟随 appDisplayName 同步重取（en titleKey）。
    expect(appTile('com.ageha.files')).toHaveAttribute('aria-label', 'Files')
  })
})
