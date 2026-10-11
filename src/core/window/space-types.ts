/**
 * Ageha Spaces 数据模型（Window Management 2.0 W1，审计 .tmp/spaces-audit.md §2）。
 * 本文件只承载 Space 领域类型与持久化 schema——窗口归属（spaceId 进
 * WindowInstance）是 W2 的事，此处不得提前。
 */

/** 单个 Space：纯数据，无窗口语义（W2 起窗口经 spaceId 归属）。 */
export interface Space {
  id: string
  name: string
  /** 列表位次，引擎恒定维护为 0..n-1（reorderSpaces 重写）。 */
  index: number
  createdAt: number
  updatedAt: number
}

/**
 * 引导 Space 的固定 id：不依赖 generateId——重启引导必须幂等，且持久化
 * id 漂移会让 W2 的窗口归属悬空（计划 W1 Risks）。
 */
export const DEFAULT_SPACE_ID = 'space-default'

/** Space 命名上限：对齐 WindowManager.MAX_TITLE_LENGTH（120，window-manager.ts:14）。 */
export const MAX_SPACE_NAME_LENGTH = 120

/** Space 持久化 schema（space-store 手写 localStorage `agehaos.spaces.v1` 共用）。 */
export interface PersistedSpaces {
  version: 1
  /** 按 index 升序。 */
  spaces: Space[]
  /** 必须指向 spaces 中的某一项（校验失败的持久化数据整体回落引导态）。 */
  activeSpaceId: string
}
