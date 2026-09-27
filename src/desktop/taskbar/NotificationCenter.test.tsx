import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetNotificationStore, useNotificationStore } from '@/store/notification-store'
import type { NotificationInput } from '@/store/notification-store'

import { NotificationToasts } from '@/desktop/NotificationToasts'

import { NotificationCenter } from './NotificationCenter'

function pushSample(overrides: Partial<NotificationInput> = {}): string {
  return useNotificationStore.getState().push({
    appId: 'system',
    titleKey: 'notification.title.appCrashed',
    ...overrides,
  })
}

beforeEach(() => {
  resetNotificationStore()
})

describe('NotificationCenter (PRD §16.2)', () => {
  it('shows an empty panel without a badge when there are no notifications', () => {
    render(<NotificationCenter />)

    expect(screen.getByTestId('notification-bell')).toBeInTheDocument()
    expect(screen.queryByTestId('notification-badge')).toBeNull()

    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    expect(screen.getByText('暂无通知')).toBeInTheDocument()
  })

  it('lists history with unread badge and parameterized body', () => {
    pushSample({ bodyKey: 'notification.body.appCrashed', bodyParams: { app: '记事' } })
    render(<NotificationCenter />)

    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(screen.getAllByTestId('notification-item')).toHaveLength(1)
    expect(screen.getByText('应用出现问题')).toBeInTheDocument()
    expect(screen.getByText('「记事」已停止响应，系统其余部分不受影响。')).toBeInTheDocument()
  })

  it('fades the list bottom only while content extends below the fold', () => {
    pushSample()
    render(<NotificationCenter />)

    fireEvent.click(screen.getByTestId('notification-bell'))
    const list = screen.getByTestId('notification-list')
    expect(list.className).toContain('scroll-thin')
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()

    // jsdom 无布局：伪造溢出后派发 scroll。
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true })
    Object.defineProperty(list, 'scrollHeight', { value: 800, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true })
    fireEvent.scroll(list)
    expect(screen.getByTestId('scroll-fade')).toBeInTheDocument()

    Object.defineProperty(list, 'scrollTop', { value: 500, configurable: true })
    fireEvent.scroll(list)
    expect(screen.queryByTestId('scroll-fade')).not.toBeInTheDocument()
  })

  it('marks read (badge clears), deletes single items and clears all', () => {
    pushSample()
    pushSample({ titleKey: 'notification.title.wallpaperFailed' })
    render(<NotificationCenter />)

    fireEvent.click(screen.getByTestId('notification-bell'))
    // 单条已读（两条都未读 → 取第一条）
    const firstMark = screen.getAllByRole('button', { name: '标记已读' })[0]
    const firstItemId = useNotificationStore.getState().items[0]?.id
    fireEvent.click(firstMark)
    expect(useNotificationStore.getState().items.find((item) => item.id === firstItemId)?.read).toBe(true)
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1')

    // 全部已读
    fireEvent.click(screen.getByTestId('notification-mark-all'))
    expect(useNotificationStore.getState().items.every((item) => item.read)).toBe(true)
    expect(screen.queryByTestId('notification-badge')).toBeNull()

    // 单条删除
    fireEvent.click(screen.getAllByRole('button', { name: '删除通知' })[0])
    expect(useNotificationStore.getState().items).toHaveLength(1)

    // 清空
    fireEvent.click(screen.getByTestId('notification-clear'))
    expect(useNotificationStore.getState().items).toHaveLength(0)
    expect(screen.getByText('暂无通知')).toBeInTheDocument()
  })

  it('keeps the history capped at the store limit', () => {
    for (let index = 0; index < 35; index += 1) {
      pushSample()
    }
    render(<NotificationCenter />)
    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(screen.getAllByTestId('notification-item')).toHaveLength(30)
  })
})

describe('NotificationToasts（PRD §16.1，DESIGN.md §14 三段节奏）', () => {
  function setupToasts() {
    return render(<NotificationToasts />)
  }

  it('auto-dismisses a toast after its TTL through the exit phase', async () => {
    const { act } = await import('@testing-library/react')
    vi.useFakeTimers()
    try {
      pushSample()
      setupToasts()
      expect(screen.getByTestId('notification-toast')).toBeInTheDocument()

      // 驻留 4.5s 到点 → 进入 120ms 滑出相位 → 卸载
      act(() => {
        vi.advanceTimersByTime(4500)
      })
      expect(screen.getByTestId('notification-toast')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByTestId('notification-toast')).toBeNull()
      // 自动消失不改已读状态（历史仍在，等用户去中心查看）。
      expect(useNotificationStore.getState().items).toHaveLength(1)
      expect(useNotificationStore.getState().items[0]?.read).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses the dwell while hovered and resumes on leave', async () => {
    const { act } = await import('@testing-library/react')
    vi.useFakeTimers()
    try {
      pushSample()
      setupToasts()
      const toast = screen.getByTestId('notification-toast')

      // 3.5s 后悬停：剩余 1s 被暂停
      act(() => {
        vi.advanceTimersByTime(3500)
        fireEvent.pointerEnter(toast)
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(screen.getByTestId('notification-toast')).toBeInTheDocument()

      // 离开 → 续走剩余 1s → 滑出相位 → 卸载
      act(() => {
        fireEvent.pointerLeave(toast)
        vi.advanceTimersByTime(1000 + 200)
      })
      expect(screen.queryByTestId('notification-toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps at most 3 toasts stacked and retires the newest-first', async () => {
    const { act } = await import('@testing-library/react')
    vi.useFakeTimers()
    try {
      pushSample({ titleKey: 'notification.title.wallpaperFailed' })
      pushSample({ titleKey: 'notification.title.appCrashed' })
      pushSample({ titleKey: 'notification.title.wallpaperFailed' })
      pushSample({ titleKey: 'notification.title.appCrashed' })
      setupToasts()

      // 最新 3 条可见，第 4 条排队等位
      expect(screen.getAllByTestId('notification-toast')).toHaveLength(3)

      act(() => {
        vi.advanceTimersByTime(4500 + 200)
      })
      // 首批 3 条驻留到期滑出，排队的第 4 条补位开始自己的驻留
      expect(screen.getAllByTestId('notification-toast')).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(4500 + 200)
      })
      expect(screen.queryByTestId('notification-toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the notification read when clicked and exits after the slide-out', async () => {
    const { act } = await import('@testing-library/react')
    vi.useFakeTimers()
    try {
      pushSample()
      setupToasts()

      fireEvent.click(screen.getByRole('button', { name: '应用出现问题' }))
      expect(useNotificationStore.getState().items[0]?.read).toBe(true)

      // 点击后先播 120ms 滑出再卸载
      expect(screen.getByTestId('notification-toast')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByTestId('notification-toast')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
