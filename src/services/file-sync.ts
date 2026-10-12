import { systemBus } from '@/core/events'
import type { Vfs } from '@/core/filesystem'
import { hashContent, mergeTrees } from '@/core/sync/file-merge'
import type { SyncTreeV2 } from '@/core/sync/file-merge'
import { useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useSyncStatusStore } from '@/store/sync-status-store'
import { isSyncEnabled, SYNC_TOGGLE_EVENT } from './settings-sync'
import { systemVfs } from './vfs'

/**
 * 云文件同步（PRD §35 Phase 3「云端文件」+ §42 Local First，ADR 17）：
 * 文本 VFS 与后端 `/api/sync/data/files` 按**文件级三方合并**同步。
 *
 * 语义（ADR 17）：本地维护逐文件「上次同步基线哈希」（per-user localStorage）；
 * 每次同步 = GET 服务端树 → `mergeTrees(base, local, server)` → 应用下载/删除/
 * 冲突副本 → PUT 合并树 → 推进基线。一方改动另一方未动时改动方赢；双方都改且
 * 不同 → 本地保留原地 + 服务端版本存为 `<name>.conflict-<savedAt><ext>` 副本，
 * 不丢数据。`applying` 标志阻断回声循环；合并结果超 256KB 时跳过本轮并发一
 * 次性通知。v1 整快照 blob 兼容：首次/旧数据走「服务端赢整体应用」后即转 v2 基线。
 * 回收站与已删节点不参与同步；同步开关关闭时服务静默自禁用（开关入口在账户
 * 分区仅远程认证模式渲染——AccountSection 准入，本地构建默认同样静默）。
 * 每次真实同步的 outcome（begin/success/failure + 时刻）如实记入
 * sync-status-store（M4-3 状态面），三方合并逻辑本身零改动。
 * 二进制文件与对象存储属 Phase 3 完整交付。
 */

const MARKER_KEY_PREFIX = 'agehaos.file-sync.v1.'
const PUSH_DEBOUNCE_MS = 1500
/** 与服务端 schema 上限一致（客户端按 UTF-8 字节从严校验）。 */
const SYNC_BUDGET_BYTES = 256 * 1024

/** 服务端 blob v1（Phase 3 文本切片首版，整快照 LWW）。 */
interface SyncBlobV1 {
  version: 1
  savedAt: number
  tree: { dirs: string[]; files: Array<{ path: string; content: string }> }
}

/** 服务端 blob v2（文件级合并）。 */
interface SyncBlobV2 {
  version: 2
  savedAt: number
  dirs: string[]
  files: Record<string, { hash: string; content: string }>
}

type SyncBlob = SyncBlobV1 | SyncBlobV2

/** 本地基线标记（per-user）：v2 起携带逐文件哈希。 */
interface SyncMarkerV2 {
  version: 2
  lastSyncedAt: number
  base: Record<string, string>
}

interface SyncMarkerLegacy {
  version?: 1
  lastSyncedAt: number
}

let started = false
let applying = false
let pushTimer: number | null = null
let lastPushedJson: string | null = null
let oversizeNotified = false
let activeVfs: Vfs = systemVfs
let unsubscribes: Array<() => void> = []

function markerKey(userId: string): string {
  return `${MARKER_KEY_PREFIX}${userId}`
}

function loadMarker(userId: string): SyncMarkerV2 | SyncMarkerLegacy {
  try {
    const raw = localStorage.getItem(markerKey(userId))
    if (!raw) return { lastSyncedAt: 0 }
    const parsed = JSON.parse(raw) as Partial<SyncMarkerV2> & Partial<SyncMarkerLegacy>
    if (parsed.version === 2 && typeof parsed.lastSyncedAt === 'number' && typeof parsed.base === 'object' && parsed.base !== null) {
      return { version: 2, lastSyncedAt: parsed.lastSyncedAt, base: parsed.base }
    }
    return { lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : 0 }
  } catch {
    return { lastSyncedAt: 0 }
  }
}

function saveMarkerV2(userId: string, base: Record<string, string>, lastSyncedAt: number): void {
  try {
    localStorage.setItem(markerKey(userId), JSON.stringify({ version: 2, lastSyncedAt, base } satisfies SyncMarkerV2))
  } catch {
    /* storage unavailable: stay in memory */
  }
}

function currentUserId(): string | null {
  return useSessionStore.getState().user?.id ?? null
}

function syncActive(): boolean {
  return isSyncEnabled() && currentUserId() !== null
}

const joinPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

/** 序列化本机树为 v2（跳过回收站/已删节点——list 递归天然不可见）。 */
export async function serializeTree(vfs: Vfs): Promise<SyncTreeV2> {
  const dirs: string[] = []
  const files: SyncTreeV2['files'] = {}
  const walk = async (dirPath: string): Promise<void> => {
    for (const node of await vfs.list(dirPath)) {
      const path = joinPath(dirPath, node.name)
      if (node.type === 'directory') {
        dirs.push(path)
        await walk(path)
      } else if (node.bytes === undefined) {
        files[path] = { hash: hashContent(node.content), content: node.content }
      }
      // 二进制文件（bytes 有义）暂不参与同步——设备本地语义；对象存储切片
      // （Phase 3 第二片）接管后放开，届时树中只携带哈希/键而非内容。
    }
  }
  await walk('/')
  return { dirs, files }
}

/** 服务端 blob（v1/v2）→ v2 树。 */
function toTreeV2(blob: SyncBlob): SyncTreeV2 {
  if (blob.version === 2) {
    return { dirs: blob.dirs, files: blob.files }
  }
  const files: SyncTreeV2['files'] = {}
  for (const file of blob.tree.files) {
    files[file.path] = { hash: hashContent(file.content), content: file.content }
  }
  return { dirs: blob.tree.dirs, files }
}

/**
 * 应用服务端 v1 整快照（旧数据/首次兼容路径，服务端赢）：建目录 → 清除本机
 * 多出条目 → 写差异文件。根级受保护目录不可整删——保留外壳、清空内容。
 */
export async function applySnapshot(vfs: Vfs, snapshot: SyncBlobV1): Promise<void> {
  const serverDirs = new Set(snapshot.tree.dirs)
  const serverFiles = new Map(snapshot.tree.files.map((file) => [file.path, file.content]))

  for (const dir of snapshot.tree.dirs) {
    try {
      await vfs.createDirectory(dir)
    } catch (error) {
      if ((error as { code?: string }).code !== 'already-exists') throw error
    }
  }

  /** 快照里没有的本机条目：移入回收站后立即彻底清除；受保护目录退化为清空内容。 */
  const tryCull = async (path: string): Promise<boolean> => {
    try {
      const trashed = await vfs.remove(path)
      await vfs.purge(trashed.id)
      return true
    } catch {
      return false
    }
  }

  const walk = async (dirPath: string): Promise<void> => {
    for (const child of await vfs.list(dirPath)) {
      const path = joinPath(dirPath, child.name)
      if (child.type === 'directory') {
        if (serverDirs.has(path)) {
          await walk(path)
          continue
        }
        if (!(await tryCull(path))) await walk(path)
        continue
      }
      if (!serverFiles.has(path)) await tryCull(path)
    }
  }
  await walk('/')

  for (const [path, content] of serverFiles) {
    const existing = await vfs.get(path)
    if (!existing || existing.type !== 'file' || existing.content !== content) {
      await vfs.writeFile(path, content)
    }
  }
}

function schedulePush(): void {
  if (!started || applying || !syncActive()) return
  if (pushTimer !== null) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = null
    void syncNow()
  }, PUSH_DEBOUNCE_MS)
}

async function fetchServerBlob(): Promise<SyncBlob | null> {
  const response = await fetch('/api/sync/data/files', { credentials: 'same-origin' })
  if (!response.ok) return null
  const body = (await response.json()) as { data: string | null }
  if (!body.data) return null
  const parsed = JSON.parse(body.data) as SyncBlob
  if ((parsed.version !== 1 && parsed.version !== 2) || typeof parsed.savedAt !== 'number') {
    throw Object.assign(new Error('bad-blob'), { code: 'bad-blob' })
  }
  return parsed
}

async function putServerTree(tree: SyncTreeV2, savedAt: number): Promise<boolean> {
  const data = JSON.stringify({ version: 2, savedAt, dirs: tree.dirs, files: tree.files } satisfies SyncBlobV2)
  if (new TextEncoder().encode(data).length > SYNC_BUDGET_BYTES) {
    if (!oversizeNotified) {
      oversizeNotified = true
      useNotificationStore.getState().push({
        appId: 'system',
        titleKey: 'notification.title.fileSyncOversized',
        bodyKey: 'notification.body.fileSyncOversized',
        priority: 'normal',
      })
    }
    return false
  }
  try {
    const response = await fetch('/api/sync/data/files', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** 在 applying 保护下把合并结果落盘（下载/冲突副本写入 + 本地跟随删除）。 */
async function applyMergeLocally(vfs: Vfs, result: ReturnType<typeof mergeTrees>): Promise<void> {
  applying = true
  try {
    for (const dir of result.merged.dirs) {
      try {
        await vfs.createDirectory(dir)
      } catch (error) {
        if ((error as { code?: string }).code !== 'already-exists') break
      }
    }
    for (const download of result.downloads) {
      await vfs.writeFile(download.path, download.content)
    }
    for (const conflict of result.conflicts) {
      await vfs.writeFile(conflict.conflictPath, conflict.content)
    }
    for (const path of result.localDeletions) {
      try {
        const trashed = await vfs.remove(path)
        await vfs.purge(trashed.id)
      } catch {
        /* already gone */
      }
    }
  } finally {
    applying = false
  }
}

/**
 * 同步主流程：GET 服务端树 → 三方合并 → 应用本地侧 → PUT 合并树 → 推进基线。
 * 登录拉取与会话内防抖上推共用；服务端为空时上推本机树作为初始版本。
 */
export async function syncNow(): Promise<void> {
  const userId = currentUserId()
  if (!userId || !syncActive()) return
  try {
    await activeVfs.ready()
  } catch {
    return
  }

  const status = useSyncStatusStore.getState()
  status.beginSyncCycle()
  let serverBlob: SyncBlob | null
  try {
    serverBlob = await fetchServerBlob()
  } catch {
    status.failSyncCycle(Date.now())
    return
  }

  const localTree = await serializeTree(activeVfs)
  const savedAt = Date.now()

  if (!serverBlob) {
    // 服务端还没有文件快照：本机树即初始版本。
    if (await putServerTree(localTree, savedAt)) {
      const base: Record<string, string> = {}
      for (const [path, entry] of Object.entries(localTree.files)) base[path] = entry.hash
      saveMarkerV2(userId, base, savedAt)
      status.completeSyncCycle(Date.now())
    } else {
      status.failSyncCycle(Date.now())
    }
    return
  }

  const marker = loadMarker(userId)
  const serverTree = toTreeV2(serverBlob)
  // 基线：v2 标记携带；v1/无标记（升级或旧版首拉后）以服务端树为基线——此后
  // 本机相对服务端的差异全部视为本地改动上推，不会产生虚假冲突。
  const base =
    marker.version === 2
      ? marker.base
      : Object.fromEntries(Object.entries(serverTree.files).map(([path, entry]) => [path, entry.hash]))

  const result = mergeTrees({ base, local: localTree, server: serverTree, savedAt })

  await applyMergeLocally(activeVfs, result)

  const mergedJson = JSON.stringify(result.merged)
  if (mergedJson === lastPushedJson) {
    saveMarkerV2(userId, baseOf(result.merged), savedAt)
    status.completeSyncCycle(Date.now())
    return
  }
  if (!(await putServerTree(result.merged, savedAt))) {
    status.failSyncCycle(Date.now())
    return
  }
  lastPushedJson = mergedJson
  saveMarkerV2(userId, baseOf(result.merged), savedAt)
  status.completeSyncCycle(Date.now())
}

function baseOf(tree: SyncTreeV2): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [path, entry] of Object.entries(tree.files)) base[path] = entry.hash
  return base
}

/** 登录/启动拉取：v2 基线直接走三方合并；无基线先整体采纳服务端（服务端赢）。 */
export async function pullFilesOnce(): Promise<void> {
  const userId = currentUserId()
  if (!userId || !syncActive()) return
  try {
    await activeVfs.ready()
  } catch {
    return
  }

  if (loadMarker(userId).version === 2) {
    await syncNow()
    return
  }

  // 旧标记/首次：沿用 v1 语义——服务端较新则整体应用（服务端赢），为空则首推。
  const status = useSyncStatusStore.getState()
  status.beginSyncCycle()
  let body: { data: string | null }
  try {
    const response = await fetch('/api/sync/data/files', { credentials: 'same-origin' })
    if (!response.ok) {
      status.failSyncCycle(Date.now())
      return
    }
    body = (await response.json()) as { data: string | null }
  } catch {
    status.failSyncCycle(Date.now())
    return
  }
  if (!body.data) {
    // 服务端为空：本机树待首推（防抖后的 syncNow 自会汇报 outcome）。
    schedulePush()
    return
  }
  let blob: SyncBlob
  try {
    blob = JSON.parse(body.data) as SyncBlob
  } catch {
    status.failSyncCycle(Date.now())
    return
  }
  if ((blob.version !== 1 && blob.version !== 2) || typeof blob.savedAt !== 'number') {
    status.failSyncCycle(Date.now())
    return
  }
  // v1 语义：服务端不比本机标记新 → 什么都不做（本地保留，改动随后上推）。
  if (blob.savedAt <= loadMarker(userId).lastSyncedAt) {
    // 与服务端接触成功且基线仍最新：视为一次完成的核对。
    status.completeSyncCycle(Date.now())
    return
  }
  applying = true
  try {
    if (blob.version === 1) {
      await applySnapshot(activeVfs, blob)
    } else {
      await applyMergeLocally(activeVfs, {
        merged: { dirs: blob.dirs, files: blob.files },
        downloads: Object.entries(blob.files).map(([path, entry]) => ({ path, content: entry.content })),
        localDeletions: [],
        conflicts: [],
      })
    }
    lastPushedJson = body.data
    const tree = toTreeV2(blob)
    saveMarkerV2(userId, baseOf(tree), blob.savedAt)
    status.completeSyncCycle(Date.now())
  } catch (error) {
    console.error('[AgehaOS:FileSync] failed to apply server snapshot', error)
    status.failSyncCycle(Date.now())
  } finally {
    applying = false
  }
}

/** 幂等启动：订阅登录/登出与 VFS 变更 + boot 拉取。本地模式自动自禁用。 */
export function startFileSync(options?: { vfs?: Vfs }): void {
  if (started) return
  started = true
  if (options?.vfs) activeVfs = options.vfs
  unsubscribes.push(
    systemBus.on('user.login', () => {
      oversizeNotified = false
      lastPushedJson = null
      void pullFilesOnce()
    }),
  )
  unsubscribes.push(
    systemBus.on('user.logout', () => {
      if (pushTimer !== null) {
        window.clearTimeout(pushTimer)
        pushTimer = null
      }
      lastPushedJson = null
    }),
  )
  unsubscribes.push(systemBus.on('file.created', schedulePush))
  unsubscribes.push(systemBus.on('file.updated', schedulePush))
  unsubscribes.push(systemBus.on('file.deleted', schedulePush))
  // 会话中途开启同步开关：立即拉取（服务端较新则应用），否则本机树待推。
  const onToggle = (): void => {
    oversizeNotified = false
    lastPushedJson = null
    void pullFilesOnce()
  }
  window.addEventListener(SYNC_TOGGLE_EVENT, onToggle)
  unsubscribes.push(() => window.removeEventListener(SYNC_TOGGLE_EVENT, onToggle))
  // 冷启动恢复会话（不经 login()）时补拉。
  if (useSessionStore.getState().user) void pullFilesOnce()
}

/** 测试间隔离（含未启动状态、总线订阅与 VFS 注入还原）。 */
export function resetFileSyncStateForTests(): void {
  for (const off of unsubscribes) off()
  unsubscribes = []
  started = false
  applying = false
  oversizeNotified = false
  lastPushedJson = null
  activeVfs = systemVfs
  if (pushTimer !== null) {
    window.clearTimeout(pushTimer)
    pushTimer = null
  }
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(MARKER_KEY_PREFIX)) doomed.push(key)
  }
  for (const key of doomed) localStorage.removeItem(key)
}
