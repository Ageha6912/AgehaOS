import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetWindowStore, useWindowStore } from '@/store/window-store'

import { DesktopBranding } from './DesktopBranding'

beforeEach(() => {
  resetWindowStore()
})

describe('DesktopBranding（DESIGN.md §31 Round 2 中央品牌层）', () => {
  it('shows on the idle desktop and stays invisible to a11y tree and pointers', () => {
    render(<DesktopBranding />)

    const branding = screen.getByTestId('desktop-branding')
    // Shell 2.0 视觉更轻：空闲态 opacity-90（v3 修订 ②：改三元分支值本身，
    // 禁止类链追加同组工具类被覆盖）。
    expect(branding.className).toContain('opacity-90')
    expect(branding.className).not.toContain('opacity-100')
    // 纯装饰：辅助树隐形 + 指针穿透（右键空白等桌面契约不受影响）。
    expect(branding.getAttribute('aria-hidden')).toBe('true')
    expect(branding.className).toContain('pointer-events-none')
    expect(branding.textContent).toContain('AgehaOS')
    expect(branding.textContent).toContain('Your Web OS, Your Space.')
  })

  it('wears the cool-violet wordmark gradient (shell 2.0 裁决 C: no pink residue)', () => {
    render(<DesktopBranding />)

    // 「OS」渐变尾色 = #c4b5fd 冷紫（Tailwind violet-300）；粉色残留禁止回潮。
    const osSpan = screen.getByTestId('desktop-branding').querySelector('p > span + span') as HTMLElement
    expect(osSpan.className).toContain('bg-gradient-to-r')
    expect(osSpan.classList.contains('to-[#c4b5fd]')).toBe(true)
    expect(osSpan.className).not.toContain('to-[#f4bde4]')
  })

  it('fades out while a window is visible and returns when everything is minimized', () => {
    const { rerender } = render(<DesktopBranding />)

    const id = useWindowStore.getState().open({ appId: 'com.ageha.notes', title: '记事' })
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-0')

    useWindowStore.getState().minimize(id)
    rerender(<DesktopBranding />)
    expect(screen.getByTestId('desktop-branding').className).toContain('opacity-90')
  })
})
