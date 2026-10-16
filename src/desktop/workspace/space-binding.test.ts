import { describe, expect, it } from 'vitest'

import { DEFAULT_SPACE_ID } from '@/core/window'
import type { WorkspaceId } from '@/store/workspace-store'

import {
  applySpaceBindingPlan,
  planWorkspaceSpaceBinding,
  type SpaceBindingActions,
  type SpaceBindingInput,
} from './space-binding'

/**
 * W8 映射纯逻辑单测（审计 .tmp/spaces-audit.md §11 最低清单：四档首点播种 /
 * 再点直切 / personal 首点绑 DEFAULT_SPACE_ID / 默认 Space 被删后播种回落）。
 * planner/executor 均不读 store——store 真相用输入快照、执行用 fakes 注入。
 */

function input(overrides: Partial<SpaceBindingInput> = {}): SpaceBindingInput {
  return {
    workspace: 'study',
    bindings: {},
    spaces: [{ id: DEFAULT_SPACE_ID }],
    activeSpaceId: DEFAULT_SPACE_ID,
    ...overrides,
  }
}

function fakeActions(): { actions: SpaceBindingActions; calls: string[] } {
  const calls: string[] = []
  let next = 0
  return {
    calls,
    actions: {
      createSpace: () => {
        const id = `space-new-${++next}`
        calls.push(`create:${id}`)
        return id
      },
      bindWorkspace: (workspace, spaceId) => calls.push(`bind:${workspace}:${spaceId}`),
      switchSpace: (spaceId) => calls.push(`switch:${spaceId}`),
    },
  }
}

describe('planWorkspaceSpaceBinding（W8 映射规则，审计 §11 + 评审建议 7）', () => {
  it('非 personal 四档首点（无绑定、默认 Space 活着）→ 播种回落', () => {
    for (const workspace of ['study', 'dev', 'creative'] as const) {
      expect(planWorkspaceSpaceBinding(input({ workspace }))).toEqual({ kind: 'seed' })
    }
  })

  it('personal 首点：DEFAULT_SPACE_ID 活着 → 收养它，不新播（无重复 "Desktop 1"）', () => {
    expect(planWorkspaceSpaceBinding(input({ workspace: 'personal' }))).toEqual({
      kind: 'adopt',
      spaceId: DEFAULT_SPACE_ID,
    })
  })

  it('绑定存活 → 直切；绑定 Space 已是活跃 Space → no-op', () => {
    const bound = input({
      workspace: 'dev',
      bindings: { dev: 'space-b' },
      spaces: [{ id: DEFAULT_SPACE_ID }, { id: 'space-b' }],
      activeSpaceId: DEFAULT_SPACE_ID,
    })
    expect(planWorkspaceSpaceBinding(bound)).toEqual({ kind: 'switch', spaceId: 'space-b' })
    expect(planWorkspaceSpaceBinding({ ...bound, activeSpaceId: 'space-b' })).toEqual({ kind: 'none' })
  })

  it('绑定指向死 id → 播种回落（评审建议 7 的悬空绑定分支）', () => {
    const dead = input({
      workspace: 'study',
      bindings: { study: 'space-ghost' },
      spaces: [{ id: DEFAULT_SPACE_ID }],
    })
    expect(planWorkspaceSpaceBinding(dead)).toEqual({ kind: 'seed' })
  })

  it('默认 Space 被删后 personal 播种回落（binding 已被 deleteSpace 清空）', () => {
    const deleted = input({
      workspace: 'personal',
      bindings: {},
      spaces: [{ id: 'space-b' }],
      activeSpaceId: 'space-b',
    })
    expect(planWorkspaceSpaceBinding(deleted)).toEqual({ kind: 'seed' })
    // 绑定仍悬空指向死 id 时同样回落（清空与否不影响判活结果）。
    expect(
      planWorkspaceSpaceBinding({ ...deleted, bindings: { personal: 'space-ghost' } }),
    ).toEqual({ kind: 'seed' })
  })
})

describe('applySpaceBindingPlan（指令序列，审计 §11「输出指令」）', () => {
  it('seed 固定三步：createSpace → bindWorkspace → switchSpace（新 id 贯穿）', () => {
    const { actions, calls } = fakeActions()
    applySpaceBindingPlan({ kind: 'seed' }, 'creative', actions)
    expect(calls).toEqual(['create:space-new-1', 'bind:creative:space-new-1', 'switch:space-new-1'])
  })

  it('adopt 只两步 bind + switch（不 create）；switch 只切；none 零调用', () => {
    const adopt = fakeActions()
    applySpaceBindingPlan({ kind: 'adopt', spaceId: DEFAULT_SPACE_ID }, 'personal', adopt.actions)
    expect(adopt.calls).toEqual([`bind:personal:${DEFAULT_SPACE_ID}`, `switch:${DEFAULT_SPACE_ID}`])

    const sw = fakeActions()
    applySpaceBindingPlan({ kind: 'switch', spaceId: 'space-b' }, 'study', sw.actions)
    expect(sw.calls).toEqual(['switch:space-b'])

    const none = fakeActions()
    applySpaceBindingPlan({ kind: 'none' }, 'study' as WorkspaceId, none.actions)
    expect(none.calls).toEqual([])
  })
})
