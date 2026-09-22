import { describe, expect, it } from 'vitest'

import { createVfs, MemoryAdapter } from '../filesystem'
import type { Vfs } from '../filesystem'
import {
  appendHistoryEntry,
  HISTORY_LIMIT,
  loadHistory,
  parseHistory,
  saveHistory,
  serializeHistory,
} from './history'
import { buildWallpaperPlan, COMPOSITIONS } from './generative/templates'
import type { HistoryEntry } from './types'

function planOf(seed: string): HistoryEntry['plan'] {
  return buildWallpaperPlan({
    seed,
    style: 'fluid-gradient',
    paletteId: 'midnight-ink',
    compositionId: COMPOSITIONS[0].id,
    density: 0.1,
    zone: 'converge',
    reason: { signals: [], palette: 'midnight-ink', motif: 'fluid-gradient' },
  })
}

function entryOf(seed: string): HistoryEntry {
  return { plan: planOf(seed), level: 'L0', createdAt: '2026-09-22T10:00:00.000Z' }
}

async function freshVfs(): Promise<Vfs> {
  const vfs = createVfs({ adapter: new MemoryAdapter() })
  await vfs.ready()
  return vfs
}

describe('history persistence (§6.5：仅文本元数据，LRU ≤30 条)', () => {
  it('round-trips through the VFS as UTF-8 text (Phase A 位图不落盘)', async () => {
    const vfs = await freshVfs()
    const entries = [entryOf('a'), entryOf('b'), entryOf('c')]
    await saveHistory(vfs, entries)
    expect(await loadHistory(vfs)).toEqual(entries)
  })

  it('evicts the oldest entry beyond the LRU limit', () => {
    let entries: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      entries = appendHistoryEntry(entries, entryOf(`seed-${i}`))
    }
    expect(entries).toHaveLength(HISTORY_LIMIT)
    expect(entries[0]?.plan.seed).toBe(`seed-${10}`)
  })

  it('drops oldest entries until the payload fits in 64KB', () => {
    const bloated: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({
      plan: { ...planOf(`big-${i}`), reason: { signals: ['x'.repeat(4000)], palette: 'midnight-ink', motif: 'fluid-gradient' } },
      level: 'L0',
      createdAt: '2026-09-22T10:00:00.000Z',
    }))
    const serialized = serializeHistory(bloated)
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(64 * 1024)
    const parsed = parseHistory(serialized)
    expect(parsed.length).toBeLessThan(HISTORY_LIMIT)
    expect(parsed[parsed.length - 1]?.plan.seed).toBe(`big-${HISTORY_LIMIT - 1}`)
  })

  it('parses tolerantly: garbage, bad json and invalid entries all fall back safely (§2.3)', async () => {
    expect(parseHistory('not json')).toEqual([])
    expect(parseHistory('{"entries": [1, "x", null]}')).toEqual([])
    const vfs = await freshVfs()
    await saveHistory(vfs, [entryOf('keep-me')])
    await vfs.writeFile('/Pictures/wallpapers/history.v1.json', '{corrupted')
    expect(await loadHistory(vfs)).toEqual([])
  })
})
