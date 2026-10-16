import { DEFAULT_SPACE_ID, type Space } from '@/core/window'
import type { WorkspaceId } from '@/store/workspace-store'

/**
 * Workspace↔Space 四档映射纯逻辑（Window Management 2.0 W8，审计
 * .tmp/spaces-audit.md §11）：四档 Workspace（personal/study/dev/creative，
 * `WORKSPACE_IDS` workspace-store.ts:14）↔ Space 为 1:1 Primary 绑定。本模块
 * 只做「输入（W 档 id、bindings、Space 列表、activeSpaceId）→ 输出指令」的
 * 映射，不知道 store 与 React——执行序列由注入的 actions 完成，可直接用
 * fakes 单测。跨域引用只有 `WorkspaceId` 类型 import 复用（审计 §11 唯一
 * 允许方向）；workspace-store 本体零改动（红线）。
 *
 * 规则（审计 §11 + 评审建议 7）：
 * - 绑定存在且 Space 活着 → 直切（已活跃则 no-op）；
 * - 无绑定或绑定指向死 id → 播种回落：createSpace（默认名沿用 "Desktop N"
 *   序号体系，用户数据不做本地化）→ bind → switch；
 * - personal 档特例：DEFAULT_SPACE_ID 仍活着时首点**收养**它（只 bind+switch，
 *   不新播）——落实「默认 Personal / Desktop 1」，无重复 "Desktop 1"；
 *   默认 Space 被删后（deleteSpace 已清 binding）同样走播种回落。
 */

/** 点击某 W 档后要执行的指令序列（审计 §11「输出指令」）。 */
export type SpaceBindingPlan =
  | { readonly kind: 'none' }
  /** 直切到既有存活 Space。 */
  | { readonly kind: 'switch'; readonly spaceId: string }
  /** 收养既有 Space：bind + switch，不 createSpace（personal→DEFAULT_SPACE_ID）。 */
  | { readonly kind: 'adopt'; readonly spaceId: string }
  /** 播种回落：createSpace → bind → switch（三步序列）。 */
  | { readonly kind: 'seed' }

/** 映射所需的全部真相（调用方从 space-store 快照拼装，本模块不读 store）。 */
export interface SpaceBindingInput {
  readonly workspace: WorkspaceId
  /** 当前四档绑定表（含可能指向死 id 的悬空项——死 id 由存活判定过滤）。 */
  readonly bindings: Readonly<Partial<Record<WorkspaceId, string>>>
  /** 存活 Space 列表（只需 id）。 */
  readonly spaces: ReadonlyArray<Pick<Space, 'id'>>
  readonly activeSpaceId: string
}

export function planWorkspaceSpaceBinding(input: SpaceBindingInput): SpaceBindingPlan {
  const bound = input.bindings[input.workspace]
  const alive = bound !== undefined && input.spaces.some((space) => space.id === bound)
  if (alive && bound !== undefined) {
    // 直切；绑定 Space 已是活跃 Space 时 no-op（与引擎 switchSpace 重复
    // 调用拒绝语义对齐，避免多余指令）。
    return bound === input.activeSpaceId ? { kind: 'none' } : { kind: 'switch', spaceId: bound }
  }
  // personal 首点（或绑定被清后）：默认 Space 活着 → 收养不新播。
  if (
    input.workspace === 'personal' &&
    input.spaces.some((space) => space.id === DEFAULT_SPACE_ID)
  ) {
    return { kind: 'adopt', spaceId: DEFAULT_SPACE_ID }
  }
  // 无绑定/死绑定且无默认 Space 可收养 → 播种回落（评审建议 7）。
  return { kind: 'seed' }
}

/** 计划执行所需的最小 store 面（由 useSpaceStore.getState() 拼装或测试 fakes 注入）。 */
export interface SpaceBindingActions {
  readonly createSpace: () => string
  readonly bindWorkspace: (workspace: WorkspaceId, spaceId: string) => void
  readonly switchSpace: (spaceId: string) => void
}

/** 按计划执行指令序列；seed 的三步顺序固定 createSpace→bind→switch。 */
export function applySpaceBindingPlan(
  plan: SpaceBindingPlan,
  workspace: WorkspaceId,
  actions: SpaceBindingActions,
): void {
  switch (plan.kind) {
    case 'none':
      return
    case 'switch':
      actions.switchSpace(plan.spaceId)
      return
    case 'adopt':
      actions.bindWorkspace(workspace, plan.spaceId)
      actions.switchSpace(plan.spaceId)
      return
    case 'seed': {
      const spaceId = actions.createSpace()
      actions.bindWorkspace(workspace, spaceId)
      actions.switchSpace(spaceId)
      return
    }
  }
}
