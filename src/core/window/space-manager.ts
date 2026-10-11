import type { EventBus, SystemEventMap } from '@/core/events'

import {
  DEFAULT_SPACE_ID,
  MAX_SPACE_NAME_LENGTH,
  type PersistedSpaces,
  type Space,
} from './space-types'

export type SpaceEventBus = Pick<EventBus<SystemEventMap>, 'emit'>

const PERSISTED_VERSION = 1

/**
 * Ageha Spaces 领域引擎，与 WindowManager 同风格：框架无关类 + 构造注入
 * `Pick<EventBus,'emit'>` 与可注入 generateId（window-manager.ts:36-39 范式）。
 *
 * 职责边界（审计 .tmp/spaces-audit.md §2）：只管 Space 列表与 active 选择；
 * 窗口归属、过滤、快捷键均为 W2+ 的事。所有读取返回深拷贝（对齐
 * cloneWindow 范式 window-manager.ts:214-219）。
 */
export class SpaceManager {
  private spaces = new Map<string, Space>()
  private activeId = DEFAULT_SPACE_ID

  constructor(
    private bus: SpaceEventBus,
    private generateId: () => string = () => crypto.randomUUID(),
    /**
     * 「非空 Space 拒删」判定钩子：W1 阶段窗口尚无 spaceId，缺省恒真
     * （一切 Space 视为空）；W2 由 window-store 层以「该 Space 无窗口」
     * 真实计数构造注入——钩子自 W1 起就是真实判定路径，不留死代码
     * （计划 W1 Changes 2）。
     */
    private isEmpty: (spaceId: string) => boolean = () => true,
  ) {
    this.seedDefault()
  }

  /** 缺省名 "Desktop N"；显式传入空名（trim 后）同样回退缺省名（rename 级校验归 W7 UI）。 */
  createSpace(name?: string): Space {
    const now = Date.now()
    const trimmed = name !== undefined ? name.trim() : ''
    const space: Space = {
      id: this.generateId(),
      name: trimmed !== '' ? trimmed : `Desktop ${this.nextDefaultOrdinal()}`,
      index: this.spaces.size,
      createdAt: now,
      updatedAt: now,
    }
    this.spaces.set(space.id, space)
    this.bus.emit('space.created', { spaceId: space.id })
    return cloneSpace(space)
  }

  /**
   * 两级拒删，语义唯一（计划 W1 Changes 2）：①最后一个 Space 拒删；
   * ②非空 Space 拒删（isEmpty 注入谓词）。删除 active Space 时引擎把
   * active 重定向到原位次（越界取末位）——hydrate 校验要求 activeSpaceId
   * 恒指向存在项，active 不能悬空；重定向以 space.switched 广播。
   */
  deleteSpace(id: string): boolean {
    if (this.spaces.size <= 1) return false
    const target = this.spaces.get(id)
    if (!target) return false
    if (!this.isEmpty(id)) return false

    const previousIndex = target.index
    this.spaces.delete(id)
    this.reindex()
    this.bus.emit('space.deleted', { spaceId: id })

    if (this.activeId === id) {
      const remaining = this.listByIndex()
      const fromSpaceId = id
      this.activeId = remaining[Math.min(previousIndex, remaining.length - 1)]!.id
      this.bus.emit('space.switched', { spaceId: this.activeId, fromSpaceId })
    }
    return true
  }

  /** 非空、≤120 字符（对齐 MAX_TITLE_LENGTH，window-manager.ts:14）；违规拒绝不发事件。 */
  renameSpace(id: string, name: string): boolean {
    const target = this.spaces.get(id)
    if (!target) return false
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed === '' || trimmed.length > MAX_SPACE_NAME_LENGTH) return false
    target.name = trimmed
    target.updatedAt = Date.now()
    this.bus.emit('space.renamed', { spaceId: id, name: trimmed })
    return true
  }

  /**
   * 不存在的 id 与「切到当前 Space」都拒绝：与引擎既有 no-op 语义对齐
   * （window-manager minimize/maximize 重复调用返回 false），避免对
   * W3 过渡动效广播多余的 space.switched。
   */
  switchSpace(id: string): boolean {
    if (!this.spaces.has(id) || id === this.activeId) return false
    const fromSpaceId = this.activeId
    this.activeId = id
    this.bus.emit('space.switched', { spaceId: id, fromSpaceId })
    return true
  }

  /**
   * 越界钳制后重排，并把所有 index 重写为 0..n-1（计划 W1 Changes 2）。
   * 钳制后位次不变视为 no-op 拒绝（同 switchSpace 口径）；toIndex 载荷
   * 携带钳制后的真实新位次。
   */
  reorderSpaces(id: string, toIndex: number): boolean {
    const target = this.spaces.get(id)
    if (!target) return false
    const clamped = Math.min(Math.max(Math.trunc(toIndex), 0), this.spaces.size - 1)
    if (clamped === target.index) return false
    const fromIndex = target.index

    const ordered = this.listByIndex().filter((space) => space.id !== id)
    ordered.splice(clamped, 0, target)
    ordered.forEach((space, index) => {
      space.index = index
    })
    target.updatedAt = Date.now()
    this.bus.emit('space.reordered', { spaceId: id, fromIndex, toIndex: clamped })
    return true
  }

  getActiveSpace(): Space {
    return cloneSpace(this.spaces.get(this.activeId)!)
  }

  /** 全部 Space，按 index 升序，深拷贝。 */
  getSpaces(): Space[] {
    return this.listByIndex().map(cloneSpace)
  }

  get activeSpaceId(): string {
    return this.activeId
  }

  snapshot(): PersistedSpaces {
    return {
      version: PERSISTED_VERSION,
      spaces: this.getSpaces(),
      activeSpaceId: this.activeId,
    }
  }

  /**
   * 持久化恢复：version 与结构双重校验（spaces 非空数组、activeSpaceId
   * 指向存在项、id 不重复），任一不过整体回落引导态并返回 false
   * （审计 §2「损坏回落引导态」）。恢复是加载行为不是用户 mutation，
   * 不广播任何事件。
   */
  hydrate(data: unknown): boolean {
    const parsed = parsePersistedSpaces(data)
    if (!parsed) {
      this.seedDefault()
      return false
    }
    this.spaces = new Map(parsed.spaces.map((space) => [space.id, space]))
    this.activeId = parsed.activeSpaceId
    this.reindex()
    return true
  }

  /** 引导：恰好一个默认 Space（id=DEFAULT_SPACE_ID，name="Desktop 1"）且为 active。 */
  private seedDefault(): void {
    const now = Date.now()
    this.spaces = new Map([
      [
        DEFAULT_SPACE_ID,
        { id: DEFAULT_SPACE_ID, name: 'Desktop 1', index: 0, createdAt: now, updatedAt: now },
      ],
    ])
    this.activeId = DEFAULT_SPACE_ID
  }

  /** 缺省名的最小未占用序号：以现有名字 `Desktop N` 占用为准，改名/删位后不撞名。 */
  private nextDefaultOrdinal(): number {
    const taken = new Set(
      [...this.spaces.values()]
        .map((space) => /^Desktop (\d+)$/.exec(space.name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1])),
    )
    let ordinal = 1
    while (taken.has(ordinal)) ordinal += 1
    return ordinal
  }

  private listByIndex(): Space[] {
    return [...this.spaces.values()].sort((a, b) => a.index - b.index)
  }

  /** 重写所有 index 为 0..n-1（插入/删除/恢复后的不变量）。 */
  private reindex(): void {
    this.listByIndex().forEach((space, index) => {
      space.index = index
    })
  }
}

function cloneSpace(space: Space): Space {
  return { ...space }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 结构校验；通过则归一化（按 index 升序）返回，否则 null。 */
function parsePersistedSpaces(data: unknown): Pick<PersistedSpaces, 'spaces' | 'activeSpaceId'> | null {
  if (!isPlainObject(data)) return null
  if (data.version !== PERSISTED_VERSION) return null
  if (!Array.isArray(data.spaces) || data.spaces.length === 0) return null
  if (typeof data.activeSpaceId !== 'string') return null

  const spaces: Space[] = []
  const ids = new Set<string>()
  for (const entry of data.spaces) {
    const space = parseSpace(entry)
    if (!space || ids.has(space.id)) return null
    ids.add(space.id)
    spaces.push(space)
  }
  if (!ids.has(data.activeSpaceId)) return null

  spaces.sort((a, b) => a.index - b.index)
  return { spaces, activeSpaceId: data.activeSpaceId }
}

function parseSpace(value: unknown): Space | null {
  if (!isPlainObject(value)) return null
  const { id, name, index, createdAt, updatedAt } = value
  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string') return null
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  return { id, name, index, createdAt, updatedAt }
}
