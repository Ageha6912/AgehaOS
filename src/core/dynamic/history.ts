import { VfsError } from '../filesystem/types'
import type { WallpaperPlan } from './types'
import type { FallbackLevel, HistoryEntry } from './types'

/**
 * 生成历史持久化（设计文档 §6.5）：仅文本元数据（种子三元组 + 时间 + 理由），
 * VFS `/Pictures/wallpapers/history.v1.json`，≤30 条 LRU、≤64KB，超限淘汰最旧。
 * Phase A 位图不落盘（§11.1）——回滚 = 重放历史三元组。
 */

export const HISTORY_PATH = '/Pictures/wallpapers/history.v1.json'
export const HISTORY_LIMIT = 30
export const HISTORY_MAX_BYTES = 64 * 1024

/** 最小 Vfs 接口（便于测试注入 MemoryAdapter 实例或 mock）。 */
export interface VfsLike {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<unknown>
  createDirectory(path: string): Promise<unknown>
}

export function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 逐级建目录；已存在（'already-exists'）视为成功。 */
export async function ensureVfsDir(vfs: VfsLike, path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    try {
      await vfs.createDirectory(current)
    } catch (error) {
      if (error instanceof VfsError && error.code === 'already-exists') continue
      throw error
    }
  }
}

export function appendHistoryEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [...entries, entry].slice(-HISTORY_LIMIT)
}

/** 最近一次质量门合格的计划（F1 重放来源）。 */
export function lastGoodPlanOf(entries: HistoryEntry[]): WallpaperPlan | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry && entry.level === 'L0') return entry.plan
  }
  return null
}

export function serializeHistory(entries: HistoryEntry[]): string {
  let payload = JSON.stringify({ version: 1, entries })
  while (byteLengthOf(payload) > HISTORY_MAX_BYTES && entries.length > 0) {
    entries = entries.slice(1)
    payload = JSON.stringify({ version: 1, entries })
  }
  return payload
}

export async function saveHistory(vfs: VfsLike, entries: HistoryEntry[]): Promise<void> {
  await ensureVfsDir(vfs, '/Pictures/wallpapers')
  await vfs.writeFile(HISTORY_PATH, serializeHistory(entries))
}

/** 读档容错：任何解析/校验失败都回落空历史（脏数据不破坏启动，§2.3）。 */
export async function loadHistory(vfs: VfsLike): Promise<HistoryEntry[]> {
  try {
    const raw = await vfs.readFile(HISTORY_PATH)
    return parseHistory(raw)
  } catch {
    return []
  }
}

export function parseHistory(raw: string): HistoryEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const entries = (parsed as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  const valid: HistoryEntry[] = []
  for (const item of entries.slice(-HISTORY_LIMIT)) {
    const entry = validateEntry(item)
    if (entry) valid.push(entry)
  }
  return valid
}

function validateEntry(item: unknown): HistoryEntry | null {
  if (typeof item !== 'object' || item === null) return null
  const candidate = item as { plan?: unknown; level?: unknown; createdAt?: unknown }
  const plan = candidate.plan as WallpaperPlan | undefined
  if (
    !plan ||
    typeof plan.seed !== 'string' ||
    typeof plan.templateId !== 'string' ||
    typeof plan.paletteId !== 'string' ||
    !Array.isArray(plan.shapes)
  ) {
    return null
  }
  const levels: FallbackLevel[] = ['L0', 'F1', 'F2', 'F3']
  if (typeof candidate.level !== 'string' || !levels.includes(candidate.level as FallbackLevel)) {
    return null
  }
  if (typeof candidate.createdAt !== 'string') return null
  return { plan, level: candidate.level as FallbackLevel, createdAt: candidate.createdAt }
}
