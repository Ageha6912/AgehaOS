/**
 * 羽化生成产物缓存（AI-GENERATED-APPS-DESIGN §8）：独立 IndexedDB 库
 * `agehaos.eclosion`，**不进 VFS 快照**（避免撑大全量同步、生成代码不被推上云端）。
 *
 * - 键按 userId 分区；登出不清（同设备再登录秒开），「清除羽化数据」按用户整段删除。
 * - DB_VERSION 2 一次建齐四个 store（P2 裁决：避免两次迁移）：
 *   basic（L1 三件套 HTML，按规格版本失效）、today（当日 L2 HTML，次日换新）、
 *   kept（「获取」留存 ≤30 LRU）、replay（蝶谱每日一条 ≤60 LRU，不存 HTML）。
 *   v1 老库只含 basic：onupgradeneeded 增量补建，老数据无感。
 * - 静默降级：IndexedDB 不可用/受禁时读写返回 null/void，绝不阻塞桌面（铁律：
 *   任何 AI 环节失败都不阻塞桌面）。
 */

const DB_NAME = 'agehaos.eclosion'
const DB_VERSION = 2
const BASIC_STORE = 'basic'
const TODAY_STORE = 'today'
const KEPT_STORE = 'kept'
const REPLAY_STORE = 'replay'

export interface EclosionCacheEntry {
  appId: string
  specId: string
  specVersion: number
  /** 结构闸后的完整自包含 HTML 文档（≤60KB，服务端契约）。 */
  html: string
  createdAt: string
}

/** today store 记录：当日世界应用的 L2 生成全文（§8：当日有效，次日清理）。 */
export interface EclosionTodayEntry {
  appId: string
  worldDate: string
  slug: string
  html: string
  createdAt: string
}

/** kept store 记录：「获取」留存的应用快照（§8：持久，≤30 个 LRU）。 */
export interface EclosionKeptEntry {
  appId: string
  /** 世界行应用名（启动器「我的羽化」展示用）。 */
  name: string
  html: string
  /** 世界行色相（瓦片徽章着色；想象/未知来源可缺省）。 */
  hue?: number
  createdAt: string
}

/** 蝶谱里的世界行应用名单条目（slug/名字/色相/tagline/分类；无 hint、无 HTML）。 */
export interface EclosionReplayApp {
  slug: string
  name: string
  hue: number
  tagline: string
  category: string
}

/** replay store 记录：蝶谱（§8：每日一条，只记主题元数据，不存 HTML）。 */
export interface EclosionReplayEntry {
  worldDate: string
  headline: string
  paletteId: string
  accentHue: number
  apps: ReadonlyArray<EclosionReplayApp>
  createdAt: string
}

export interface EclosionCache {
  readBasic(userId: string, specId: string, specVersion: number): Promise<EclosionCacheEntry | null>
  writeBasic(userId: string, entry: EclosionCacheEntry): Promise<void>
  readToday(userId: string, worldDate: string, slug: string): Promise<EclosionTodayEntry | null>
  writeToday(userId: string, entry: EclosionTodayEntry): Promise<void>
  readKept(userId: string, appId: string): Promise<EclosionKeptEntry | null>
  listKept(userId: string): Promise<EclosionKeptEntry[]>
  writeKept(userId: string, entry: EclosionKeptEntry): Promise<void>
  /** 卸载留存应用：删除该 kept 记录（§8 可卸载）。 */
  deleteKept(userId: string, appId: string): Promise<void>
  readReplay(userId: string, worldDate: string): Promise<EclosionReplayEntry | null>
  listReplay(userId: string): Promise<EclosionReplayEntry[]>
  /** 蝶谱写入：同 worldDate 覆盖；总量超上限时按 createdAt 淘汰最旧（LRU）。 */
  writeReplay(userId: string, entry: EclosionReplayEntry): Promise<void>
  /** 次日清理（§6.4/§8）：删除 worldDate 严格早于给定日的今日应用 HTML；
   *  kept 与 replay 不受影响。 */
  pruneTodayBefore(userId: string, worldDate: string): Promise<void>
  /** 「清除羽化数据」：删除该用户名下全部生成产物（四个 store 一并清）。 */
  clearUserData(userId: string): Promise<void>
}

/** basic store 记录键（userId 分区 + 规格版本失效，§8）。 */
export function eclosionBasicKey(userId: string, specId: string, specVersion: number): string {
  return `${userId}:${specId}:v${specVersion}`
}

/** today store 记录键（§8/§6.4：当日内重开走缓存，次日换新）。 */
export function eclosionTodayKey(userId: string, worldDate: string, slug: string): string {
  return `${userId}:${worldDate}:${slug}`
}

/** kept store 记录键（§7「获取」留存的持久快照）。 */
export function eclosionKeptKey(userId: string, appId: string): string {
  return `${userId}:kept:${appId}`
}

/** replay store 记录键（蝶谱：每世界日一条）。 */
export function eclosionReplayKey(userId: string, worldDate: string): string {
  return `${userId}:replay:${worldDate}`
}

export function hasEclosionDb(factory: unknown = globalThis.indexedDB): boolean {
  return typeof factory !== 'undefined' && factory !== null
}

/** Promise 包装的 IndexedDB 请求（照 core/filesystem/idb-adapter 先例）。 */
function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  return typeof value === 'string' && value !== '' ? value : null
}

export function createEclosionCache(factory: IDBFactory = globalThis.indexedDB): EclosionCache {
  const db: Promise<IDBDatabase> | null = hasEclosionDb(factory)
    ? new Promise((resolve, reject) => {
        const request = factory.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          // v1 老库只建过 basic：增量补建（contains 守卫保证幂等）。
          for (const storeName of [BASIC_STORE, TODAY_STORE, KEPT_STORE, REPLAY_STORE]) {
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName)
            }
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      })
    : null

  /** 任何存储层失败都静默降级（null / [] / void），不上抛。 */
  async function withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (db === null) return fallback
    try {
      const database = await db
      return await new Promise<T>((resolve, reject) => {
        const tx = database.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        run(store).then(resolve, reject)
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      })
    } catch {
      return fallback
    }
  }

  /** 该用户在某 store 下的全部记录（键前缀 `${userId}:` 过滤）。 */
  async function listByPrefix<T>(
    userId: string,
    storeName: string,
    revive: (record: unknown) => T | null,
  ): Promise<Array<{ key: string; value: T }>> {
    return withStore<Array<{ key: string; value: T }>>(
      storeName,
      'readonly',
      async (store) => {
        const keys = (await requestAsPromise(store.getAllKeys())) as IDBValidKey[]
        const out: Array<{ key: string; value: T }> = []
        for (const key of keys) {
          if (typeof key !== 'string' || !key.startsWith(`${userId}:`)) continue
          const revived = revive(await requestAsPromise(store.get(key)))
          if (revived !== null) out.push({ key, value: revived })
        }
        return out
      },
      [],
    )
  }

  /** 超上限按 createdAt 淘汰最旧（LRU；createdAt 缺失按最旧处理）。 */
  async function evictOldBeyond(
    userId: string,
    storeName: string,
    cap: number,
    keepKey: string,
  ): Promise<void> {
    await withStore<void>(
      storeName,
      'readwrite',
      async (store) => {
        const keys = (await requestAsPromise(store.getAllKeys())) as IDBValidKey[]
        const entries: Array<{ key: string; createdAt: string }> = []
        for (const key of keys) {
          if (typeof key !== 'string' || !key.startsWith(`${userId}:`)) continue
          const record = await requestAsPromise(store.get(key))
          const createdAt = isRecord(record) ? requireString(record, 'createdAt') : null
          entries.push({ key, createdAt: createdAt ?? '' })
        }
        if (entries.length <= cap) return
        entries.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        const doomed = entries.slice(0, entries.length - cap)
        for (const { key } of doomed) {
          if (key !== keepKey) store.delete(key)
        }
      },
      undefined,
    )
  }

  return {
    async readBasic(userId, specId, specVersion) {
      const key = eclosionBasicKey(userId, specId, specVersion)
      const record = await withStore<unknown>(
        BASIC_STORE,
        'readonly',
        async (store) => requestAsPromise(store.get(key)),
        null,
      )
      if (!isRecord(record)) return null
      if (
        requireString(record, 'html') === null ||
        requireString(record, 'appId') === null ||
        requireString(record, 'specId') === null ||
        typeof record.specVersion !== 'number'
      ) {
        return null // 脏记录：按未命中处理（重新生成即可自愈）
      }
      return {
        appId: record.appId as string,
        specId: record.specId as string,
        specVersion: record.specVersion as number,
        html: record.html as string,
        createdAt: requireString(record, 'createdAt') ?? '',
      }
    },

    async writeBasic(userId, entry) {
      await withStore<void>(
        BASIC_STORE,
        'readwrite',
        async (store) => {
          store.put({ ...entry }, eclosionBasicKey(userId, entry.specId, entry.specVersion))
        },
        undefined,
      )
    },

    async readToday(userId, worldDate, slug) {
      const record = await withStore<unknown>(
        TODAY_STORE,
        'readonly',
        async (store) => requestAsPromise(store.get(eclosionTodayKey(userId, worldDate, slug))),
        null,
      )
      if (!isRecord(record) || requireString(record, 'html') === null) return null
      return {
        appId: requireString(record, 'appId') ?? '',
        worldDate,
        slug,
        html: record.html as string,
        createdAt: requireString(record, 'createdAt') ?? '',
      }
    },

    async writeToday(userId, entry) {
      await withStore<void>(
        TODAY_STORE,
        'readwrite',
        async (store) => {
          store.put({ ...entry }, eclosionTodayKey(userId, entry.worldDate, entry.slug))
        },
        undefined,
      )
    },

    async readKept(userId, appId) {
      const record = await withStore<unknown>(
        KEPT_STORE,
        'readonly',
        async (store) => requestAsPromise(store.get(eclosionKeptKey(userId, appId))),
        null,
      )
      if (!isRecord(record) || requireString(record, 'html') === null) return null
      return reviveKept(record, appId)
    },

    async listKept(userId) {
      const rows = await listByPrefix<EclosionKeptEntry>(userId, KEPT_STORE, (record) => {
        if (!isRecord(record) || requireString(record, 'html') === null) return null
        const appId = requireString(record, 'appId')
        if (appId === null) return null
        return reviveKept(record, appId)
      })
      return rows.map((row) => row.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async writeKept(userId, entry) {
      await withStore<void>(
        KEPT_STORE,
        'readwrite',
        async (store) => {
          store.put({ ...entry }, eclosionKeptKey(userId, entry.appId))
        },
        undefined,
      )
      await evictOldBeyond(userId, KEPT_STORE, 30, eclosionKeptKey(userId, entry.appId))
    },

    async deleteKept(userId, appId) {
      await withStore<void>(
        KEPT_STORE,
        'readwrite',
        async (store) => {
          store.delete(eclosionKeptKey(userId, appId))
        },
        undefined,
      )
    },

    async readReplay(userId, worldDate) {
      const record = await withStore<unknown>(
        REPLAY_STORE,
        'readonly',
        async (store) => requestAsPromise(store.get(eclosionReplayKey(userId, worldDate))),
        null,
      )
      if (!isRecord(record) || requireString(record, 'headline') === null) return null
      return reviveReplay(record, worldDate)
    },

    async listReplay(userId) {
      const rows = await listByPrefix<EclosionReplayEntry>(userId, REPLAY_STORE, (record) => {
        if (!isRecord(record) || requireString(record, 'headline') === null) return null
        const worldDate = requireString(record, 'worldDate')
        if (worldDate === null) return null
        return reviveReplay(record, worldDate)
      })
      return rows.map((row) => row.value).sort((a, b) => b.worldDate.localeCompare(a.worldDate))
    },

    async writeReplay(userId, entry) {
      await withStore<void>(
        REPLAY_STORE,
        'readwrite',
        async (store) => {
          store.put({ ...entry }, eclosionReplayKey(userId, entry.worldDate))
        },
        undefined,
      )
      await evictOldBeyond(userId, REPLAY_STORE, 60, eclosionReplayKey(userId, entry.worldDate))
    },

    async pruneTodayBefore(userId, worldDate) {
      await withStore<void>(
        TODAY_STORE,
        'readwrite',
        async (store) => {
          const keys = (await requestAsPromise(store.getAllKeys())) as IDBValidKey[]
          for (const key of keys) {
            if (typeof key !== 'string') continue
            // 键形 `${userId}:${worldDate}:${slug}`（YYYY-MM-DD 字典序即日期序）。
            if (!key.startsWith(`${userId}:`)) continue
            const date = key.slice(userId.length + 1).split(':')[0]
            if (date !== '' && date < worldDate) store.delete(key)
          }
        },
        undefined,
      )
    },

    async clearUserData(userId) {
      for (const storeName of [BASIC_STORE, TODAY_STORE, KEPT_STORE, REPLAY_STORE]) {
        await withStore<void>(
          storeName,
          'readwrite',
          async (store) => {
            const keys = (await requestAsPromise(store.getAllKeys())) as IDBValidKey[]
            for (const key of keys) {
              if (typeof key === 'string' && key.startsWith(`${userId}:`)) store.delete(key)
            }
          },
          undefined,
        )
      }
    },
  }
}

function reviveKept(record: Record<string, unknown>, appId: string): EclosionKeptEntry {
  return {
    appId,
    name: requireString(record, 'name') ?? appId,
    html: record.html as string,
    ...(typeof record.hue === 'number' ? { hue: record.hue } : {}),
    createdAt: requireString(record, 'createdAt') ?? '',
  }
}

function reviveReplay(record: Record<string, unknown>, worldDate: string): EclosionReplayEntry {
  const rawApps = Array.isArray(record.apps) ? record.apps : []
  const apps = sanitizeReplayApps(rawApps)
  return {
    worldDate,
    headline: record.headline as string,
    paletteId: requireString(record, 'paletteId') ?? '',
    accentHue: typeof record.accentHue === 'number' ? record.accentHue : 220,
    apps,
    createdAt: requireString(record, 'createdAt') ?? '',
  }
}

function sanitizeReplayApps(raw: unknown[]): EclosionReplayApp[] {
  const out: EclosionReplayApp[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const slug = requireString(item, 'slug')
    const name = requireString(item, 'name')
    const tagline = requireString(item, 'tagline')
    if (slug === null || name === null || tagline === null) continue
    out.push({
      slug,
      name,
      hue: typeof item.hue === 'number' ? item.hue : 220,
      tagline,
      category: requireString(item, 'category') ?? 'tools',
    })
  }
  return out
}
