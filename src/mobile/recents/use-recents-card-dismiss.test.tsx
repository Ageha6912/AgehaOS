import { act, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRecentsCardDismiss } from './use-recents-card-dismiss'

/**
 * M3-2 最近任务卡片手势 hook 契约（判定阈值归 recents-card-decision.test，
 * 轴向裁决归 swipe-up-decision.test）：非跟手档（motion-prefs 关档/reduced）
 * 释放即判；跟手档拖动中 transform 直写（rAF 采样，零 render），确认飞出/
 * 取消回弹在 jsdom（无 WAAPI）降级为瞬时终态；横向归轨道原生横滚
 * （reject）；click 抑制只发生在「轴向激活」的轮次。
 *
 * 时序口径：合成 pointer 事件共用同一 performance.now——「快甩」用例直接
 * 靠事件即时时序（起点参与速度窗，速度恒超阈值）；「慢拖」用例用 fake
 * timers 推 performance（150ms 速度窗老化 → 平均速度兜底档 < 0.5px/ms）。
 */

function renderCard(overrides?: {
  onDismiss?: () => void
  followMotion?: boolean
  onClick?: () => void
}): { dismiss: ReturnType<typeof vi.fn>; click: ReturnType<typeof vi.fn> } {
  const dismiss = vi.fn()
  const click = vi.fn()
  function Probe() {
    useRecentsCardDismiss({
      targetRef: cardRef,
      onDismiss: overrides?.onDismiss ?? dismiss,
      followMotion: overrides?.followMotion ?? false,
    })
    return (
      <button type="button" data-testid="card" ref={cardRef} onClick={overrides?.onClick ?? click}>
        card
      </button>
    )
  }
  render(<Probe />)
  return { dismiss, click }
}

const cardRef: { current: HTMLButtonElement | null } = { current: null }

beforeEach(() => {
  cardRef.current = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRecentsCardDismiss', () => {
  function pointer(type: string, x: number, y: number, pointerType = 'touch', pointerId = 1): void {
    act(() => {
      screen.getByTestId('card').dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType,
          clientX: x,
          clientY: y,
        }),
      )
    })
  }

  it('非跟手档：上滑过距离档（64px）→ onDismiss 恰一次，click 被吞，transform 还原', () => {
    const { dismiss, click } = renderCard()

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 100, 260)
    pointer('pointerup', 100, 220)
    fireEvent.click(screen.getByTestId('card'))

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()
    expect(cardRef.current?.style.transform).toBe('')
  })

  it('非跟手档：慢拖不足距离、释放沉速 → 不确认（回弹语义：样式还原、零回调）', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const { dismiss } = renderCard()

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 100, 280)
    act(() => {
      // 推 200ms：起始样本老化出 150ms 速度窗 → 释放速度走平均兜底
      // （50px / 200ms = 0.25 < 0.5）。
      vi.advanceTimersByTime(200)
    })
    pointer('pointerup', 100, 250)

    expect(dismiss).not.toHaveBeenCalled()
    expect(cardRef.current?.style.transform).toBe('')
  })

  it('非跟手档：单跳快甩（距离不足）→ 速度档确认', () => {
    // fake performance 保证合成时序确定：60px / 30ms = 2px/ms ≥ 0.5。
    vi.useFakeTimers({ toFake: ['performance'] })
    const { dismiss } = renderCard()

    pointer('pointerdown', 100, 300)
    act(() => {
      vi.advanceTimersByTime(30)
    })
    // 单跳 60px（<64）：起点参与速度窗（无 move 事件，起点即最老样本）。
    pointer('pointerup', 100, 240)

    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('横向为主：reject——零回调零样式（横向归卡片轨道原生横滚）', () => {
    const { dismiss } = renderCard()

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 140, 300)
    pointer('pointerup', 200, 300)

    expect(dismiss).not.toHaveBeenCalled()
    expect(cardRef.current?.style.transform).toBe('')
  })

  it('点按（死区内释放）：零回调，click 放行（切回路径不受手势影响）', () => {
    const { dismiss, click } = renderCard()

    pointer('pointerdown', 100, 300)
    pointer('pointerup', 100, 300)
    fireEvent.click(screen.getByTestId('card'))

    expect(dismiss).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('pointercancel：静默复位零回调', () => {
    const { dismiss } = renderCard()

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 100, 240)
    pointer('pointercancel', 100, 200)
    pointer('pointerup', 100, 200)

    expect(dismiss).not.toHaveBeenCalled()
    expect(cardRef.current?.style.transform).toBe('')
  })

  it('鼠标指针不激活', () => {
    const { dismiss } = renderCard()

    pointer('pointerdown', 100, 300, 'mouse')
    pointer('pointerup', 100, 100, 'mouse')

    expect(dismiss).not.toHaveBeenCalled()
  })

  it('跟手档：拖动中 transform 直写（rAF 采样，零 render 跟手）', async () => {
    renderCard({ followMotion: true })
    const card = screen.getByTestId('card')

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 100, 240)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(card.style.transform).toBe('translate3d(0, -60px, 0)')

    // 释放：距离 60 < 64，速度窗口内末次 move 即当前位置（位移差 0）→
    // 取消回弹（jsdom 无 WAAPI → 瞬时还原）。
    pointer('pointerup', 100, 240)
    expect(card.style.transform).toBe('')
  })

  it('跟手档：确认飞出在 jsdom（无 WAAPI）降级为立即 onDismiss', async () => {
    const { dismiss } = renderCard({ followMotion: true })

    pointer('pointerdown', 100, 300)
    pointer('pointermove', 100, 220)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    pointer('pointerup', 100, 220)

    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(cardRef.current?.style.transform).toBe('')
  })
})
