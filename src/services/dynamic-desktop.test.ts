import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildFieldPlan } from '@/core/dynamic/generative/templates'
import { resetDynamicDesktopStore, useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { resetSettingsStore } from '@/store/settings-store'

import { systemDynamicDesktop } from './dynamic-desktop'

/**
 * 动态桌面生成编排（B3 审查）：随机度固定档（0）必须短路整条生成链——
 * 旧实现会跑决策器拿到已退役的 landscape/shanshui-dawn，且无视 blockedStyles。
 */

const CURRENT_PLAN = buildFieldPlan({
  seed: 'fixed-plan',
  fieldId: 'dawn-white',
  zone: 'converge',
  reason: { signals: ['theme:light'], palette: 'dawn-white', motif: 'gradient-field' },
})

beforeEach(() => {
  localStorage.clear()
  resetDynamicDesktopStore()
  resetSettingsStore()
})

function prefsWith(overrides: Partial<ReturnType<typeof useDynamicDesktopStore.getState>['prefs']>) {
  return { ...useDynamicDesktopStore.getState().prefs, enabled: true, ...overrides }
}

describe('systemDynamicDesktop.refresh × 随机度固定档', () => {
  it('randomness=0 不产生新结果：保留当前计划与生成序号（B3 审查）', async () => {
    useDynamicDesktopStore.setState({
      prefs: prefsWith({ randomness: 0 }),
      currentPlan: CURRENT_PLAN,
      generationOrdinal: 3,
      lastGenerateAt: 0,
    })

    await act(async () => {
      await systemDynamicDesktop.refresh()
    })

    const after = useDynamicDesktopStore.getState()
    expect(after.currentPlan).toEqual(CURRENT_PLAN)
    expect(after.generationOrdinal).toBe(3)
  })

  it('固定档以上仍正常生成（管道未被误短路）', async () => {
    useDynamicDesktopStore.setState({
      prefs: prefsWith({ randomness: 40 }),
      currentPlan: null,
      generationOrdinal: 0,
      lastGenerateAt: 0,
    })

    await act(async () => {
      await systemDynamicDesktop.refresh()
    })

    const after = useDynamicDesktopStore.getState()
    expect(after.currentPlan).not.toBeNull()
    expect(after.generationOrdinal).toBeGreaterThan(0)
  })
})
