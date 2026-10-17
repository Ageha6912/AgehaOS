import { beforeEach, describe, expect, it, vi } from 'vitest'

import { systemSounds } from '@/services/sounds'

import { resetMissionControlStore, useMissionControlStore } from './mission-control-store'

/**
 * Mission Control store（W7，审计 .tmp/spaces-audit.md §10）钉扎：开关范式、
 * 关闭复位编辑态（无悬挂编辑）、setEditing、reset 测试隔离出口。
 */

beforeEach(() => {
  resetMissionControlStore()
})

describe('mission-control-store（W7 审计 §10）', () => {
  it('初始关闭且无编辑态', () => {
    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('setOpen(true) 开启；setOpen(false) 关闭并复位编辑态', () => {
    useMissionControlStore.getState().setOpen(true)
    useMissionControlStore.getState().setEditing('space-a')
    expect(useMissionControlStore.getState().open).toBe(true)

    useMissionControlStore.getState().setOpen(false)

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('空间开合提示音：开=mission-in、关=mission-out、重复关无声', () => {
    const play = vi.spyOn(systemSounds, 'play').mockImplementation(() => undefined)
    const store = useMissionControlStore.getState()
    store.setOpen(true)
    expect(play).toHaveBeenCalledWith('mission-in')
    store.close()
    expect(play).toHaveBeenCalledWith('mission-out')

    play.mockClear()
    store.close()
    store.setOpen(false)
    expect(play).not.toHaveBeenCalled()
  })

  it('toggle 在开/关间翻转；关闭复位编辑态', () => {
    useMissionControlStore.getState().toggle()
    expect(useMissionControlStore.getState().open).toBe(true)

    useMissionControlStore.getState().setEditing('space-b')
    useMissionControlStore.getState().toggle()

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('close 显式关闭并复位编辑态（重复关闭幂等）', () => {
    useMissionControlStore.getState().setOpen(true)
    useMissionControlStore.getState().setEditing('space-c')

    useMissionControlStore.getState().close()
    useMissionControlStore.getState().close()

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })

  it('setEditing 设置与清除编辑目标；开启态下不受影响', () => {
    useMissionControlStore.getState().setOpen(true)
    useMissionControlStore.getState().setEditing('space-d')
    expect(useMissionControlStore.getState().editingSpaceId).toBe('space-d')
    expect(useMissionControlStore.getState().open).toBe(true)

    useMissionControlStore.getState().setEditing(null)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
    expect(useMissionControlStore.getState().open).toBe(true)
  })

  it('reset 恢复初始态（测试隔离出口）', () => {
    useMissionControlStore.getState().setOpen(true)
    useMissionControlStore.getState().setEditing('space-e')

    resetMissionControlStore()

    expect(useMissionControlStore.getState().open).toBe(false)
    expect(useMissionControlStore.getState().editingSpaceId).toBeNull()
  })
})
