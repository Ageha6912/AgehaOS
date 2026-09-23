import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { version } from '../../../package.json'
import { useLocaleStore } from '@/core/i18n'
import { resetAppStore } from '@/store/app-store'
import { resetSettingsStore, useSettingsStore } from '@/store/settings-store'

import { SettingsApp } from './SettingsApp'

beforeEach(() => {
  resetAppStore()
  resetSettingsStore()
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
})
