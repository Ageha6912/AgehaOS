import { render, screen } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

import { resetSpaceStore } from '@/store/space-store'
import type { WindowInstance } from '@/core/window/types'

import { WindowPreview } from './WindowPreview'

/**
 * Dock 悬停预览的 Space 过滤（W9，审计 .tmp/spaces-audit.md §12 决定 3）：
 * 主预览只展示当前 Space 窗口——他 Space 窗零渲染（组件级守卫；调用方
 * Taskbar 亦只对当前 Space 窗挂悬停，双保险）。
 */

const baseWindow = (overrides: Partial<WindowInstance>): WindowInstance => ({
  id: 'win-1',
  appId: 'com.ageha.notes',
  title: '记事',
  x: 100,
  y: 80,
  width: 720,
  height: 480,
  zIndex: 1,
  state: 'normal',
  focused: false,
  resizable: true,
  closable: true,
  minWidth: 320,
  minHeight: 200,
  restoreBounds: null,
  snapMode: null,
  restoreState: 'normal',
  spaceId: 'space-default',
  ...overrides,
})

const noop = (): void => {}

beforeEach(() => {
  resetSpaceStore()
})

describe('WindowPreview Space 过滤（W9）', () => {
  it('当前 Space 窗口：渲染预览（标题+关闭钮在位）', () => {
    render(
      <WindowPreview
        win={baseWindow({ spaceId: 'space-default' })}
        anchorLeft={0}
        onSwitch={noop}
        onClose={noop}
      />,
    )

    expect(screen.getByTestId('window-preview')).toBeInTheDocument()
    expect(screen.getByTestId('window-preview').textContent).toContain('记事')
    expect(screen.getByTestId('preview-close')).toBeInTheDocument()
  })

  it('其他 Space 窗口：零渲染（返回 null，无 window-preview 节点）', () => {
    const { container } = render(
      <WindowPreview
        win={baseWindow({ id: 'win-elsewhere', spaceId: 'space-other' })}
        anchorLeft={0}
        onSwitch={noop}
        onClose={noop}
      />,
    )

    expect(screen.queryByTestId('window-preview')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})
