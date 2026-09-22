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
