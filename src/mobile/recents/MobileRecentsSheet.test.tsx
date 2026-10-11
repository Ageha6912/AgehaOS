import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale, useLocaleStore } from '@/core/i18n'
import { resetAppStore } from '@/store/app-store'
import {
  resetMobileNavStore,
  useMobileNavStore,
  type MobileAppRecord,
} from '@/store/mobile-nav-store'
import { resetMobileRecentsStore, useMobileRecentsStore } from '@/store/mobile-recents-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

import { MobileRecentsSheet } from './MobileRecentsSheet'

/**
 * M3-2 最近任务覆盖层契约（入口空态档归 MobileDock.test，真实触控归 E2E
 * e2e/mobile-recents.spec.ts）：
 * - 卡片 = AppIcon + 名称 + 打开时间（呈现序 = 打开序反转，新→旧），携带
 *   data-window-id（E2E 断言口，与宿主面板同一标记先例）；
 * - 点卡片 = switchToApp（不重新 launch）+ 关覆盖层（store 出口，onClose
 *   是持有方的回焦接线，点卡路径不被调用）；点当前应用卡 = 等值跳过 +
 *   关层；
 * - 单卡删除钮 = closeApp；「全部关闭」= closeAllApps；开着时记录被清空
 *   → 立即回调 onClose（空态整层不可达的兜底档，不留空 sheet）；
 * - 关闭路径：backdrop 点击与 Esc（document 捕获阶段）都回调 onClose；
 * - 玻璃克制（§35.1）：sheet = surface-glass + glass-raise 唯一玻璃档；
 * - i18n 双词典（§35.6）：标题/全部关闭/删除可访问名/时间从句。
 */

/** 造两条记录（打开序：files 旧、notes 新）+ 打开态。 */
function seedRecords(): MobileAppRecord[] {
  useMobileNavStore.getState().openApp('com.ageha.files')
  useMobileNavStore.getState().setAppWindow('win-files')
  useMobileNavStore.getState().openApp('com.ageha.notes')
  useMobileNavStore.getState().setAppWindow('win-notes')
  return useMobileNavStore.getState().apps
}

beforeEach(() => {
  localStorage.clear()
  resetAppStore()
  resetMobileNavStore()
  resetMobileRecentsStore()
})

afterEach(() => {
  useLocaleStore.setState(useLocaleStore.getInitialState())
  useMotionPrefsStore.setState(useMotionPrefsStore.getInitialState())
})

describe('MobileRecentsSheet', () => {
  it('closed 相位不渲染（开合归持有方）', () => {
    render(<MobileRecentsSheet open={false} onClose={() => {}} />)
    expect(screen.queryByTestId('mobile-recents')).not.toBeInTheDocument()
  })

  it('open 相位：dialog + 标题 + 卡片按打开序反转（新→旧），带 data-window-id 与打开时间', () => {
    seedRecords()
    render(<MobileRecentsSheet open onClose={() => {}} />)

    const layer = screen.getByTestId('mobile-recents')
    expect(layer).toHaveAttribute('data-state', 'open')
    const sheet = screen.getByTestId('mobile-recents-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAttribute('aria-label', '最近任务')
    expect(sheet).toHaveClass('surface-glass')
    expect(sheet).toHaveClass('glass-raise')

    const cards = screen.getAllByTestId('mobile-recents-card')
    expect(cards.map((card) => card.getAttribute('data-app-id'))).toEqual([
      'com.ageha.notes',
      'com.ageha.files',
    ])
    expect(cards[0]).toHaveAttribute('data-window-id', 'win-notes')
    expect(cards[0]).toHaveTextContent('记事')
    // 打开时间是 toLocaleTimeString 数据（时:分），不是硬编码文案。
    expect(cards[0]?.querySelector('time')).not.toBeNull()

    // 「全部关闭」在场（有卡片，禁止空态死按钮）。
    expect(screen.getByTestId('mobile-recents-close-all')).toHaveTextContent('全部关闭')
  })

  it('点卡片切换到对应窗口：nav 指向已有 windowId，记录不动，覆盖层关闭', () => {
    seedRecords()
    useMobileRecentsStore.getState().openRecents()
    const onClose = vi.fn()
    render(<MobileRecentsSheet open onClose={onClose} />)

    const filesCard = screen
      .getAllByTestId('mobile-recents-card')
      .find((card) => card.getAttribute('data-window-id') === 'win-files')
    expect(filesCard).toBeDefined()
    fireEvent.click(filesCard!)

    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.files',
      windowId: 'win-files',
    })
    expect(useMobileNavStore.getState().apps).toHaveLength(2)
    expect(useMobileRecentsStore.getState().open).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点当前应用卡：switchToApp 等值跳过，只关覆盖层', () => {
    seedRecords()
    useMobileNavStore.getState().openApp('com.ageha.notes') // 已是当前窗口
    useMobileRecentsStore.getState().openRecents()
    render(<MobileRecentsSheet open onClose={() => {}} />)

    fireEvent.click(screen.getAllByTestId('mobile-recents-card')[0]!)
    expect(useMobileNavStore.getState().nav).toEqual({
      view: 'app',
      appId: 'com.ageha.notes',
      windowId: 'win-notes',
    })
    expect(useMobileRecentsStore.getState().open).toBe(false)
  })

  it('删除钮 = closeApp 移除单条记录（关窗执行归 AppHost，此处只验状态）；点掉最后一张 → onClose 立即退场', async () => {
    seedRecords()
    const onClose = vi.fn()
    render(<MobileRecentsSheet open onClose={onClose} />)

    const filesClose = screen
      .getAllByTestId('mobile-recents-card-close')
      .find((button) => button.getAttribute('aria-label')?.includes('文件'))
    expect(filesClose).toBeDefined()
    fireEvent.click(filesClose!)

    expect(useMobileNavStore.getState().apps.map((app) => app.windowId)).toEqual(['win-notes'])
    expect(onClose).not.toHaveBeenCalled()

    // 最后一张也删掉：记录清空 → 空态整层不可达的兜底档生效。
    fireEvent.click(screen.getByTestId('mobile-recents-card-close'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('「全部关闭」= closeAllApps 清空记录 → onClose 立即退场', async () => {
    seedRecords()
    const onClose = vi.fn()
    render(<MobileRecentsSheet open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-recents-close-all'))
    expect(useMobileNavStore.getState().apps).toEqual([])
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('backdrop 点击与 Esc 都回调 onClose（关闭回焦接线归持有方）', () => {
    seedRecords()
    const onClose = vi.fn()
    render(<MobileRecentsSheet open onClose={onClose} />)

    fireEvent.click(screen.getByTestId('mobile-recents-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('退场帧：open→false 落 data-state=leaving（不经 null 空档），播完卸载', async () => {
    seedRecords()
    const { rerender } = render(<MobileRecentsSheet open onClose={() => {}} />)
    expect(screen.getByTestId('mobile-recents')).toHaveAttribute('data-state', 'open')

    rerender(<MobileRecentsSheet open={false} onClose={() => {}} />)
    const leaving = screen.getByTestId('mobile-recents')
    expect(leaving).toHaveAttribute('data-state', 'leaving')
    expect(leaving).toHaveAttribute('aria-hidden', 'true')

    await waitFor(
      () => expect(screen.queryByTestId('mobile-recents')).not.toBeInTheDocument(),
      { timeout: 600 },
    )
  })

  it('motion-prefs 窗口切换转场关档：根追加 .mobile-recents-static 直切', () => {
    seedRecords()
    act(() => {
      useMotionPrefsStore.setState({ windowTilt: false })
    })
    render(<MobileRecentsSheet open onClose={() => {}} />)
    expect(screen.getByTestId('mobile-recents')).toHaveClass('mobile-recents-static')
  })

  it('en 档：标题/全部关闭/删除可访问名走 en 词典（双词典类型对齐）', () => {
    seedRecords()
    setLocale('en')
    render(<MobileRecentsSheet open onClose={() => {}} />)

    expect(screen.getByTestId('mobile-recents-sheet')).toHaveAttribute('aria-label', 'Recent tasks')
    expect(screen.getByTestId('mobile-recents-close-all')).toHaveTextContent('Close all')
    const remove = screen.getAllByTestId('mobile-recents-card-close')[0]!
    expect(remove.getAttribute('aria-label')).toMatch(/^Close /)
    // 卡片可访问名 = 应用名 + 打开时间从句（en 连接符随语言）。
    const card = screen.getAllByTestId('mobile-recents-card')[0]!
    expect(card.getAttribute('aria-label')).toMatch(/^Notes, opened /)
  })
})
