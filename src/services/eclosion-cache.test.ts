import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import {
  createEclosionCache,
  eclosionBasicKey,
  eclosionKeptKey,
  eclosionReplayKey,
  eclosionTodayKey,
  type EclosionReplayEntry,
} from './eclosion-cache'

const replayEntry = (worldDate: string, headline: string): EclosionReplayEntry => ({
  worldDate,
  headline,
  paletteId: 'nebula-violet',
  accentHue: 212,
  apps: [{ slug: 'edge-oracle', name: '边缘神谕', hue: 268, tagline: '一句话', category: 'tools' }],
  createdAt: `${worldDate}T08:00:00.000Z`,
})

/** 坑 14：jsdom 无 IndexedDB，测试配 fake-indexeddb/auto（devDependencies 已有）。 */
describe('eclosion-cache（IndexedDB agehaos.eclosion，§8）', () => {
  // 升级用例必须最先跑：本文件共享同一 fake 库，后续用例会把版本钉在 v2，
  // 再以 version 1 打开会抛 VersionError。
  it('upgrades a v1 (basic-only) database to v2 and creates today/kept/replay', async () => {
    // 手工造一个 v1 老库：只有 basic store + 一条旧记录。
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('agehaos.eclosion', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('basic')
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const legacy = createEclosionCache()
    await legacy.writeBasic('u-up', {
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
      specVersion: 1,
      html: '<!doctype html></html>',
      createdAt: '2026-10-01T00:00:00.000Z',
    })

    const cache = createEclosionCache() // v2 打开：onupgradeneeded 增量补建
    // 老数据无感（basic 仍在），新 store 可写可读。
    expect(await cache.readBasic('u-up', 'calculator', 1)).not.toBeNull()
    await cache.writeToday('u-up', {
      appId: 'com.ageha.eclosion.edge-oracle',
      worldDate: '2026-10-03',
      slug: 'edge-oracle',
      html: '<!doctype html></html>',
      createdAt: '2026-10-03T00:00:00.000Z',
    })
    expect((await cache.readToday('u-up', '2026-10-03', 'edge-oracle'))?.html).toBe('<!doctype html></html>')
    expect(eclosionTodayKey('u-up', '2026-10-03', 'edge-oracle')).toBe('u-up:2026-10-03:edge-oracle')
    expect(eclosionKeptKey('u-up', 'com.ageha.eclosion.x')).toBe('u-up:kept:com.ageha.eclosion.x')
    expect(eclosionReplayKey('u-up', '2026-10-03')).toBe('u-up:replay:2026-10-03')
  })

  it('round-trips a basic entry and keys it by user + spec version', async () => {
    const cache = createEclosionCache()
    const entry = {
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
      specVersion: 1,
      html: '<!doctype html><html><body><style>ok</style><script>1+1</script></body></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    }
    await cache.writeBasic('u-1', entry)

    const hit = await cache.readBasic('u-1', 'calculator', 1)
    expect(hit).toEqual(entry)
    expect(eclosionBasicKey('u-1', 'calculator', 1)).toBe('u-1:calculator:v1')
  })

  it('partitions by userId: another user sees no entry (登出不清、再登录秒开的前提)', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic('u-1', {
      appId: 'com.ageha.eclosion.notes',
      specId: 'notes',
      specVersion: 1,
      html: '<!doctype html><html></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    })

    expect(await cache.readBasic('u-2', 'notes', 1)).toBeNull()
    expect(await cache.readBasic('u-1', 'notes', 1)).not.toBeNull()
  })

  it('invalidates on spec version bump (规格版本升级即缓存失效)', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic('u-1', {
      appId: 'com.ageha.eclosion.clock',
      specId: 'clock',
      specVersion: 1,
      html: '<!doctype html><html></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    })

    expect(await cache.readBasic('u-1', 'clock', 2)).toBeNull()
  })

  it('treats missing and corrupted records as cache misses', async () => {
    // fake-indexeddb 同文件共享库：每个用例用独立 userId 隔离。
    const cache = createEclosionCache()
    expect(await cache.readBasic('u-miss', 'calculator', 1)).toBeNull()

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('agehaos.eclosion', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('basic', 'readwrite')
      tx.objectStore('basic').put({ appId: 'x' }, 'u-dirty:calculator:v1') // 脏记录
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    expect(await cache.readBasic('u-dirty', 'calculator', 1)).toBeNull()
  })

  it('clearUserData removes only the owning user’s keys (清除羽化数据)', async () => {
    const cache = createEclosionCache()
    const mk = (specId: string, appId: string) => ({
      appId,
      specId,
      specVersion: 1,
      html: '<!doctype html><html></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    await cache.writeBasic('u-1', mk('calculator', 'com.ageha.eclosion.calculator'))
    await cache.writeBasic('u-1', mk('notes', 'com.ageha.eclosion.notes'))
    await cache.writeBasic('u-2', mk('calculator', 'com.ageha.eclosion.calculator'))

    await cache.clearUserData('u-1')

    expect(await cache.readBasic('u-1', 'calculator', 1)).toBeNull()
    expect(await cache.readBasic('u-1', 'notes', 1)).toBeNull()
    expect(await cache.readBasic('u-2', 'calculator', 1)).not.toBeNull()
  })

  it('degrades silently when IndexedDB is unavailable (不阻塞桌面)', async () => {
    const cache = createEclosionCache(undefined as unknown as IDBFactory)
    expect(await cache.readBasic('u-1', 'calculator', 1)).toBeNull()
    expect(await cache.readToday('u-1', '2026-10-03', 'edge-oracle')).toBeNull()
    expect(await cache.readKept('u-1', 'com.ageha.eclosion.x')).toBeNull()
    expect(await cache.readReplay('u-1', '2026-10-03')).toBeNull()
    expect(await cache.listKept('u-1')).toEqual([])
    expect(await cache.listReplay('u-1')).toEqual([])
    await expect(
      cache.writeBasic('u-1', {
        appId: 'com.ageha.eclosion.calculator',
        specId: 'calculator',
        specVersion: 1,
        html: '<!doctype html>',
        createdAt: '',
      }),
    ).resolves.toBeUndefined()
    await expect(cache.writeReplay('u-1', replayEntry('2026-10-03', '标题'))).resolves.toBeUndefined()
    await expect(cache.clearUserData('u-1')).resolves.toBeUndefined()
  })

  it('round-trips replay entries, overwrites per world day and applies the ≤60 LRU', async () => {
    const cache = createEclosionCache()
    await cache.writeReplay('u-replay', replayEntry('2026-10-01', '第一日'))
    await cache.writeReplay('u-replay', replayEntry('2026-10-02', '第二日'))

    // 同世界日覆盖（蝶谱每日一条）。
    await cache.writeReplay('u-replay', replayEntry('2026-10-02', '第二日·改'))
    expect((await cache.readReplay('u-replay', '2026-10-02'))?.headline).toBe('第二日·改')
    expect(await cache.readReplay('u-replay', '2026-10-01')).not.toBeNull()

    // 列表按 worldDate 倒序（时间线最新在前）。
    expect((await cache.listReplay('u-replay')).map((entry) => entry.worldDate)).toEqual([
      '2026-10-02',
      '2026-10-01',
    ])

    // LRU ≤60：写入 62 条，最旧的 2 条被淘汰。
    for (let i = 1; i <= 62; i++) {
      const day = `2026-08-${String(i).padStart(2, '0')}`
      await cache.writeReplay('u-lru', { ...replayEntry(day, `第${i}日`), createdAt: `2026-08-${String(i).padStart(2, '0')}T00:00:00.000Z` })
    }
    const kept = await cache.listReplay('u-lru')
    expect(kept).toHaveLength(60)
    expect(kept.map((entry) => entry.worldDate)).not.toContain('2026-08-01')
    expect(kept.map((entry) => entry.worldDate)).not.toContain('2026-08-02')
    expect(kept[0]?.worldDate).toBe('2026-08-62')
  })

  it('round-trips kept entries and applies the ≤30 LRU', async () => {
    const cache = createEclosionCache()
    const mk = (n: number) => ({
      appId: `com.ageha.eclosion.kept-${n}`,
      name: `留存${n}`,
      html: `<!doctype html><p>${n}</p>`,
      createdAt: `2026-10-01T00:${String(n).padStart(2, '0')}:00.000Z`,
    })
    for (let i = 0; i < 32; i++) await cache.writeKept('u-kept', mk(i))

    expect(await cache.listKept('u-kept')).toHaveLength(30)
    // 最旧的 2 条被淘汰，最新的仍在。
    expect(await cache.readKept('u-kept', 'com.ageha.eclosion.kept-0')).toBeNull()
    expect(await cache.readKept('u-kept', 'com.ageha.eclosion.kept-1')).toBeNull()
    expect((await cache.readKept('u-kept', 'com.ageha.eclosion.kept-31'))?.name).toBe('留存31')
  })

  it('round-trips kept hue metadata and deletes a single kept entry (卸载)', async () => {
    const cache = createEclosionCache()
    await cache.writeKept('u-kept2', {
      appId: 'com.ageha.eclosion.app-01',
      name: '应用零一',
      html: '<!doctype html></html>',
      hue: 268,
      createdAt: '2026-10-03T00:00:00.000Z',
    })
    expect(await cache.readKept('u-kept2', 'com.ageha.eclosion.app-01')).toEqual({
      appId: 'com.ageha.eclosion.app-01',
      name: '应用零一',
      html: '<!doctype html></html>',
      hue: 268,
      createdAt: '2026-10-03T00:00:00.000Z',
    })

    await cache.deleteKept('u-kept2', 'com.ageha.eclosion.app-01')
    expect(await cache.readKept('u-kept2', 'com.ageha.eclosion.app-01')).toBeNull()
    expect(await cache.listKept('u-kept2')).toEqual([])
  })

  it('prunes today entries strictly older than the given day; kept/replay untouched (次日清理)', async () => {
    const cache = createEclosionCache()
    const writeToday = (day: string, slug: string) =>
      cache.writeToday('u-prune', {
        appId: `com.ageha.eclosion.${slug}`,
        worldDate: day,
        slug,
        html: `<!doctype html><!--${day}-->`,
        createdAt: `${day}T00:00:00.000Z`,
      })
    await writeToday('2026-10-02', 'old-app')
    await writeToday('2026-10-03', 'today-app')
    await cache.writeKept('u-prune', {
      appId: 'com.ageha.eclosion.old-app',
      name: '旧应用',
      html: '<!doctype html></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    await cache.writeReplay('u-prune', replayEntry('2026-10-02', '昨日世界'))

    await cache.pruneTodayBefore('u-prune', '2026-10-03')

    expect(await cache.readToday('u-prune', '2026-10-02', 'old-app')).toBeNull()
    expect(await cache.readToday('u-prune', '2026-10-03', 'today-app')).not.toBeNull()
    // kept 与 replay 不受影响。
    expect(await cache.readKept('u-prune', 'com.ageha.eclosion.old-app')).not.toBeNull()
    expect(await cache.readReplay('u-prune', '2026-10-02')).not.toBeNull()
  })

  it('clearUserData sweeps all four stores but only the owning user’s keys', async () => {
    const cache = createEclosionCache()
    await cache.writeBasic('u-sweep', {
      appId: 'com.ageha.eclosion.calculator',
      specId: 'calculator',
      specVersion: 1,
      html: '<!doctype html></html>',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    await cache.writeToday('u-sweep', {
      appId: 'com.ageha.eclosion.edge-oracle',
      worldDate: '2026-10-03',
      slug: 'edge-oracle',
      html: '<!doctype html></html>',
      createdAt: '2026-10-03T00:00:00.000Z',
    })
    await cache.writeKept('u-sweep', {
      appId: 'com.ageha.eclosion.kept-1',
      name: '留存1',
      html: '<!doctype html></html>',
      createdAt: '2026-10-03T00:00:00.000Z',
    })
    await cache.writeReplay('u-sweep', replayEntry('2026-10-03', '标题'))
    await cache.writeReplay('u-other', replayEntry('2026-10-03', '别人的'))

    await cache.clearUserData('u-sweep')

    expect(await cache.readBasic('u-sweep', 'calculator', 1)).toBeNull()
    expect(await cache.readToday('u-sweep', '2026-10-03', 'edge-oracle')).toBeNull()
    expect(await cache.readKept('u-sweep', 'com.ageha.eclosion.kept-1')).toBeNull()
    expect(await cache.readReplay('u-sweep', '2026-10-03')).toBeNull()
    expect(await cache.readReplay('u-other', '2026-10-03')).not.toBeNull()
  })
})
