import { isRemoteAuthActive } from '@/core/auth'
import { systemBus } from '@/core/events'
import type { Vfs } from '@/core/filesystem'
import { useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { isSyncEnabled, SYNC_TOGGLE_EVENT } from './settings-sync'
import { systemVfs } from './vfs'

/**
 * 云文件同步·文本切片（PRD §35 Phase 3「云端文件」+ §42 Local First）：
 * 把本机 VFS 文本树作为整体快照与后端 `/api/sync/data/files` 同步。
 *
 * 语义（整快照 LWW）：登录时拉取——仅当服务端 savedAt 新于本机上次同步标记时
 * 应用（服务端赢；本机离线改动标记未推进，照常上推，即更晚的写者赢）；此后
 * 订阅 `file.*` 事件防抖上推（本地赢）。`applying` 标志阻断回声循环；快照
 * 超过 256KB 时跳过上推并发一次性通知。回收站与已删节点不参与同步；应用
 * 服务端快照时多出的本地条目走 remove+purge（彻底删除，回收站保持设备本地
 * 语义）。本地认证模式或同步开关关闭时服务静默自禁用。按文件粒度的合并/
 * 仲裁属 Phase 3 完整交付。
 */

const MARKER_KEY_PREFIX = 'agehaos.file-sync.v1.'
const PUSH_DEBOUNCE_MS = 1500
/** 与服务端 schema 上限一致（客户端按 UTF-8 字节从严校验）。 */
const SYNC_BUDGET_BYTES = 256 * 1024

/** 快照树（扁平、父目录先于子条目）。路径为绝对形式（'/' 根不入表）。 */
export interface SyncSnapshot {
  version: 1
  savedAt: number
  tree: { dirs: string[]; files: Array<{ path: string; content: string }> }
}

interface SyncMarker {
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

function loadMarker(userId: string): SyncMarker {
  try {
    const raw = localStorage.getItem(markerKey(userId))
    if (!raw) return { lastSyncedAt: 0 }
    const parsed = JSON.parse(raw) as Partial<SyncMarker>
    return { lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : 0 }
  } catch {
    return { lastSyncedAt: 0 }
  }
}

function saveMarker(userId: string, marker: SyncMarker): void {
  try {
    localStorage.setItem(markerKey(userId), JSON.stringify(marker))
  } catch {
    /* storage unavailable: stay in memory */
  }
}

function currentUserId(): string | null {
  return useSessionStore.getState().user?.id ?? null
}

function syncActive(): boolean {
  return isRemoteAuthActive() && isSyncEnabled() && currentUserId() !== null
}

const joinPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

/** 序列化本机树（跳过回收站/已删节点——list 递归天然不可见）。 */
export async function serializeSnapshot(vfs: Vfs, savedAt: number): Promise<SyncSnapshot> {
  const dirs: string[] = []
  const files: Array<{ path: string; content: string }> = []
  const walk = async (dirPath: string): Promise<void> => {
    for (const node of await vfs.list(dirPath)) {
      const path = joinPath(dirPath, node.name)
      if (node.type === 'directory') {
        dirs.push(path)
        await walk(path)
      } else {
        files.push({ path, content: node.content })
      }
    }
  }
  await walk('/')
  return { version: 1, savedAt, tree: { dirs, files } }
}

/** 应用服务端快照：建目录 → 清除本机多出条目 → 写差异文件。 */
export async function applySnapshot(vfs: Vfs, snapshot: SyncSnapshot): Promise<void> {
  const serverDirs = new Set(snapshot.tree.dirs)
  const serverFiles = new Map(snapshot.tree.files.map((file) => [file.path, file.content]))

  for (const dir of snapshot.tree.dirs) {
    try {
      await vfs.createDirectory(dir)
    } catch (error) {
      if ((error as { code?: string }).code !== 'already-exists') throw error
    }
  }

  /**
   * 快照里没有的本机条目：移入回收站后立即彻底清除（回收站保持设备本地语义）。
   * 根级系统目录（PRD §11.1，v0.1 全部受保护不可删）无法整枝清除——保留外壳，
   * 由调用方退化为清空其内容。
   */
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
        // 不在快照中的目录：受保护目录清空内容，其余整枝清除。
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
    void pushNow()
  }, PUSH_DEBOUNCE_MS)
}

async function pushNow(): Promise<void> {
  const userId = currentUserId()
  if (!userId) return
  const snapshot = await serializeSnapshot(activeVfs, Date.now())
  const data = JSON.stringify(snapshot)
  if (data === lastPushedJson) return
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
    return
  }
  try {
    const response = await fetch('/api/sync/data/files', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    })
    if (response.ok) {
      lastPushedJson = data
      saveMarker(userId, { lastSyncedAt: snapshot.savedAt })
    }
  } catch {
    /* offline: next change retries */
  }
}

/** 登录/启动拉取：服务端快照较新则应用（服务端赢），为空则首推本机树。 */
export async function pullFilesOnce(): Promise<void> {
  const userId = currentUserId()
  if (!userId || !syncActive()) return
  try {
    await activeVfs.ready()
  } catch {
    return
  }
  let body: { data: string | null }
  try {
    const response = await fetch('/api/sync/data/files', { credentials: 'same-origin' })
    if (!response.ok) return
    body = (await response.json()) as { data: string | null }
  } catch {
    return
  }
  if (!body.data) {
    // 服务端还没有文件快照：把本机树作为初始版本推上去。
    schedulePush()
    return
  }
  let snapshot: SyncSnapshot
  try {
    snapshot = JSON.parse(body.data) as SyncSnapshot
  } catch {
    return
  }
  if (snapshot.version !== 1 || typeof snapshot.savedAt !== 'number') return
  if (snapshot.savedAt <= loadMarker(userId).lastSyncedAt) return
  applying = true
  try {
    await applySnapshot(activeVfs, snapshot)
    lastPushedJson = body.data
    saveMarker(userId, { lastSyncedAt: snapshot.savedAt })
  } catch (error) {
    console.error('[AgehaOS:FileSync] failed to apply server snapshot', error)
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
