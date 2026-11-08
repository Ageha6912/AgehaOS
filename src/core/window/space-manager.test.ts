import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'

import { SpaceManager } from './space-manager'
import { DEFAULT_SPACE_ID, MAX_SPACE_NAME_LENGTH, type Space } from './space-types'

/** 引导 Space 的固定形态（审计 §2：id 固定不依赖 generateId，重启幂等）。 */
const BOOT: Space = {
  id: DEFAULT_SPACE_ID,
  name: 'Desktop 1',
  index: 0,
  createdAt: 1000,
  updatedAt: 1000,
  activeWindowId: null,
}

function createManager(events?: (keyof SystemEventMap)[], isEmpty?: (spaceId: string) => boolean) {
  const bus = new EventBus<SystemEventMap>()
  const seen: string[] = []
  if (events) {
    for (const name of events) {
      bus.on(name, () => seen.push(name))
    }
  }
  let counter = 0
  const manager = new SpaceManager(bus, () => `space-${++counter}`, isEmpty)
  return { manager, bus, seen }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SpaceManager 引导态', () => {
  it('无持久化数据时恰好一个默认 Space（Desktop 1）且为 active', () => {
    const { manager } = createManager()

    expect(manager.getSpaces()).toEqual([BOOT])
    expect(manager.activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(manager.getActiveSpace()).toEqual(BOOT)
  })
})

describe('SpaceManager.createSpace', () => {
  it('缺省名取最小未占用序号', () => {
    const { manager } = createManager()

    const second = manager.createSpace()
    const third = manager.createSpace()

    expect(second.name).toBe('Desktop 2')
    expect(third.name).toBe('Desktop 3')
  })

  it('改名腾出的序号会被后续缺省名复用，已有自定义名不撞车', () => {
    const { manager } = createManager()

    const second = manager.createSpace()
    manager.renameSpace(second.id, '工作')
    const reused = manager.createSpace()

    expect(reused.name).toBe('Desktop 2')
  })

  it('自定义名通过，显式空名回退缺省名，index 顺延', () => {
    const { manager } = createManager()

    const named = manager.createSpace('  工作  ')
    expect(named.name).toBe('工作')
    expect(named.index).toBe(1)

    const blank = manager.createSpace('   ')
    expect(blank.name).toBe('Desktop 2')
    expect(blank.index).toBe(2)
  })

  it('成功时发 space.created，返回深拷贝', () => {
    const { manager, seen } = createManager(['space.created'])

    const space = manager.createSpace('工作')
    space.name = 'mutated'

    expect(seen).toEqual(['space.created'])
    expect(manager.getSpaces()[1]?.name).toBe('工作')
  })
})

describe('SpaceManager.deleteSpace', () => {
  it('最后一个 Space 拒删（缺省谓词下仍拒）：返回 false、Space 仍在、不发事件', () => {
    const { manager, seen } = createManager(['space.deleted'])

    expect(manager.deleteSpace(DEFAULT_SPACE_ID)).toBe(false)
    expect(manager.getSpaces()).toEqual([BOOT])
    expect(seen).toEqual([])
  })

  it('非空 Space 拒删（注入 isEmpty 恒假谓词）：返回 false、Space 仍在、不发 space.deleted', () => {
    const { manager, seen } = createManager(['space.deleted'], () => false)

    const second = manager.createSpace('工作')

    expect(manager.deleteSpace(second.id)).toBe(false)
    expect(manager.getSpaces()).toHaveLength(2)
    expect(seen).toEqual([])
  })

  it('删除非 active Space 成功：移除、剩余 index 重写为 0..n-1、发 space.deleted', () => {
    const { manager, seen } = createManager(['space.deleted'])

    const second = manager.createSpace('工作')
    const third = manager.createSpace('休闲')
    seen.length = 0

    expect(manager.deleteSpace(second.id)).toBe(true)

    expect(manager.getSpaces().map((s) => s.id)).toEqual([DEFAULT_SPACE_ID, third.id])
    expect(manager.getSpaces().map((s) => s.index)).toEqual([0, 1])
    expect(seen).toEqual(['space.deleted'])
    expect(seen).not.toContain('space.switched')
  })

  it('删除 active Space 成功：active 重定向到原位次并连带发 space.deleted + space.switched', () => {
    const { manager, seen } = createManager(['space.deleted', 'space.switched'])

    const second = manager.createSpace('工作')
    manager.switchSpace(second.id)
    seen.length = 0

    expect(manager.deleteSpace(second.id)).toBe(true)

    expect(manager.activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(seen).toEqual(['space.deleted', 'space.switched'])
  })

  it('删除 active Space（非末位）时 active 重定向到原位次上的 Space', () => {
    const { manager } = createManager()

    const second = manager.createSpace('工作')
    const third = manager.createSpace('休闲')
    manager.switchSpace(second.id)

    expect(manager.deleteSpace(second.id)).toBe(true)
    expect(manager.activeSpaceId).toBe(third.id)
  })

  it('未知 id 返回 false 不发事件', () => {
    const { manager, seen } = createManager(['space.deleted'])

    expect(manager.deleteSpace('missing')).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('SpaceManager.renameSpace', () => {
  it('成功改名：trim、updatedAt 前进、发 space.renamed（携带 trim 后名字）', () => {
    const { manager, seen } = createManager(['space.renamed'])

    vi.setSystemTime(2000)

    expect(manager.renameSpace(DEFAULT_SPACE_ID, '  工作  ')).toBe(true)

    const renamed = manager.getSpaces()[0]!
    expect(renamed.name).toBe('工作')
    expect(renamed.updatedAt).toBe(2000)
    expect(renamed.createdAt).toBe(1000)
    expect(seen).toEqual(['space.renamed'])
  })

  it('拒绝空名、超长名与未知 id，且不发事件', () => {
    const { manager, seen } = createManager(['space.renamed'])

    expect(manager.renameSpace(DEFAULT_SPACE_ID, '   ')).toBe(false)
    expect(manager.renameSpace(DEFAULT_SPACE_ID, 'x'.repeat(MAX_SPACE_NAME_LENGTH + 1))).toBe(false)
    expect(manager.renameSpace('missing', '任意')).toBe(false)

    expect(manager.getSpaces()[0]?.name).toBe('Desktop 1')
    expect(seen).toEqual([])
  })

  it('恰好 120 字符允许', () => {
    const { manager } = createManager()

    expect(manager.renameSpace(DEFAULT_SPACE_ID, 'x'.repeat(MAX_SPACE_NAME_LENGTH))).toBe(true)
    expect(manager.getSpaces()[0]?.name).toBe('x'.repeat(MAX_SPACE_NAME_LENGTH))
  })
})

describe('SpaceManager.switchSpace', () => {
  it('成功切换：activeSpaceId 更新、发 space.switched（fromSpaceId=原 active）', () => {
    const { manager, seen } = createManager(['space.switched'])

    const second = manager.createSpace('工作')
    seen.length = 0

    expect(manager.switchSpace(second.id)).toBe(true)

    expect(manager.activeSpaceId).toBe(second.id)
    expect(manager.getActiveSpace().id).toBe(second.id)
    expect(seen).toEqual(['space.switched'])
  })

  it('切到当前 active Space 是 no-op：返回 false 不发事件', () => {
    const { manager, seen } = createManager(['space.switched'])

    expect(manager.switchSpace(DEFAULT_SPACE_ID)).toBe(false)
    expect(seen).toEqual([])
  })

  it('未知 id 返回 false 不发事件', () => {
    const { manager, seen } = createManager(['space.switched'])

    expect(manager.switchSpace('missing')).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('SpaceManager.reorderSpaces', () => {
  it('重排成功：被移 Space 从 0 到 2、全部 index 重写为 0..n-1、发 space.reordered', () => {
    const { manager, seen } = createManager(['space.reordered'])

    const second = manager.createSpace('工作')
    const third = manager.createSpace('休闲')
    seen.length = 0

    expect(manager.reorderSpaces(DEFAULT_SPACE_ID, 2)).toBe(true)

    expect(manager.getSpaces().map((s) => s.id)).toEqual([second.id, third.id, DEFAULT_SPACE_ID])
    expect(manager.getSpaces().map((s) => s.index)).toEqual([0, 1, 2])
    expect(seen).toEqual(['space.reordered'])
  })

  it('事件载荷携带真实位次 fromIndex/toIndex，越界钳制（99→末位、-1→首位）', () => {
    const { manager, bus } = createManager()
    const payloads: unknown[] = []
    bus.on('space.reordered', (payload) => payloads.push(payload))

    manager.createSpace('工作')
    manager.createSpace('休闲')

    expect(manager.reorderSpaces(DEFAULT_SPACE_ID, 99)).toBe(true)
    expect(payloads).toEqual([{ spaceId: DEFAULT_SPACE_ID, fromIndex: 0, toIndex: 2 }])

    payloads.length = 0
    expect(manager.reorderSpaces(DEFAULT_SPACE_ID, -1)).toBe(true)
    expect(payloads).toEqual([{ spaceId: DEFAULT_SPACE_ID, fromIndex: 2, toIndex: 0 }])
  })

  it('原位重排是 no-op 返回 false 不发事件；未知 id 同样拒绝', () => {
    const { manager, seen } = createManager(['space.reordered'])

    manager.createSpace('工作')
    seen.length = 0

    expect(manager.reorderSpaces(DEFAULT_SPACE_ID, 0)).toBe(false)
    expect(manager.reorderSpaces('missing', 1)).toBe(false)
    expect(seen).toEqual([])
  })
})

describe('SpaceManager 深拷贝边界', () => {
  it('改 getSpaces/getActiveSpace 返回值不影响内部状态', () => {
    const { manager } = createManager()

    const snapshot = manager.getSpaces()
    snapshot[0]!.name = 'mutated'
    snapshot[0]!.index = 99

    const active = manager.getActiveSpace()
    active.name = 'mutated-active'

    expect(manager.getSpaces()).toEqual([BOOT])
    expect(manager.getActiveSpace()).toEqual(BOOT)
  })

  it('改 snapshot 返回值不影响内部状态', () => {
    const { manager } = createManager()

    const snap = manager.snapshot()
    snap.spaces[0]!.name = 'mutated'
    snap.activeSpaceId = 'hijacked'

    expect(manager.getSpaces()).toEqual([BOOT])
    expect(manager.activeSpaceId).toBe(DEFAULT_SPACE_ID)
  })
})

describe('SpaceManager.setActiveWindow（W3，审计 .tmp/spaces-audit.md §6）', () => {
  it('成功记忆 activeWindowId：getSpaces/snapshot 可见；成功不广播任何事件（焦点真相已有 window.focused）', () => {
    const { manager, seen } = createManager([
      'space.created',
      'space.deleted',
      'space.switched',
      'space.renamed',
      'space.reordered',
    ])

    const second = manager.createSpace('工作')
    seen.length = 0

    expect(manager.setActiveWindow(second.id, 'win-7')).toBe(true)

    expect(manager.getSpaces().find((space) => space.id === second.id)?.activeWindowId).toBe(
      'win-7',
    )
    expect(manager.snapshot().spaces.find((space) => space.id === second.id)?.activeWindowId).toBe(
      'win-7',
    )
    expect(seen).toEqual([])
  })

  it('置 null 清除记忆；updatedAt 不动（非用户可见元数据变更）', () => {
    const { manager } = createManager()

    manager.setActiveWindow(DEFAULT_SPACE_ID, 'win-1')
    const updatedAt = manager.getSpaces()[0]!.updatedAt
    expect(manager.setActiveWindow(DEFAULT_SPACE_ID, null)).toBe(true)

    expect(manager.getSpaces()[0]?.activeWindowId).toBeNull()
    expect(manager.getSpaces()[0]?.updatedAt).toBe(updatedAt)
  })

  it('Space 不存在拒：返回 false、状态不变、不发事件', () => {
    const { manager, seen } = createManager(['space.created', 'space.switched'])

    expect(manager.setActiveWindow('missing', 'win-1')).toBe(false)
    expect(manager.getSpaces()[0]?.activeWindowId).toBeNull()
    expect(seen).toEqual([])
  })

  it('snapshot → 新 manager hydrate round-trip 保留 activeWindowId', () => {
    const source = createManager().manager
    source.setActiveWindow(DEFAULT_SPACE_ID, 'win-42')
    const snap = source.snapshot()

    const restored = new SpaceManager(new EventBus<SystemEventMap>(), () => 'irrelevant')
    expect(restored.hydrate(snap)).toBe(true)
    expect(restored.getSpaces()[0]?.activeWindowId).toBe('win-42')
  })

  it('hydrate 缺省 activeWindowId 回落 null（W1 持久化数据双向兼容，version 仍为 1）', () => {
    const { manager } = createManager()

    expect(
      manager.hydrate({
        version: 1,
        spaces: [{ id: DEFAULT_SPACE_ID, name: 'Desktop 1', index: 0, createdAt: 1, updatedAt: 1 }],
        activeSpaceId: DEFAULT_SPACE_ID,
      }),
    ).toBe(true)
    expect(manager.getSpaces()[0]?.activeWindowId).toBeNull()
  })

  it.each([
    ['显式 null', null, true, null],
    ['显式字符串', 'win-9', true, 'win-9'],
  ])('hydrate activeWindowId 为 %s 时照常恢复', (_label, fieldValue, returnsTrue, expected) => {
    const { manager } = createManager()

    expect(
      manager.hydrate({
        version: 1,
        spaces: [
          {
            id: DEFAULT_SPACE_ID,
            name: 'Desktop 1',
            index: 0,
            createdAt: 1,
            updatedAt: 1,
            activeWindowId: fieldValue,
          },
        ],
        activeSpaceId: DEFAULT_SPACE_ID,
      }),
    ).toBe(returnsTrue)
    expect(manager.getSpaces()[0]?.activeWindowId).toBe(expected)
  })

  it('hydrate activeWindowId 非法类型（非 string/null/缺省）→ 结构损坏整体回落引导态', () => {
    const { manager, seen } = createManager(['space.created'])
    manager.createSpace('工作')
    seen.length = 0

    expect(
      manager.hydrate({
        version: 1,
        spaces: [
          {
            id: DEFAULT_SPACE_ID,
            name: 'Desktop 1',
            index: 0,
            createdAt: 1,
            updatedAt: 1,
            activeWindowId: 42,
          },
        ],
        activeSpaceId: DEFAULT_SPACE_ID,
      }),
    ).toBe(false)
    expect(manager.getSpaces()).toEqual([BOOT])
    expect(seen).toEqual([])
  })
})

describe('SpaceManager.snapshot / hydrate round-trip', () => {
  it('snapshot → 新 manager hydrate 还原 spaces 与 active 选择，返回 true', () => {
    vi.setSystemTime(1000)
    const source = createManager().manager
    const second = source.createSpace('工作')
    const third = source.createSpace('休闲')
    source.switchSpace(third.id)
    source.reorderSpaces(DEFAULT_SPACE_ID, 2)
    const snap = source.snapshot()

    vi.setSystemTime(5000)
    const restored = new SpaceManager(new EventBus<SystemEventMap>(), () => 'irrelevant')
    expect(restored.hydrate(snap)).toBe(true)

    expect(restored.getSpaces()).toEqual(source.getSpaces())
    expect(restored.activeSpaceId).toBe(third.id)
    expect(second.id).toBe('space-1')
  })

  it('恢复是加载行为不是 mutation：不发任何事件', () => {
    const ALL_SPACE_EVENTS = [
      'space.created',
      'space.deleted',
      'space.switched',
      'space.renamed',
      'space.reordered',
    ] as const
    const { manager, seen } = createManager([...ALL_SPACE_EVENTS])

    const source = createManager().manager
    source.createSpace('工作')

    expect(manager.hydrate(source.snapshot())).toBe(true)
    expect(seen).toEqual([])
  })

  it.each([
    ['非 JSON 对象', 'hoge'],
    ['version 不符', { version: 2, spaces: [BOOT], activeSpaceId: DEFAULT_SPACE_ID }],
    ['spaces 为空数组', { version: 1, spaces: [], activeSpaceId: DEFAULT_SPACE_ID }],
    [
      'activeSpaceId 悬空',
      { version: 1, spaces: [BOOT], activeSpaceId: 'space-missing' },
    ],
    [
      'Space 条目缺字段',
      { version: 1, spaces: [{ id: DEFAULT_SPACE_ID, name: 'Desktop 1' }], activeSpaceId: DEFAULT_SPACE_ID },
    ],
    [
      'Space id 重复',
      {
        version: 1,
        spaces: [BOOT, { ...BOOT }],
        activeSpaceId: DEFAULT_SPACE_ID,
      },
    ],
  ])('损坏持久化数据（%s）回落引导态并返回 false', (_label, data) => {
    const { manager, seen } = createManager(['space.created', 'space.deleted', 'space.switched'])
    manager.createSpace('工作')
    seen.length = 0

    expect(manager.hydrate(data)).toBe(false)
    expect(manager.getSpaces()).toEqual([BOOT])
    expect(manager.activeSpaceId).toBe(DEFAULT_SPACE_ID)
    expect(seen).toEqual([])
  })
})

describe('SpaceManager 事件次序与命名规则（B2 审查）', () => {
  it('删 active Space：先重定向 activeId 再发 deleted（监听器拿到有效 Space）', () => {
    const { manager, bus } = createManager()
    manager.createSpace()
    const seen: string[] = []
    let activeDuringDeleted: string | null = null
    bus.on('space.deleted', () => {
      seen.push('deleted')
      activeDuringDeleted = manager.getActiveSpace()?.id ?? null
    })
    bus.on('space.switched', () => seen.push('switched'))
    const activeId = manager.getActiveSpace()!.id
    expect(manager.deleteSpace(activeId)).toBe(true)
    expect(seen).toEqual(['deleted', 'switched'])
    expect(activeDuringDeleted).not.toBeNull()
    expect(manager.getActiveSpace()?.id).toBe(activeDuringDeleted)
  })

  it('createSpace 超长名回退缺省名（与 renameSpace 同一上限）', () => {
    const { manager } = createManager()
    const space = manager.createSpace('x'.repeat(200))
    expect(space.name).toBe('Desktop 2')
    const named = manager.createSpace('工作台')
    expect(named.name).toBe('工作台')
  })
})
