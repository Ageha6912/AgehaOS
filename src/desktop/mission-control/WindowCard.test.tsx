import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WindowCard, WindowDragGhost, type CardWindow } from './WindowCard'

/**
 * Mission Control 轻量窗口卡片（W7，审计 .tmp/spaces-audit.md §10；W11 增补
 * ❌ 关闭钮，审计 §13 B①）钉扎：卡面=AppIcon+标题+CSS 拟态窗脸，**禁渲染应用
 * 内容**（无 iframe/canvas/img 等 mount 点）；minimized 标记；点击/pointer 透
 * 传；拖拽中原卡 pointer-events-none + 半透明留位（跟手视觉移交根层拖拽影
 * WindowDragGhost）；关闭钮=兄弟节点绝对定位右上角、stopPropagation 防激活/
 * 拖拽、点击只上报 onClose。
 */

const cardWindow = (overrides: Partial<CardWindow> = {}): CardWindow => ({
  id: 'win-1',
  appId: 'com.ageha.notes',
  title: '记事',
  state: 'normal',
  spaceId: 'space-default',
  ...overrides,
})

const renderCard = ({
  win = cardWindow(),
  dragging = false,
  onPointerDown = vi.fn(),
  onActivate = vi.fn(),
  onClose = vi.fn(),
} = {}) =>
  render(
    <WindowCard
      win={win}
      dragging={dragging}
      onPointerDown={onPointerDown}
      onActivate={onActivate}
      onClose={onClose}
    />,
  )

describe('WindowCard（W7 审计 §10 决定 3）', () => {
  it('卡面渲染 AppIcon + 标题 + 拟态窗脸（纯装饰 aria-hidden）', () => {
    renderCard()

    const card = screen.getByTestId('mission-control-card')
    expect(card).toHaveAttribute('aria-label', '记事')
    expect(screen.getByText('记事')).toBeTruthy()
    // 拟态窗脸：三枚窗控点（红黄绿 token 圆点）存在。
    expect(card.querySelectorAll('[aria-hidden="true"] span[class*="bg-wl-"]')).toHaveLength(3)
  })

  it('卡内零应用内容挂载点：无 iframe/canvas/img/object/embed（禁 clone/禁截图）', () => {
    const { container } = renderCard()

    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('object')).toBeNull()
    expect(container.querySelector('embed')).toBeNull()
  })

  it('minimized 卡带 data-minimized 标记且窗脸降透明度', () => {
    renderCard({ win: cardWindow({ state: 'minimized' }) })

    expect(screen.getByTestId('mission-control-card')).toHaveAttribute('data-minimized', 'true')
  })

  it('点击上报 onActivate(win)；pointerdown 透传容器；非拖拽卡可命中', () => {
    const onActivate = vi.fn()
    const onPointerDown = vi.fn()
    renderCard({ onActivate, onPointerDown })

    const card = screen.getByTestId('mission-control-card')
    // 非拖拽态：pointer-events-auto（卡片可命中、可点击激活）。
    expect(card.className).toContain('pointer-events-auto')
    expect(card.className).not.toContain('pointer-events-none')

    fireEvent.click(card, { detail: 1 })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith(cardWindow())

    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    expect(onPointerDown).toHaveBeenCalledTimes(1)
  })

  it('拖拽中：data-dragging + pointer-events-none + 半透明留位（零内联 transform，跟手移交拖拽影）', () => {
    renderCard({ dragging: true })

    const card = screen.getByTestId('mission-control-card')
    expect(card).toHaveAttribute('data-dragging', 'true')
    // W7 复核修复：拖拽中原卡 pointer-events-none——elementFromPoint 穿过它
    // 命中下方 Space 胶囊（drop 结束由容器恢复 auto）。
    expect(card.className).toContain('pointer-events-none')
    expect(card.className).not.toContain('pointer-events-auto')
    // 半透明留位提示。
    expect(card.className).toContain('opacity-40')
    // 跟手视觉已移交根层拖拽影：原卡零位移、零布局写入（transform-only 归影）。
    expect(card.style.transform).toBe('')
    expect(card.style.left).toBe('')
    expect(card.style.top).toBe('')
  })
})

// W11 ❌ 关闭钮（审计 §13 B①）：兄弟节点绝对定位右上角（button 禁嵌套），
// stopPropagation 防指针序列进卡片激活/拖拽，点击只上报 onClose。
describe('WindowCard ❌ 关闭钮（W11 审计 §13 B①）', () => {
  it('渲染 h-6 w-6 级小钮于右上角（aria-label 走 window.close 词典键）', () => {
    renderCard()

    const close = screen.getByTestId('mission-control-card-close')
    expect(close).toHaveAttribute('aria-label', '关闭窗口')
    expect(close.className).toContain('h-6')
    expect(close.className).toContain('w-6')
    // 弱化常态：与拟态窗脸协调的 muted 前景 + surface-soft 底。
    expect(close.className).toContain('text-text-muted')
    expect(close.className).toContain('bg-surface-soft')
  })

  it('点击只上报 onClose(win)：不触发卡片 onActivate/onPointerDown', () => {
    const onActivate = vi.fn()
    const onPointerDown = vi.fn()
    const onClose = vi.fn()
    renderCard({ onActivate, onPointerDown, onClose })
    const close = screen.getByTestId('mission-control-card-close')

    fireEvent.pointerDown(close, { button: 0, pointerId: 1 })
    fireEvent.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(cardWindow())
    expect(onActivate).not.toHaveBeenCalled()
    expect(onPointerDown).not.toHaveBeenCalled()
  })

  it('关闭钮自身可命中（pointer-events-auto）；拖拽中一并 pointer-events-none', () => {
    const { rerender } = renderCard()
    expect(screen.getByTestId('mission-control-card-close').className).toContain(
      'pointer-events-auto',
    )

    rerender(
      <WindowCard
        win={cardWindow()}
        dragging
        onPointerDown={vi.fn()}
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('mission-control-card-close').className).toContain(
      'pointer-events-none',
    )
  })

  it('定位容器不截获指针（继承卡片区 pointer-events-none，保拖拽命中语义）', () => {
    const { container } = renderCard()

    const wrapper = container.firstElementChild as HTMLElement
    // W7 复核修复的命中语义依赖：容器不设 pointer-events-auto——拖拽中
    // elementFromPoint 要穿过原卡直达下方 Space 胶囊。
    expect(wrapper.className).not.toContain('pointer-events-auto')
    expect(wrapper.className).toContain('relative')
  })
})

describe('WindowDragGhost（W7 复核修复：根层拖拽影）', () => {
  it('影面=AppIcon+标题+拟态窗脸（与卡面同款），只读 aria-hidden', () => {
    render(<WindowDragGhost win={cardWindow()} />)

    const ghost = screen.getByTestId('mission-control-drag-ghost')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.textContent).toContain('记事')
    expect(ghost.querySelectorAll('[aria-hidden="true"] span[class*="bg-wl-"]')).toHaveLength(3)
  })

  it('pointer-events-none 且无可交互元素（无关闭钮）：elementFromPoint 穿过影命中落点', () => {
    render(<WindowDragGhost win={cardWindow()} />)

    const ghost = screen.getByTestId('mission-control-drag-ghost')
    expect(ghost.className).toContain('pointer-events-none')
    // 无 button/input 等命中面——影不截获任何指针交互（❌ 关闭钮只在实体卡）。
    expect(ghost.querySelector('button, input, a')).toBeNull()
  })
})
