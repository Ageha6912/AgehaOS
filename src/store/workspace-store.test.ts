import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_WORKSPACE,
  reloadWorkspaceStore,
  resetWorkspaceStore,
  useWorkspaceStore,
  WORKSPACE_IDS,
} from './workspace-store'

const STORAGE_KEY = 'agehaos.workspace.v1'

beforeEach(() => {
  localStorage.clear()
  resetWorkspaceStore()
})

describe('workspace-store（工作空间偏好持久化）', () => {
  it('defaults to personal', () => {
    expect(useWorkspaceStore.getState().workspace).toBe('personal')
    expect(DEFAULT_WORKSPACE).toBe('personal')
    expect(WORKSPACE_IDS).toEqual(['personal', 'study', 'dev', 'creative'])
  })

  it('setWorkspace updates state and persists to localStorage', () => {
    useWorkspaceStore.getState().setWorkspace('study')

    expect(useWorkspaceStore.getState().workspace).toBe('study')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toBe('study')
  })

  it('reloadWorkspaceStore re-reads the persisted value (刷新后保持)', () => {
    useWorkspaceStore.getState().setWorkspace('dev')

    // 模拟新页面加载：内存态先归位再重读持久化数据。
    useWorkspaceStore.setState({ workspace: 'personal' })
    reloadWorkspaceStore()

    expect(useWorkspaceStore.getState().workspace).toBe('dev')
  })

  it('falls back to the default on corrupt or invalid persisted data', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(reloadWorkspaceStore(), 'corrupt json').toBe(undefined)
    expect(useWorkspaceStore.getState().workspace).toBe('personal')

    localStorage.setItem(STORAGE_KEY, JSON.stringify('hoge'))
    reloadWorkspaceStore()
    expect(useWorkspaceStore.getState().workspace).toBe('personal')
  })

  it('resetWorkspaceStore wipes persistence and state', () => {
    useWorkspaceStore.getState().setWorkspace('creative')
    resetWorkspaceStore()

    expect(useWorkspaceStore.getState().workspace).toBe('personal')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
