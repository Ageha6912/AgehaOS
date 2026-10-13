import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountShortcutRegistry, registerShortcut, resetShortcutRegistry } from './registry'

/**
 * 中央 shortcut registry（W3，审计 .tmp/spaces-audit.md §6）钉扎：有序、
 * 首个命中停止、when 守卫、capture 阶段冒泡前生效。
 */

beforeEach(() => {
  resetShortcutRegistry()
})

afterEach(() => {
  resetShortcutRegistry()
})

function press(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init })
}

describe('shortcut registry', () => {
  it('按注册顺序分发，首个命中条目执行后停止（后续条目不参与）', () => {
    mountShortcutRegistry()
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    registerShortcut({ id: 'a', test: (event) => event.key === 'x', run: first })
    registerShortcut({ id: 'b', test: (event) => event.key === 'x', run: second })
    registerShortcut({ id: 'c', test: () => true, run: third })

    press('x')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()
  })

  it('未命中的条目被跳过，命中位置之后的条目照常参与', () => {
    mountShortcutRegistry()
    const missed = vi.fn()
    const hit = vi.fn()
    registerShortcut({ id: 'a', test: (event) => event.key === 'a', run: missed })
    registerShortcut({ id: 'b', test: (event) => event.key === 'b', run: hit })

    press('b')

    expect(missed).not.toHaveBeenCalled()
    expect(hit).toHaveBeenCalledTimes(1)
  })

  it('when 守卫实时求值：false 跳过该条继续下一条，true 放行并停止', () => {
    mountShortcutRegistry()
    const guarded = vi.fn()
    const fallback = vi.fn()
    let open = false
    registerShortcut({
      id: 'a',
      when: () => open,
      test: (event) => event.key === 'x',
      run: guarded,
    })
    registerShortcut({ id: 'b', test: (event) => event.key === 'x', run: fallback })

    press('x')
    expect(guarded).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)

    fallback.mockClear()
    open = true
    press('x')
    expect(guarded).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('capture 阶段生效：先于 target/bubble 监听器（shell 级快捷键语义）', () => {
    mountShortcutRegistry()
    const order: string[] = []
    registerShortcut({
      id: 'a',
      test: (event) => event.key === 'Enter',
      run: (event) => {
        event.preventDefault()
        order.push('registry')
      },
    })
    const onBodyBubble = (): void => {
      order.push('bubble')
    }
    document.body.addEventListener('keydown', onBodyBubble)

    fireEvent.keyDown(document.body, { key: 'Enter' })

    document.body.removeEventListener('keydown', onBodyBubble)
    expect(order).toEqual(['registry', 'bubble'])
  })

  it('registerShortcut 返回配对注销函数，注销后不再参与分发', () => {
    mountShortcutRegistry()
    const run = vi.fn()
    const off = registerShortcut({ id: 'a', test: () => true, run: run })

    off()
    press('x')

    expect(run).not.toHaveBeenCalled()
  })

  it('mount 幂等：重复挂载返回 no-op detach，首个 detach 才真正摘除', () => {
    const run = vi.fn()
    registerShortcut({ id: 'a', test: () => true, run: run })
    const detachFirst = mountShortcutRegistry()
    const detachSecond = mountShortcutRegistry()

    detachSecond()
    press('x')
    expect(run).toHaveBeenCalledTimes(1) // handler 仍在场

    detachFirst()
    press('x')
    expect(run).toHaveBeenCalledTimes(1) // 已摘除，不再分发
  })

  it('preventDefault 由条目自理（registry 不代按）', () => {
    mountShortcutRegistry()
    const seen: KeyboardEvent[] = []
    registerShortcut({
      id: 'a',
      test: (event) => event.key === 'x',
      run: (event) => {
        event.preventDefault()
        seen.push(event)
      },
    })

    press('x')

    expect(seen).toHaveLength(1)
    expect(seen[0]?.defaultPrevented).toBe(true)
  })
})
