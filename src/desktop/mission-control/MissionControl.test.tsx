import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import { resetShortcutRegistry } from '@/desktop/shortcuts/registry'
import {
  startSpaceFocusTracking,
  stopSpaceFocusTracking,
} from '@/desktop/window/space-focus'
import { useGlobalShortcuts } from '@/desktop/use-global-shortcuts'
import {
  activateCardWindow,
  resetMissionControlStore,
  useMissionControlStore,
} from '@/store/mission-control-store'
import { resetPopoverStore, usePopoverStore } from '@/store/popover-store'
import { resetSpaceStore, useSpaceStore } from '@/store/space-store'
import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { MissionControl } from './MissionControl'

/**
 * Mission Control（W7，审计 .tmp/spaces-audit.md §10）钉扎：Space 条 CRUD 与
 * 计数、inline rename、空/非空删除两路（迁移流无半删态）、卡片区当前 Space
 * 口径、点击激活、拖拽落点 moveWindowToSpace（拖拽期间禁 switchSpace）、
 * popover 互斥与 backdrop 关闭。W11（审计 §13 B）：卡片 ❌ 关闭钮 + 「点击
 * 卡片最终焦点=被点窗口」两路钉扎（同 Space / 跨 Space，生产态 space-focus
 * tracking 开启）。
 */

beforeEach(() => {
  resetWindowStore()
  resetSpaceStore()
  resetPopoverStore()
  resetMissionControlStore()
  // Esc 分层钉扎用例需要真 registry 分发与组件 document 捕获监听同场，
  // 逐用例复位（条目与 window 监听都不跨用例泄漏）。
  resetShortcutRegistry()
  // W11：space-focus 追踪逐用例复位（需要生产态的用例显式 start）。
  stopSpaceFocusTracking()
})

afterEach(() => {
  stopSpaceFocusTracking()
})

/** 开启 MC 层并渲染（jsdom 无 elementFromPoint，命中测试一律注入桩）。 */
function renderOpen(hitTest: (x: number, y: number) => string | null = () => null) {
  act(() => {
    useMissionControlStore.getState().setOpen(true)
  })
  return render(<MissionControl hitTest={hitTest} />)
}

/** 挂 shell 快捷键 registry 的空壳（Esc 分层钉扎用例与 MC 组件同场挂载）。 */
function ShortcutsHarness(): null {
  useGlobalShortcuts()
  return null
}

describe('MissionControl（W7 审计 §10）', () => {
  it('关闭时零渲染', () => {
    const { container } = render(<MissionControl />)

    expect(container.firstChild).toBeNull()
  })

  it('Space 条渲染胶囊（名称+N Apps 计数）与「+」；active 胶囊高亮', () => {
    useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()

    const bar = getByTestId('mission-control-spaces')
    const capsules = bar.querySelectorAll('[data-testid="mission-control-space"]')
    expect(capsules).toHaveLength(2)
    expect(bar.textContent).toContain('Desktop 1')
    expect(bar.textContent).toContain('工作')
    // 计数=该 Space 窗口数（从 useWindowStore.windows 派生）。
    expect(bar.textContent).toContain('1 个应用')
    expect(bar.textContent).toContain('0 个应用')
    expect(getByTestId('mission-control-new-space')).toBeTruthy()
    const active = bar.querySelector('[data-active="true"]')
    expect(active?.getAttribute('data-space-id')).toBe(DEFAULT_SPACE_ID)
    // 选中态走 --ag-capsule-active 族（Sidebar/switcher 同款配额）。
    expect(active?.className).toContain('[background:var(--ag-capsule-active)]')
  })

  it('卡片区=当前 Space 窗口；其他 Space 的窗口不出卡', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: 'space-other' })
    const { getByTestId } = renderOpen()

    const cards = getByTestId('mission-control-cards').querySelectorAll(
      '[data-testid="mission-control-card"]',
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.getAttribute('data-window-id')).toBe(
      useWindowStore.getState().windows.find((win) => win.title === '记事')?.id,
    )
  })

  it('卡片区布局（真机反馈修复钉扎）：换行网格双向居中 + 纵向细滚动条，无横滚语义', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()

    // 用户裁决（真机截图：卡片从视口左缘起排、右缘裁切+横向滚动条）：
    // 卡片区改「外层滚动容器 + 内层居中网格」两层——外层占满 Space 条下方
    // 余高（flex-1+min-h-0）且只纵滚（overflow-y-auto + Sidebar 同款
    // overflow-x-hidden + 仓库既有 scroll-thin 细滚动条）；内层网格
    // flex-wrap 自动换行 + justify-center 行内居中 + m-auto 双向安全居中
    // （未超屏=MC 层内水平+垂直居中；超屏回落顶对齐滚动，不出横滚）。
    // jsdom 无布局，按仓库惯例钉 className（StoreApp/NotificationCenter
    // scroll-thin 断言同款）。
    const cards = getByTestId('mission-control-cards')
    expect(cards.className).toContain('flex-1')
    expect(cards.className).toContain('min-h-0')
    expect(cards.className).toContain('overflow-y-auto')
    expect(cards.className).toContain('overflow-x-hidden')
    expect(cards.className).toContain('scroll-thin')
    // backdrop 穿透语义零回归：容器自身保持 pointer-events-none（卡片内
    // 部 button 自持 auto，见 WindowCard）。
    expect(cards.className).toContain('pointer-events-none')

    const grid = cards.firstElementChild as HTMLElement
    expect(grid.className).toContain('flex-wrap')
    expect(grid.className).toContain('justify-center')
    expect(grid.className).toContain('m-auto')
    // 卡片是网格直接子节点（换行网格的一等成员，窗口卡=一张一格）。
    expect(grid.querySelector('[data-testid="mission-control-card"]')).not.toBeNull()
  })

  it('点击胶囊=switchSpace（卡片区随之切换）', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(`[data-space-id="${second}"]`)!,
      { detail: 1 },
    )

    expect(useSpaceStore.getState().activeSpaceId).toBe(second)
    const cards = getByTestId('mission-control-cards')
    expect(cards.querySelectorAll('[data-testid="mission-control-card"]')).toHaveLength(0)
  })

  it('「+」=createSpace', () => {
    const { getByTestId } = renderOpen()

    fireEvent.click(getByTestId('mission-control-new-space'))

    expect(useSpaceStore.getState().spaces).toHaveLength(2)
  })

  it('inline rename：双击进 input，Enter 提交 renameSpace', () => {
    const { getByTestId } = renderOpen()
    const capsule = getByTestId('mission-control-spaces').querySelector(
      `[data-space-id="${DEFAULT_SPACE_ID}"]`,
    ) as HTMLElement

    fireEvent.doubleClick(capsule)
    const input = getByTestId('mission-control-space-rename') as HTMLInputElement
    expect(input.value).toBe('Desktop 1')

    fireEvent.change(input, { target: { value: '主桌面' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useSpaceStore.getState().spaces[0]?.name).toBe('主桌面')
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
    expect(getByTestId('mission-control-spaces').textContent).toContain('主桌面')
  })

  it('inline rename：Esc 还原（未应用任何改动）', () => {
    const { getByTestId } = renderOpen()
    fireEvent.doubleClick(
      getByTestId('mission-control-spaces').querySelector(
        `[data-space-id="${DEFAULT_SPACE_ID}"]`,
      )!,
    )
    const input = getByTestId('mission-control-space-rename') as HTMLInputElement

    fireEvent.change(input, { target: { value: '不该生效' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(useSpaceStore.getState().spaces[0]?.name).toBe('Desktop 1')
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('inline rename：空值 Enter 引擎拒绝（名字保持原名）后退出编辑', () => {
    const { getByTestId } = renderOpen()
    fireEvent.doubleClick(
      getByTestId('mission-control-spaces').querySelector(
        `[data-space-id="${DEFAULT_SPACE_ID}"]`,
      )!,
    )

    fireEvent.keyDown(getByTestId('mission-control-space-rename'), {
      key: 'Enter',
      currentTarget: { value: '   ' },
    })

    expect(useSpaceStore.getState().spaces[0]?.name).toBe('Desktop 1')
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('单 Space 不渲染删除钮；多 Space 渲染', () => {
    const { getByTestId, rerender } = render(<MissionControl />)
    act(() => {
      useMissionControlStore.getState().setOpen(true)
    })
    expect(getByTestId('mission-control-spaces').querySelectorAll('[data-testid="mission-control-space-delete"]')).toHaveLength(0)

    useSpaceStore.getState().createSpace('工作')
    rerender(<MissionControl />)

    expect(
      getByTestId('mission-control-spaces').querySelectorAll('[data-testid="mission-control-space-delete"]'),
    ).toHaveLength(2)
  })

  it('空 Space 删除=直接 deleteSpace（无确认弹层）', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${second}"]`,
      )!,
    )

    expect(useSpaceStore.getState().spaces.map((space) => space.id)).toEqual([DEFAULT_SPACE_ID])
    expect(screen.queryByTestId('mission-control-delete-confirm')).toBeNull()
  })

  it('非空 Space 删除：确认前零副作用；取消两路全保', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', spaceId: second })
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${second}"]`,
      )!,
    )
    // 确认弹层在场：默认迁移目标=相邻前一个 Space（Desktop 1）。
    expect(getByTestId('mission-control-delete-confirm')).toBeTruthy()
    expect(getByTestId('mission-control-delete-confirm').textContent).toContain('Desktop 1')

    fireEvent.click(getByTestId('mission-control-delete-cancel'))

    expect(useSpaceStore.getState().spaces).toHaveLength(2)
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().windows[0]?.spaceId).toBe(second)
    expect(screen.queryByTestId('mission-control-delete-confirm')).toBeNull()
  })

  it('确认弹层开启期 Esc 分层（W7 复核 low 备忘）：首击仅取消弹层（MC 层仍开），再击才关 MC', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', spaceId: second })
    // registry 与组件同场：第一击 Esc 归弹层自理（document 捕获段），第二击
    // 才落 registry 的 MC Esc 条目（when 守卫依 isDeleteConfirmOpen 让位）。
    const { getByTestId } = render(
      <>
        <MissionControl />
        <ShortcutsHarness />
      </>,
    )
    act(() => {
      useMissionControlStore.getState().setOpen(true)
    })

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${second}"]`,
      )!,
    )
    expect(getByTestId('mission-control-delete-confirm')).toBeTruthy()

    // 首击 Esc：弹层关、MC 层仍开、Space 零副作用（一个不删）。
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('mission-control-delete-confirm')).toBeNull()
    expect(useMissionControlStore.getState().open).toBe(true)
    expect(useSpaceStore.getState().spaces).toHaveLength(2)

    // 再击 Esc：弹层已不在场，registry 恢复接管——MC 层关闭。
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useMissionControlStore.getState().open).toBe(false)
  })

  it('非空 Space 确认删除：先迁全部窗口到相邻前一个 Space，最后一步才删（无半删态）', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事', spaceId: second })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件', spaceId: second })
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${second}"]`,
      )!,
    )
    fireEvent.click(getByTestId('mission-control-delete-confirm-button'))

    expect(useSpaceStore.getState().spaces.map((space) => space.id)).toEqual([DEFAULT_SPACE_ID])
    const windows = useWindowStore.getState().windows
    expect(windows).toHaveLength(2)
    for (const win of windows) expect(win.spaceId).toBe(DEFAULT_SPACE_ID)
  })

  it('删除居首的非空 Space：迁移目标回落相邻后一个', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    const third = useSpaceStore.getState().createSpace('开发')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${DEFAULT_SPACE_ID}"]`,
      )!,
    )
    expect(getByTestId('mission-control-delete-confirm').textContent).toContain('工作')

    fireEvent.click(getByTestId('mission-control-delete-confirm-button'))

    expect(useSpaceStore.getState().spaces.map((space) => space.id)).toEqual([second, third])
    expect(useWindowStore.getState().windows[0]?.spaceId).toBe(second)
  })

  it('删除 active Space：先 switchSpace 到迁移目标，active 落迁移目标', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()

    fireEvent.click(
      getByTestId('mission-control-spaces').querySelector(
        `[data-testid="mission-control-space-delete"][data-space-id="${DEFAULT_SPACE_ID}"]`,
      )!,
    )
    fireEvent.click(getByTestId('mission-control-delete-confirm-button'))

    expect(useSpaceStore.getState().spaces.map((space) => space.id)).toEqual([second])
    expect(useSpaceStore.getState().activeSpaceId).toBe(second)
  })

  it('激活语义（模块级）：可见窗 focus；minimized 卡 restore+focus；跨 Space 先 switchSpace', () => {
    const other = useSpaceStore.getState().createSpace('工作')
    const visible = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const minimized = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().minimize(minimized)
    const cross = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.settings', title: '设置', spaceId: other })
    // active 保持 DEFAULT：cross 在其他 Space——防御分支真正走到（W11 修正：
    // 旧用例先 switchSpace(other) 再激活，分支条件恒 false 未被覆盖）。

    // 可见窗：仅 focus。
    activateCardWindow(useWindowStore.getState().windows.find((w) => w.id === visible)!)
    let windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === visible)?.focused).toBe(true)

    // minimized：restore+focus（switcher 同款组合）。
    activateCardWindow(useWindowStore.getState().windows.find((w) => w.id === minimized)!)
    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === minimized)?.state).not.toBe('minimized')
    expect(windows.find((win) => win.id === minimized)?.focused).toBe(true)

    // 跨 Space：先 switchSpace 到该窗所在 Space 再 focus（最终焦点=被点窗）。
    activateCardWindow(useWindowStore.getState().windows.find((w) => w.id === cross)!)
    expect(useSpaceStore.getState().activeSpaceId).toBe(other)
    windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === cross)?.focused).toBe(true)
    expect(windows.find((win) => win.id === visible)?.focused).toBe(false)
  })

  it('跨 Space 拖卡：目标胶囊高亮、drop 后 moveWindowToSpace、期间 activeSpaceId 不变', () => {
    const second = useSpaceStore.getState().createSpace('工作')
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const hitTest = vi.fn(() => second)
    const { getByTestId } = renderOpen(hitTest)
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${winId}"]`,
    ) as HTMLElement
    const activeBefore = useSpaceStore.getState().activeSpaceId

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    // 未过阈值：还是点击候选，无拖拽态。
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 101,
      clientY: 100,
      pointerId: 1,
    })
    expect(card.getAttribute('data-dragging')).toBeNull()

    // 越过阈值：拖拽态 + 目标胶囊高亮；期间不发 switchSpace。
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })
    expect(card.getAttribute('data-dragging')).toBe('true')
    expect(
      getByTestId('mission-control-spaces').querySelector(`[data-space-id="${second}"]`),
    ).toHaveAttribute('data-drop-active', 'true')
    expect(useSpaceStore.getState().activeSpaceId).toBe(activeBefore)
    expect(hitTest).toHaveBeenCalled()

    fireEvent.pointerUp(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })

    expect(
      useWindowStore.getState().windows.find((win) => win.id === winId)?.spaceId,
    ).toBe(second)
    expect(useSpaceStore.getState().activeSpaceId).toBe(activeBefore) // drop 才动，切换仍未发生
    // 被拖卡已归属他 Space：从当前 Space 卡片区消失（窗口组件树不动）。
    expect(
      getByTestId('mission-control-cards').querySelector(`[data-window-id="${winId}"]`),
    ).toBeNull()
  })

  it('拖拽中原卡：pointer-events-none + 半透明留位（不跟手）；drop 结束恢复命中', () => {
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${winId}"]`,
    ) as HTMLElement
    expect(card.className).toContain('pointer-events-auto')

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })

    expect(card.getAttribute('data-dragging')).toBe('true')
    // W7 复核修复：elementFromPoint 穿过被拖卡命中胶囊（不再依赖 overflow
    // 裁剪把越界卡「剪掉」的副作用）。
    expect(card.className).toContain('pointer-events-none')
    expect(card.className).not.toContain('pointer-events-auto')
    // 半透明=原位提示；跟手视觉移交根层拖拽影，原卡零内联 transform。
    expect(card.className).toContain('opacity-40')
    expect(card.style.transform).toBe('')

    fireEvent.pointerUp(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })
    expect(card.className).toContain('pointer-events-auto')
    expect(card.className).not.toContain('pointer-events-none')
  })

  it('拖拽影：渲染在层根 fixed 容器内（脱离 overflow-y-auto 裁剪）、pointer-events-none、transform-only 跟手', () => {
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${winId}"]`,
    ) as HTMLElement

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })

    const ghostLayer = getByTestId('mission-control-drag-layer')
    const ghost = getByTestId('mission-control-drag-ghost')
    // 影层=层根（fixed inset-0）的直接子层——不是卡片区滚动容器的后代，
    // 视觉不被 overflow-y-auto 裁剪（修「拖向胶囊途中上缘被切断」）。
    expect(ghostLayer.parentElement).toBe(getByTestId('mission-control-layer'))
    expect(ghost.closest('[data-testid="mission-control-cards"]')).toBeNull()
    // 影与所在层全程 pointer-events-none：命中测试天然落到下方胶囊。
    expect(ghostLayer.className).toContain('pointer-events-none')
    expect(ghost.className).toContain('pointer-events-none')
    // 影面=AppIcon+标题同卡面。
    expect(ghost.textContent).toContain('记事')
    // transform-only 跟手（jsdom 卡片 rect 全 0 → 抓取点=起点）：
    // 位移=指针-抓取点，transform-origin 钉在抓取点（scale 不漂移）；
    // 初始落位走静态 class（left-0/top-0），逐帧只写 transform。
    const motion = ghost.parentElement as HTMLElement
    expect(motion.style.transform).toBe('translate3d(60px, -40px, 0) scale(1.03)')
    expect(motion.style.transformOrigin).toBe('100px 100px')
    expect(motion.className).toContain('left-0')
    expect(motion.className).toContain('top-0')
    expect(motion.style.left).toBe('')
    expect(motion.style.top).toBe('')

    fireEvent.pointerUp(getByTestId('mission-control-layer'), {
      clientX: 160,
      clientY: 60,
      pointerId: 1,
    })
    expect(screen.queryByTestId('mission-control-drag-ghost')).toBeNull()
  })

  it('拖拽后合成 click 不激活窗口（拖拽落点不是点击）', () => {
    const first = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().focus(first) // 焦点先落 first（open 自带聚焦 second）
    const { getByTestId } = renderOpen(() => null)
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${winId}"]`,
    ) as HTMLElement

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
    })
    fireEvent.pointerUp(getByTestId('mission-control-layer'), {
      clientX: 200,
      clientY: 200,
      pointerId: 1,
    })
    fireEvent.click(card, { detail: 1 })

    // 拖拽落点无胶囊（hitTest→null）：窗口不迁移、合成 click 不激活（不抢焦点）。
    expect(useWindowStore.getState().windows.find((win) => win.id === winId)?.focused).toBe(false)
    expect(useWindowStore.getState().windows.find((win) => win.id === first)?.focused).toBe(true)
  })

  it('pointercancel 中止拖拽：不迁移、拖拽态清空', () => {
    const winId = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen(() => DEFAULT_SPACE_ID)
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${winId}"]`,
    ) as HTMLElement

    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(getByTestId('mission-control-layer'), {
      clientX: 180,
      clientY: 80,
      pointerId: 1,
    })
    fireEvent.pointerCancel(getByTestId('mission-control-layer'), { pointerId: 1 })

    expect(useWindowStore.getState().windows.find((win) => win.id === winId)?.spaceId).toBe(
      DEFAULT_SPACE_ID,
    )
    expect(card.getAttribute('data-dragging')).toBeNull()
  })

  it('互斥：开启 claim mission-control，关闭 release；被顶替即关', () => {
    const { rerender, unmount } = renderOpen()

    expect(usePopoverStore.getState().active).toBe('mission-control')

    act(() => {
      usePopoverStore.getState().claim('search') // 被其他弹层顶替
    })
    expect(useMissionControlStore.getState().open).toBe(false)

    // 关闭路径（自身 close）release 单槽。
    rerender(<MissionControl />)
    act(() => {
      useMissionControlStore.getState().setOpen(true)
    })
    act(() => {
      useMissionControlStore.getState().close()
    })
    expect(usePopoverStore.getState().active).toBeNull()
    unmount()
  })

  it('backdrop（层根空白区）点击=关闭；点击卡片不关闭', () => {
    useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const { getByTestId } = renderOpen()
    const layer = getByTestId('mission-control-layer')

    fireEvent.click(getByTestId('mission-control-card'), { detail: 1 })
    expect(useMissionControlStore.getState().open).toBe(true)

    fireEvent.click(layer, { detail: 1 })
    expect(useMissionControlStore.getState().open).toBe(false)
  })

  it('关闭复位编辑态：编辑中 close → editingSpaceId 清空且层卸载', () => {
    const { getByTestId } = renderOpen()
    fireEvent.doubleClick(
      getByTestId('mission-control-spaces').querySelector(
        `[data-space-id="${DEFAULT_SPACE_ID}"]`,
      )!,
    )
    expect(getByTestId('mission-control-space-rename')).toBeTruthy()

    act(() => {
      useMissionControlStore.getState().close()
    })

    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
    expect(screen.queryByTestId('mission-control-layer')).toBeNull()
  })
})

// W11（审计 .tmp/spaces-audit.md §13 B）：「点击卡片切到别的窗口」修复钉扎。
// 根因调查结论（多层实证：jsdom 单测 ×tracking 开关 ×记忆窗在场、真实
// Chromium E2E 探针）：W3 space-focus 的 switched 恢复（restoreSpaceFocus）
// 在 activateCardWindow 的 switchSpace 内**同步先行**完成，卡片 focus 是同一
// 任务内最后一次聚焦写——「最终焦点=被点窗口」由调用序保证，无微任务竞态；
// 真正缺陷=激活函数信任**渲染期快照** `win.state`：快照 normal 而 live 已
// minimized 时走 focus()，引擎对 minimized **静默拒绝**——点击既不还原也不
// 聚焦（生产烟雾「点了没切过去/切到别的窗口」）。修复=分派读点击一刻的
// live 状态 + 关窗竞态零动作守卫。以下用例按「失败测试先行」协议落地：
// stale 快照用例在旧实现下失败（focus 被拒），其余为修复后两路钉扎。
describe('W11 卡片激活聚焦与关闭钮（审计 §13 B）', () => {
  it('同 Space 多窗：点卡片 X → X 聚焦（space-focus 生产态在场，微任务记忆写入不抢焦点）', async () => {
    startSpaceFocusTracking()
    const x = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const y = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    const { getByTestId } = renderOpen()
    const card = getByTestId('mission-control-cards').querySelector(
      `[data-window-id="${x}"]`,
    ) as HTMLElement

    fireEvent.click(card, { detail: 1 })
    await act(async () => {}) // 排空 space-focus 的 setActiveWindow 微任务

    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === x)?.focused).toBe(true)
    expect(windows.find((win) => win.id === y)?.focused).toBe(false)
  })

  it('跨 Space 点击卡片 X → 切 Space 且 X 聚焦（目标 Space 记忆窗在场也不被抢焦点）', async () => {
    startSpaceFocusTracking()
    const other = useSpaceStore.getState().createSpace('工作')
    const r = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.files', title: '文件', spaceId: other })
    const x = useWindowStore
      .getState()
      .open({ appId: 'com.ageha.notes', title: '记事', spaceId: other })
    // B 的记忆窗=R（卡片激活要切过去的 Space 里「记住」的是别的窗——竞态假设
    // 的覆盖现场）；active 保持 DEFAULT（卡片跨 Space 激活=防御分支真实路径）。
    act(() => {
      useSpaceStore.getState().setActiveWindow(other, r)
    })

    act(() => {
      activateCardWindow(useWindowStore.getState().windows.find((w) => w.id === x)!)
    })
    await act(async () => {})

    expect(useSpaceStore.getState().activeSpaceId).toBe(other)
    const windows = useWindowStore.getState().windows
    expect(windows.find((win) => win.id === x)?.focused).toBe(true)
    expect(windows.find((win) => win.id === r)?.focused).toBe(false)
  })

  it('stale 快照防御：快照 normal 而 live 已 minimized → 点击仍 restore+focus（旧实现 focus 被引擎静默拒绝）', () => {
    const x = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    // 渲染后、点击前窗被其他路径最小化（showDesktop/应用自最小化）：组件
    // 重渲染前的旧卡片快照（state:'normal'）被传进激活函数。
    useWindowStore.getState().minimize(x)

    act(() => {
      activateCardWindow({ id: x, spaceId: DEFAULT_SPACE_ID, state: 'normal' }) // stale 快照
    })

    const target = useWindowStore.getState().windows.find((win) => win.id === x)
    expect(target?.state).not.toBe('minimized') // restore
    expect(target?.focused).toBe(true) // + focus
  })

  it('关窗竞态：点击瞬间窗已关 → 零动作（不抛错、焦点不漂移）', () => {
    const x = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const y = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    useWindowStore.getState().close(x)

    act(() => {
      activateCardWindow({ id: x, spaceId: DEFAULT_SPACE_ID, state: 'normal' }) // 已关窗的旧卡
    })

    const windows = useWindowStore.getState().windows
    expect(windows.some((win) => win.id === x)).toBe(false)
    expect(windows.find((win) => win.id === y)?.focused).toBe(true) // 原焦点不动
  })

  it('卡片 ❌ 关闭钮：点击=close 该窗（卡随退场消失）、不触发卡片激活、MC 层不关', () => {
    const x = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    const y = useWindowStore.getState().open({ appId: 'com.ageha.files', title: '文件' })
    // 关 minimized 窗的卡最锐利：误触激活会 restore+focus（y 存活且聚焦），
    // 正确的 close 则窗口消失（ghost 在 WindowLayer 退场）。
    useWindowStore.getState().minimize(y)
    const { getByTestId } = renderOpen()
    const close = getByTestId('mission-control-cards').querySelector(
      `[data-testid="mission-control-card-close"][data-window-id="${y}"]`,
    ) as HTMLElement

    // onPointerDown stopPropagation：指针序列不进卡片激活/拖拽簿记。
    fireEvent.pointerDown(close, { button: 0, pointerId: 1 })
    fireEvent.click(close)

    const windows = useWindowStore.getState().windows
    expect(windows.some((win) => win.id === y)).toBe(false) // close 而非激活
    expect(windows.find((win) => win.id === x)?.focused).toBe(true) // close 的 focusTopmost 落 x
    expect(
      getByTestId('mission-control-cards').querySelector(`[data-window-id="${y}"]`),
    ).toBeNull() // 卡随窗口列表更新消失
    expect(useMissionControlStore.getState().open).toBe(true) // MC 层不关
  })
})
