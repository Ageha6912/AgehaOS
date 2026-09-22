import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PermissionConsentDialog } from './permission-consent-dialog'

const PERMISSIONS = ['storage', 'filesystem.read', 'network'] as const

describe('PermissionConsentDialog', () => {
  it('lists every requested permission as a checked checkbox', () => {
    render(
      <PermissionConsentDialog
        appName="Notes"
        permissions={PERMISSIONS}
        onAllow={vi.fn()}
        onDeny={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '应用权限申请' })).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    for (const label of ['使用本地存储', '读取文件', '访问网络']) {
      const checkbox = screen.getByRole('checkbox', { name: label })
      expect(checkbox).toBeChecked()
    }
  })

  it('grants only the permissions left checked', () => {
    const onAllow = vi.fn()
    render(
      <PermissionConsentDialog
        appName="Notes"
        permissions={PERMISSIONS}
        onAllow={onAllow}
        onDeny={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '访问网络' }))
    fireEvent.click(screen.getByRole('button', { name: '允许并安装' }))

    expect(onAllow).toHaveBeenCalledWith(['storage', 'filesystem.read'])
  })

  it('disables the allow button when every permission is unchecked', () => {
    const onAllow = vi.fn()
    render(
      <PermissionConsentDialog
        appName="Notes"
        permissions={PERMISSIONS}
        onAllow={onAllow}
        onDeny={vi.fn()}
      />,
    )

    for (const label of ['使用本地存储', '读取文件', '访问网络']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }

    expect(screen.getByRole('button', { name: '允许并安装' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '允许并安装' }))
    expect(onAllow).not.toHaveBeenCalled()
  })

  it('reports denial via onDeny', () => {
    const onDeny = vi.fn()
    render(
      <PermissionConsentDialog
        appName="Notes"
        permissions={PERMISSIONS}
        onAllow={vi.fn()}
        onDeny={onDeny}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))

    expect(onDeny).toHaveBeenCalledTimes(1)
  })
})
