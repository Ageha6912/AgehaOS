import 'fake-indexeddb/auto'

import { describe, it, expect, beforeEach } from 'vitest'

import { IdbAdapter } from './idb-adapter'
import type { VfsNode } from './types'

function makeNode(id: string, name: string): VfsNode {
  return {
    id,
    parentId: 'root',
    name,
    type: 'file',
    content: `content of ${name}`,
    size: 5,
    trashed: false,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
  }
}

let adapter: IdbAdapter

beforeEach(async () => {
  adapter = new IdbAdapter(globalThis.indexedDB)
  await adapter.save([])
})

describe('IdbAdapter', () => {
  it('round-trips nodes through IndexedDB', async () => {
    const nodes = [makeNode('n-1', 'a.txt'), makeNode('n-2', 'b.txt')]

    await adapter.save(nodes)
    const loaded = await adapter.load()

    expect(loaded).toHaveLength(2)
    expect(loaded.find((node) => node.id === 'n-1')?.content).toBe('content of a.txt')
  })

  it('replaces the whole state on save', async () => {
    await adapter.save([makeNode('n-1', 'a.txt')])
    await adapter.save([makeNode('n-2', 'b.txt')])

    const loaded = await adapter.load()

    expect(loaded.map((node) => node.id)).toEqual(['n-2'])
  })

  it('starts empty on a fresh database', async () => {
    const loaded = await adapter.load()

    expect(loaded).toEqual([])
  })
})

describe('IdbAdapter binary persistence（Phase 3 二进制承载）', () => {
  it('persists binary payloads across adapter instances', async () => {
    const binary: VfsNode = {
      ...makeNode('n-bin', 'photo.bin'),
      content: '',
      bytes: new Uint8Array([0, 255, 0, 128, 7]),
      size: 5,
    }
    await adapter.save([binary])

    // 新实例模拟重启后的恢复路径。
    const reopened = new IdbAdapter(globalThis.indexedDB)
    const loaded = await reopened.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.content).toBe('')
    // fake-indexeddb 结构化克隆跨 realm，instanceof 不可靠——用 toString 标签判断。
    expect(Object.prototype.toString.call(loaded[0]?.bytes)).toBe('[object Uint8Array]')
    expect([...(loaded[0]?.bytes ?? [])]).toEqual([0, 255, 0, 128, 7])
  })
})
