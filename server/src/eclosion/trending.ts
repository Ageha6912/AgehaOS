import { classifyContentText } from '../classifier'
import type { DataStore } from '../store/types'

/**
 * 热点源（AI-GENERATED-APPS-DESIGN §6.1）：服务端抓取 + 清洗 + 双层缓存。
 *
 * - 可插拔 `TrendingSource`：默认 GitHub Trending RSS（mshibanami/GitHubTrendingRSS
 *   daily/all.xml，RSS 2.0 免鉴权）；后续可加 HN/PH 等公开源。
 * - 清洗：只取标题 + 一句描述；单条（标题+描述合计）≤120 字；最多 12 条；
 *   去 HTML/控制字符/URL；过 classifier，violation 条目直接剔除。
 * - 缓存：内存 + DataStore 双层，TTL 6h（AGEHA_ECLOSION_TRENDING_TTL_MS）。
 * - 降级：抓取失败用上一次成功数据（不限龄，fetchedAt 透明）；完全没有数据
 *   → 空列表 + degraded=true（无锚点纯想象，世界照常生成）。
 *
 * 热点文本是不可信输入（提示词注入防护 §6.1）：本模块只做清洗与缓存，
 * 注入防护在 prompts.ts 的世界消息组装层（JSON 数据块 + 系统提示词明示）。
 */

export interface TrendingItem {
  title: string
  description: string
}

export interface TrendingSnapshot {
  /** 最近一次成功抓取（或服务启动读到缓存）的 epoch ms。 */
  fetchedAt: number
  items: TrendingItem[]
  /** true = 无任何可用锚点（纯想象降级，§6.1）。 */
  degraded: boolean
}

/** 源的原始条目：字段宽松（未知来源 shape 各异），清洗层负责收敛。 */
export interface RawTrendingEntry {
  title?: unknown
  description?: unknown
}

/** 可插拔热点源接口（§6.1）；实现自行处理抓取，失败以 reject 透出。 */
export interface TrendingSource {
  /** 缓存键与展示用的稳定 id。 */
  readonly id: string
  /** 顶栏信号来源列表的展示名（§6.3 透明性）。 */
  readonly label: string
  /** 顶栏信号来源链接（来源级，非逐条）。 */
  readonly url: string
  fetch(): Promise<RawTrendingEntry[]>
}

export const DEFAULT_TRENDING_URL = 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml'

/** RSS 抓取的响应体上限（防失控 payload；清洗后实际入模 ≤12×120 字）。 */
const MAX_FEED_BYTES = 2 * 1024 * 1024

/** GitHub Trending RSS（RSS 2.0）源：免鉴权 GET，CDATA/实体编码均容忍。 */
export class GitHubTrendingRssSource implements TrendingSource {
  readonly id = 'github-trending'
  readonly label = 'GitHub Trending'
  readonly url: string

  constructor(
    url: string = DEFAULT_TRENDING_URL,
    private readonly timeoutMs = 10_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = url
  }

  async fetch(): Promise<RawTrendingEntry[]> {
    const response = await this.fetcher(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
    })
    if (!response.ok) {
      throw new Error(`trending source status ${response.status}`)
    }
    const body = response.body
    if (!body) throw new Error('trending source returned no body')
    // 边读边限量（A3 审查）：先 text() 后检查会把异常超大源整体读进内存，
    // 上限形同虚设；分块累计超限即停止并释放连接。
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let xml = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        xml += decoder.decode(value, { stream: true })
        if (xml.length > MAX_FEED_BYTES) {
          throw new Error(`trending feed exceeds ${MAX_FEED_BYTES} chars`)
        }
      }
      xml += decoder.decode()
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* 已正常收尾/已中止：忽略 */
      }
    }
    return parseRssItems(xml)
  }
}

/** RSS 2.0 条目解析（无 XML 依赖：条目边界 + 双字段；清洗层兜底一切畸形）。 */
export function parseRssItems(xml: string): RawTrendingEntry[] {
  const entries: RawTrendingEntry[] = []
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of itemBlocks) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1]
    const description = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(block)?.[1]
    entries.push({
      title: title === undefined ? undefined : unwrapCdata(title),
      description: description === undefined ? undefined : unwrapCdata(description),
    })
  }
  return entries
}

function unwrapCdata(text: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/m.exec(text.trim())
  return cdata ? cdata[1] : text
}

// ── 清洗（§6.1：只取标题+一句描述、≤120 字、≤12 条、去 HTML/控制字符/URL）──

const HTML_TAG_PATTERN = /<[^>]*>/g
// 本正则的职责就是剔除控制字符（热点文本是不可信输入）；no-control-regex
// 针对的是「意外匹配控制字符」，此处为有意为之。
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/gi
const WHITESPACE_RUN = /\s+/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    const named = NAMED_ENTITIES[entity.toLowerCase()]
    if (named !== undefined) return named
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return whole
  })
}

/** 单条清洗：stringify → 实体解码 → 去 HTML/控制字符/URL → 折叠空白。 */
export function cleanTrendingText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return decodeEntities(raw)
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(CONTROL_CHAR_PATTERN, ' ')
    .replace(URL_PATTERN, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
}

/** 按码点截断（中文与 emoji 不被劈成乱码）。 */
function truncateByPoints(text: string, max: number): string {
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join('')
}

export const MAX_TRENDING_ITEMS = 12
export const MAX_TRENDING_ITEM_CHARS = 120

/** 清洗 + 过滤原始条目（§6.1 全部规则；violation 剔除、去重、封顶 12 条）。 */
export function cleanTrendingEntries(raw: RawTrendingEntry[]): TrendingItem[] {
  const items: TrendingItem[] = []
  const seenTitles = new Set<string>()
  for (const entry of raw) {
    const title = cleanTrendingText(entry.title)
    if (title.length === 0) continue
    const dedupeKey = title.toLowerCase()
    if (seenTitles.has(dedupeKey)) continue
    seenTitles.add(dedupeKey)

    const titlePoints = Array.from(title)
    let itemTitle = title
    let description = cleanTrendingText(entry.description)
    if (titlePoints.length >= MAX_TRENDING_ITEM_CHARS) {
      itemTitle = truncateByPoints(title, MAX_TRENDING_ITEM_CHARS)
      description = ''
    } else {
      const room = MAX_TRENDING_ITEM_CHARS - titlePoints.length
      description = truncateByPoints(description, room)
    }

    // classifier 先行（§6.1）：violation 条目直接剔除（不进缓存、不进提示词）。
    if (classifyContentText(`${itemTitle} ${description}`).classification === 'violation') {
      continue
    }
    items.push({ title: itemTitle, description })
    if (items.length >= MAX_TRENDING_ITEMS) break
  }
  return items
}

// ── 双层缓存服务 ────────────────────────────────────────────────────────────

interface CachedTrending {
  fetchedAt: number
  items: TrendingItem[]
}

export function trendingCacheKey(sourceId: string): string {
  return `trending:${sourceId}`
}

export interface TrendingService {
  readonly source: TrendingSource
  /** 快照：新鲜命中缓存不抓取；失败降级见文件头。 */
  getSnapshot(): Promise<TrendingSnapshot>
  /** 仅测试/运维：清内存层。 */
  resetMemory(): void
}

export function createTrendingService(params: {
  store: DataStore
  source: TrendingSource
  ttlMs: number
  now?: () => number
}): TrendingService {
  const { store, source, ttlMs } = params
  const now = params.now ?? ((): number => Date.now())
  let memory: CachedTrending | null = null

  const readCached = async (): Promise<CachedTrending | null> => {
    const raw = await store.getEclosionCache(trendingCacheKey(source.id))
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as Partial<CachedTrending>
      if (
        typeof parsed.fetchedAt === 'number' &&
        Number.isFinite(parsed.fetchedAt) &&
        Array.isArray(parsed.items)
      ) {
        return { fetchedAt: parsed.fetchedAt, items: parsed.items }
      }
    } catch {
      /* 脏缓存当不存在，走重抓 */
    }
    return null
  }

  const fresh = (cached: CachedTrending | null): boolean =>
    cached !== null && now() - cached.fetchedAt < ttlMs

  return {
    source,
    resetMemory(): void {
      memory = null
    },
    async getSnapshot(): Promise<TrendingSnapshot> {
      // 内存层新鲜 → 直接回（最热路径不碰 DataStore）。
      if (fresh(memory)) {
        const current = memory as CachedTrending
        return { fetchedAt: current.fetchedAt, items: current.items, degraded: false }
      }
      // DataStore 层新鲜 → 回填内存层。
      const stored = await readCached()
      if (stored !== null && now() - stored.fetchedAt < ttlMs) {
        memory = stored
        return { fetchedAt: stored.fetchedAt, items: stored.items, degraded: false }
      }

      // 抓取（§6.1 失败用上一次成功数据；全无 → 纯想象降级）。
      try {
        const cleaned = cleanTrendingEntries(await source.fetch())
        if (cleaned.length > 0) {
          const next: CachedTrending = { fetchedAt: now(), items: cleaned }
          memory = next
          await store.putEclosionCache(trendingCacheKey(source.id), JSON.stringify(next))
          return { fetchedAt: next.fetchedAt, items: next.items, degraded: false }
        }
      } catch {
        /* 落入下方降级路径 */
      }

      const stale = memory ?? (await readCached())
      if (stale && stale.items.length > 0) {
        return { fetchedAt: stale.fetchedAt, items: stale.items, degraded: false }
      }
      return { fetchedAt: now(), items: [], degraded: true }
    },
  }
}
