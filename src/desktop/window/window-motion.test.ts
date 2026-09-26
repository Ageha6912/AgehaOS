import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearInlinePose,
  prefersReducedMotion,
  startClose,
  startMinimizeFlight,
  startOpen,
  startRestoreFlight,
  supportsWAAPI,
  taskbarAnchor,
} from './window-motion'

/** 可控的 WAAPI 替身：finished 手动 resolve，reverse/cancel 可断言。 */
function fakeAnimation() {
  let resolveFinished: (() => void) | null = null
  const anim = {
    finished: new Promise<void>((resolve) => {
      resolveFinished = resolve
    }),
    reverse: vi.fn(),
    cancel: vi.fn(),
  }
  return { anim: anim as unknown as Animation, resolve: () => resolveFinished?.() }
}

function installAnimate(): ReturnType<typeof vi.fn> {
  const animate = vi.fn(() => fakeAnimation().anim)
  ;(Element.prototype as unknown as { animate?: unknown }).animate = animate
  return animate
}

afterEach(() => {
  delete (Element.prototype as unknown as { animate?: unknown }).animate
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('环境探测', () => {
  it('reports WAAPI availability', () => {
    const el = document.createElement('div')
    expect(supportsWAAPI(el)).toBe(false) // jsdom 默认无 animate
    installAnimate()
    expect(supportsWAAPI(el)).toBe(true)
  })

  it('reads prefers-reduced-motion live', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    expect(prefersReducedMotion()).toBe(true)
  })
})

describe('taskbarAnchor（任务栏锚点）', () => {
  it('uses the window taskbar button center, clamped above the bottom edge', () => {
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'taskbar-item-w-1')
    document.body.appendChild(button)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 700,
      width: 44,
      height: 36,
      right: 244,
      bottom: 736,
      x: 200,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect)
    window.innerHeight = 720
    // 中心 y = 718 高于下缘留防线 708 → 被钳制（藏于底缘外的任务栏收进屏内）
    expect(taskbarAnchor('w-1')).toEqual({ x: 222, y: 708 })
  })

  it('falls back to bottom-center when the button is absent (zero-size rects in jsdom)', () => {
    window.innerHeight = 720
    window.innerWidth = 1280
    expect(taskbarAnchor('missing')).toEqual({ x: 640, y: 708 })
  })
})

describe('播放函数（WAAPI 就绪时）', () => {
  it('plays open from scale 0.9 with the origin projected toward the anchor', () => {
    const animate = installAnimate()
    const el = document.createElement('section')

    const anim = startOpen(el, { x: 222, y: 708 })

    expect(anim).not.toBeNull()
    expect(el.style.transformOrigin).toBe('150.0% 140.0%') // jsdom 零矩形 → 限幅收敛
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'scale(0.9)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'both' },
    )
  })

  it('plays close into scale 0.92 with the ease-in leg', () => {
    const animate = installAnimate()
    const el = document.createElement('section')

    startClose(el, { x: 222, y: 708 })

    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(0.92)', opacity: 0 },
      ],
      { duration: 120, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'both' },
    )
  })

  it('minimize flight back-presses the hidden class, then flies to the dock pose', () => {
    const animate = installAnimate()
    const el = document.createElement('section')
    el.className = 'hidden' // 模拟 React 提交 minimized 后的类名

    const anim = startMinimizeFlight(el, { x: 222, y: 708 })

    expect(anim).not.toBeNull()
    expect(el.style.display).toBe('flex') // 反压 hidden 类，飞行期保持可见
    const [frames, options] = animate.mock.calls[0] as unknown as [
      { transform: string; opacity: number }[],
      { duration: number; fill: string },
    ]
    expect(frames).toHaveLength(3)
    expect(frames[2].transform).toContain('scale(0.08, 0.04)')
    expect(options.duration).toBe(300)
    expect(options.fill).toBe('both')
  })

  it('restore flight measures clean geometry, mounts the dock pose and plays in reverse', () => {
    const animate = installAnimate()
    const el = document.createElement('section')
    const anim = startRestoreFlight(el, { x: 222, y: 708 })

    expect(el.style.transform).toContain('scale(0.08, 0.04)')
    expect(el.style.opacity).toBe('0')
    expect(anim).not.toBeNull()
    expect(anim?.reverse).toHaveBeenCalledTimes(1)
    const [frames] = animate.mock.calls[0] as unknown as [{ transform: string }[]]
    expect(frames[0].transform).toBe('translate(0px, 0px) scale(1, 1)')
  })

  it('returns null instead of animating when WAAPI is missing (caller settles instantly)', () => {
    const el = document.createElement('section')
    expect(startOpen(el, { x: 0, y: 0 })).toBeNull()
    expect(startClose(el, { x: 0, y: 0 })).toBeNull()
    expect(startMinimizeFlight(el, { x: 0, y: 0 })).toBeNull()
    expect(startRestoreFlight(el, { x: 0, y: 0 })).toBeNull()
    expect(el.style.display).toBe('') // 未污染内联样式
  })
})

describe('clearInlinePose（位姿清空）', () => {
  it('clears exactly the four motion-owned inline properties', () => {
    const el = document.createElement('section')
    el.style.transform = 'translateX(10px)'
    el.style.opacity = '0'
    el.style.transformOrigin = '50% 140%'
    el.style.display = 'flex'
    el.style.left = '12px' // React 管理的定位属性不得被清

    clearInlinePose(el)

    expect(el.style.transform).toBe('')
    expect(el.style.opacity).toBe('')
    expect(el.style.transformOrigin).toBe('')
    expect(el.style.display).toBe('')
    expect(el.style.left).toBe('12px')
  })
})
