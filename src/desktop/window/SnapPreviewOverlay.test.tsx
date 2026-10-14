import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetSnapPreview, setSnapPreview } from './snap-preview'
import { SnapPreviewOverlay } from './SnapPreviewOverlay'

const RECT = { x: 80, y: 32, width: 472, height: 736 }

beforeEach(() => {
  resetSnapPreview()
})

afterEach(() => {
  resetSnapPreview()
})

describe('SnapPreviewOverlay（W5，审计 .tmp/spaces-audit.md §8）', () => {
  it('rect=null 返回 null：零 DOM 零重排', () => {
    const { container } = render(<SnapPreviewOverlay />)
    expect(container.firstElementChild).toBeNull()
  })

  it('rect 命中：内联几何=rect（工作区带坐标，与窗口同坐标系）', () => {
    setSnapPreview(RECT)
    render(<SnapPreviewOverlay />)
    const overlay = screen.getByTestId('snap-preview') as HTMLElement
    expect(overlay.style.left).toBe(`${RECT.x}px`)
    expect(overlay.style.top).toBe(`${RECT.y}px`)
    expect(overlay.style.width).toBe(`${RECT.width}px`)
    expect(overlay.style.height).toBe(`${RECT.height}px`)
  })

  it('rect 更新：内联几何跟随（calculateSnapGeometry 产物单源直落）', () => {
    setSnapPreview(RECT)
    const { container } = render(<SnapPreviewOverlay />)
    const overlay = container.firstElementChild as HTMLElement
    act(() => {
      setSnapPreview({ x: 532, y: 32, width: 472, height: 736 })
    })
    expect(overlay.style.left).toBe('532px')
  })

  it('层内最低 z + aria-hidden：不进可达树、不与引擎窗争层', () => {
    setSnapPreview(RECT)
    render(<SnapPreviewOverlay />)
    const overlay = screen.getByTestId('snap-preview')
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    expect((overlay as HTMLElement).style.zIndex).toBe('0')
  })

  it('pointer-events-none 在场、断言不出现 pointer-events-auto（继承容器不吃指针）', () => {
    setSnapPreview(RECT)
    render(<SnapPreviewOverlay />)
    const overlay = screen.getByTestId('snap-preview')
    expect(overlay.className).toContain('pointer-events-none')
    expect(overlay.className).not.toContain('pointer-events-auto')
  })

  it('视觉全走既有 token：border-subtle + bg-scrim + glass-hint + 窗口档圆角（禁新 hex/高饱和蓝）', () => {
    setSnapPreview(RECT)
    render(<SnapPreviewOverlay />)
    const overlay = screen.getByTestId('snap-preview')
    expect(overlay.className).toContain('border-border-subtle')
    expect(overlay.className).toContain('bg-scrim')
    expect(overlay.className).toContain('glass-hint')
    expect(overlay.className).toContain('rounded-[var(--sp-window-radius)]')
    // 过渡 ≤200ms：120ms fast 档（--ag-motion-fast），reduced-motion 直切由
    // index.css 全局塌缩承接。
    expect(overlay.className).toContain('transition-[left,top,width,height]')
    expect(overlay.className).toContain('[transition-duration:var(--ag-motion-fast)]')
  })
})
