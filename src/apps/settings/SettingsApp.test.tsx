import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { version } from '../../../package.json'
import type { User } from '@/core/auth/types'
import { useLocaleStore } from '@/core/i18n'
import { resetAppStore } from '@/store/app-store'
import { resetMotionPrefsStore } from '@/store/motion-prefs-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'
import { resetSessionStore, seedSessionForTests } from '@/store/session-store'

import { SettingsApp } from './SettingsApp'

beforeEach(() => {
  resetAppStore()
  resetMotionPrefsStore()
  resetSettingsStore()
  resetSessionStore()
  useLocaleStore.setState(useLocaleStore.getInitialState())
})

describe('SettingsApp', () => {
  it('renders the four sections in the sidebar', () => {
    render(<SettingsApp />)

    for (const name of ['外观', '语言', '权限', '关于']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
  })

  it('switches the theme via the appearance options', () => {
    render(<SettingsApp />)

    const lightButton = screen.getByRole('button', { name: '浅色' })
    fireEvent.click(lightButton)
    expect(lightButton).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    const darkButton = screen.getByRole('button', { name: '深色' })
    fireEvent.click(darkButton)
    expect(darkButton).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('exposes the five motion-lab toggles defaulting on (§32.5 修订 10)', () => {
    render(<SettingsApp />)

    const testIds = [
      'motion-glow-toggle',
      'motion-aurora-toggle',
      'motion-window-tilt-toggle',
      'motion-dock-sheen-toggle',
      'motion-theme-glow-toggle',
    ]
    for (const testId of testIds) {
      expect(screen.getByTestId(testId).getAttribute('aria-checked')).toBe('true')
    }

    // 关掉流光氛围 → 偏好落库（设备本地）。
    fireEvent.click(screen.getByTestId('motion-aurora-toggle'))
    expect(screen.getByTestId('motion-aurora-toggle').getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem('agehaos.motion.prefs.v1') ?? '{}')).toMatchObject({
      aurora: false,
    })
  })

  it('changes the font size', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: '大' }))

    expect(useSettingsStore.getState().fontSize).toBe('large')
    expect(document.documentElement.style.fontSize).toBe('18px')
  })

  it('switches the interface language', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /语言/ }))
    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByRole('region', { name: 'Language' })).toBeInTheDocument()
    expect(useLocaleStore.getState().locale).toBe('en')
  })

  it('lists installed apps with their granted permissions', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /权限/ }))

    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('使用本地存储')).toBeInTheDocument()
    expect(screen.getByText('读取文件、写入文件、使用本地存储')).toBeInTheDocument()
  })

  it('shows the about section with the version', () => {
    render(<SettingsApp />)

    fireEvent.click(screen.getByRole('button', { name: /关于/ }))

    expect(screen.getByText(new RegExp(version))).toBeInTheDocument()
  })

  it('shows the admin-only sections only for admin-role users (ADR 20/22)', () => {
    // 普通用户：无 远程目录 / 内容复审 入口。
    seedSessionForTests({
      id: 'u-2',
      username: 'plain',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
    } satisfies User)
    const { unmount } = render(<SettingsApp />)
    expect(screen.queryByRole('button', { name: '远程目录' })).toBeNull()
    expect(screen.queryByRole('button', { name: '内容复审' })).toBeNull()
    unmount()

    // admin 用户：两个管理分区出现，且复审分区可打开。
    seedSessionForTests({
      id: 'u-3',
      username: 'boss',
      createdAt: '2026-09-28T00:00:00.000Z',
      updatedAt: '2026-09-28T00:00:00.000Z',
      role: 'admin',
    } satisfies User)
    render(<SettingsApp />)
    fireEvent.click(screen.getByRole('button', { name: '内容复审' }))
    expect(screen.getByTestId('sample-review-section')).toBeInTheDocument()
  })
})
