/**
 * 云文件同步·文件级三方合并引擎（PRD §35 Phase 3 切片，ADR 17）。
 *
 * 纯函数、零 React、零 IO：输入「上次同步基线（逐文件内容哈希）+ 本地树 + 服务端
 * 树」，输出「上传用的合并树 + 需下载应用的条目 + 需本地删除的条目 + 冲突副本」。
 * 合并语义（逐文件，对齐 §42 Local First）：
 * - 一方改动另一方未动 → 改动方赢（更晚的写者自然胜出）；
 * - 双方都改且不同 → **冲突不丢数据**：本地版本原地保留，服务端版本另存
 *   `<name>.conflict-<savedAt><ext>` 副本，两条都进合并树；
 * - 删除与编辑相遇 → 编辑赢（本地编辑胜过远端删除；远端编辑胜过本地删除时
 *   以冲突副本找回）。
 * 哈希为 cyrb53 + 长度后缀，仅用于变更检测（内容仍随树携带，不用哈希做存储寻址）。
 */

/** 单文件条目：变更检测哈希 + 内容本体。 */
export interface SyncFileEntry {
  hash: string
  content: string
}

/** 同步树（v2）：目录清单 + 逐文件条目。路径为绝对形式（'/' 根不入表）。 */
export interface SyncTreeV2 {
  dirs: string[]
  files: Record<string, SyncFileEntry>
}

/** 合并输入：base = 上次同步时每个文件的内容哈希（缺省 = 首次同步，无基线）。 */
export interface MergeTreesInput {
  base: Readonly<Record<string, string>>
  local: SyncTreeV2
  server: SyncTreeV2
  /** 冲突副本命名时间戳（取本次 savedAt，ms）。 */
  savedAt: number
}

export interface ConflictCopy {
  /** 本地保留的原路径。 */
  path: string
  /** 服务端版本另存的冲突副本路径。 */
  conflictPath: string
  content: string
}

export interface MergeTreesResult {
  /** 合并后的树：上传服务端 + 指导本地落盘的唯一真源。 */
  merged: SyncTreeV2
  /** 服务端较新且本地未动：需要写入本地磁盘。 */
  downloads: Array<{ path: string; content: string }>
  /** 服务端已删且本地未动：需要从本地磁盘删除。 */
  localDeletions: string[]
  /** 双方都改且不同：服务端版本另存的冲突副本（本地版本已在 merged 内）。 */
  conflicts: ConflictCopy[]
}

/** cyrb53（53-bit 字符串哈希）+ 长度后缀；确定性、跨端一致。 */
export function hashContent(content: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const high = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return `${high.toString(16)}-${content.length}`
}

/** 冲突副本路径：在扩展名前插入 `.conflict-<savedAt>`；已占用则追加序号。 */
export function conflictPathFor(path: string, savedAt: number, occupied: ReadonlySet<string>): string {
  const slash = path.lastIndexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash + 1)
  const name = slash === -1 ? path : path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const candidate = `${dir}${stem}.conflict-${savedAt}${ext}`
  if (!occupied.has(candidate)) return candidate
  for (let n = 2; ; n++) {
    const numbered = `${dir}${stem}.conflict-${savedAt}-${n}${ext}`
    if (!occupied.has(numbered)) return numbered
  }
}

function parentDirsOf(path: string): string[] {
  const dirs: string[] = []
  let index = path.indexOf('/', 1)
  while (index !== -1) {
    dirs.push(path.slice(0, index))
    index = path.indexOf('/', index + 1)
  }
  return dirs
}

/**
 * 逐路径三方合并。规则见文件头；对「本地新增 vs 服务端新增」哈希一致视为同文。
 * 合并树的目录集 = 三方目录并集 −（基线有、本地与服务端皆无的目录），并保证
 * 合并文件的所有父目录都存在。
 */
export function mergeTrees(input: MergeTreesInput): MergeTreesResult {
  const { base, local, server, savedAt } = input
  const paths = new Set([...Object.keys(base), ...Object.keys(local.files), ...Object.keys(server.files)])
  const conflicts: ConflictCopy[] = []
  const downloads: Array<{ path: string; content: string }> = []
  const localDeletions: string[] = []

  const mergedFiles: Record<string, SyncFileEntry> = {}
  const mergedDirs = new Set([...local.dirs, ...server.dirs])

  const put = (path: string, entry: SyncFileEntry): void => {
    mergedFiles[path] = entry
    for (const dir of parentDirsOf(path)) mergedDirs.add(dir)
  }

  const keepServerAsConflict = (path: string, entry: SyncFileEntry): void => {
    const conflictPath = conflictPathFor(path, savedAt, new Set([...Object.keys(mergedFiles), ...paths]))
    conflicts.push({ path, conflictPath, content: entry.content })
    put(conflictPath, entry)
  }

  for (const path of paths) {
    const baseHash = base[path]
    const localEntry = local.files[path]
    const serverEntry = server.files[path]

    if (localEntry && serverEntry) {
      if (localEntry.hash === serverEntry.hash) {
        put(path, localEntry)
      } else if (baseHash !== undefined && localEntry.hash === baseHash && serverEntry.hash !== baseHash) {
        // 本地未动、服务端改动 → 下载。
        put(path, serverEntry)
        downloads.push({ path, content: serverEntry.content })
      } else if (baseHash !== undefined && localEntry.hash !== baseHash && serverEntry.hash === baseHash) {
        // 本地改动、服务端未动 → 本地上传。
        put(path, localEntry)
      } else {
        // 双方都改且不同（含双方新增）→ 冲突副本。
        put(path, localEntry)
        keepServerAsConflict(path, serverEntry)
      }
      continue
    }

    if (localEntry && !serverEntry) {
      if (baseHash !== undefined && localEntry.hash === baseHash) {
        // 服务端已删、本地未动 → 跟随删除。
        localDeletions.push(path)
      } else {
        // 本地改动/新增胜过远端删除 → 保留本地上传。
        put(path, localEntry)
      }
      continue
    }

    if (!localEntry && serverEntry) {
      if (baseHash !== undefined && serverEntry.hash === baseHash) {
        // 本地已删、服务端未动 → 跟随删除（合并树里缺席即可）。
        continue
      }
      if (baseHash === undefined) {
        // 服务端新增 → 下载。
        put(path, serverEntry)
        downloads.push({ path, content: serverEntry.content })
        continue
      }
      // 本地已删、服务端改动 → 冲突：以副本找回服务端版本（不覆盖删除意图之外的文件）。
      keepServerAsConflict(path, serverEntry)
      continue
    }

    // base 有、本地与服务端皆无 → 双方都已删除，无需处理。
  }

  // 目录集口径：三方目录并集 + 合并文件的父目录。空目录的「删除」不参与同步
  // （v1 同样不追踪空目录）；文件级删除已由 mergedFiles 缺席表达。

  const merged: SyncTreeV2 = {
    dirs: [...mergedDirs].sort(),
    files: mergedFiles,
  }
  return { merged, downloads, localDeletions, conflicts }
}
