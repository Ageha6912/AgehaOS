/**
 * 羽化编排器（AI-GENERATED-APPS-DESIGN §3.1/§5.2/§5.4）：取缓存、发起流式
 * 生成、并发排队、取消、空闲预取、事件发送。
 *
 * 传输与存储可注入（fetcher/cache），默认走全局 fetch 与 IndexedDB
 * agehaos.eclosion——任何存储/网络失败都静默降级到「回落原生」，绝不阻塞
 * 桌面（§2 铁律）。
 *
 * 会话（EclosionSession）是宿主容器的数据源：快照含分片 HTML（不含 script）、
 * 截留脚本与阶段；粗粒度镜像同步进 eclosion-store（Settings/标题栏观察面）。
 */

import { systemBus } from '@/core/events'
import { getLocale, translate } from '@/core/i18n'
import { createHtmlStreamSplitter, type EclosionStreamChunk } from '@/core/eclosion/html-stream'
import { createSseParser, type SseParser } from '@/core/eclosion/sse'
import {
  BASIC_ECLOSION_SPECS,
  ECLOSION_APP_ID_PREFIX,
  ECLOSION_IMAGINE_ID_PREFIX,
  ECLOSION_RUNTIME_DEFAULT_WINDOW,
  eclosionAppKind,
  findEclosionSpecByAppId,
  imagineAppIdForQuery,
  type EclosionSpec,
} from '@/core/eclosion/spec'
import { utcDayKey, validateEclosionWorld, type EclosionWorld } from '@/core/eclosion/world'
import { ECLOSION_RUNNER_ENTRY } from '@/core/apps/web-app'
import { filterContentText } from '@/core/dynamic/content/filter'
import { getAppManifest, registerRuntimeApp, unregisterRuntimeApp } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import type { EclosionQuotaState, EclosionWorldSummary } from '@/store/eclosion-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { createEclosionCache, type EclosionCache, type EclosionReplayEntry } from './eclosion-cache'

/** 同一用户并发生成流上限（§5.4）。 */
export const ECLOSION_MAX_CONCURRENT_STREAMS = 2
/** 质量回退（§5.2）：自动重试一次，共两轮尝试。 */
export const ECLOSION_MAX_ATTEMPTS = 2
/** 破茧后等待 eclosion:rendered 的宿主侧时限（§5.2 五秒）。 */
export const ECLOSION_RENDER_TIMEOUT_MS = 5_000

/** 重试有意义的错误码；其余（未配置/超额/未登录/中止）直接回落。 */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'network',
  'ai-upstream',
  'ai-timeout',
  'invalid-output',
])

/** 生成内容出现密码框的宿主侧安全扫描（§10：标题栏红色警示）。 */
const PASSWORD_INPUT_PATTERN = /type\s*=\s*["']?\s*password/i

/** 举报载荷上限（§10；与服务端 samples 路由 schema 同口径，各自实现）。 */
export const REPORT_TEXT_MAX_LENGTH = 512
export const REPORT_DETAIL_MAX_LENGTH = 2048

export type EclosionSessionPhase = 'queued' | 'generating' | 'done' | 'error'

export interface EclosionSessionSnapshot {
  appId: string
  specId: string
  phase: EclosionSessionPhase
  /** think 事件累计思考字数。 */
  thinkChars: number
  /** 增量标记片（仅闭合元素，绝不含 script——截留在宿主侧）。 */
  chunks: readonly EclosionStreamChunk[]
  /** 截留脚本（破茧 eclosion:power-on 时才下发）。 */
  scripts: readonly string[]
  /** 内容来源：cache=缓存秒开，network=流式生成。 */
  source: 'network' | 'cache' | null
  errorCode: string | null
  /** 尝试轮次（1 起；重试/重新羽化递增；宿主据此重挂 iframe）。 */
  attempt: number
  passwordInputSeen: boolean
  /** 重试后仍失败、已回落原生（§5.2 质量回退终态）。 */
  fellBack: boolean
}

type Listener = () => void

/**
 * 单应用会话：不可变快照 + 订阅通知（宿主容器 useSyncExternalStore 直接消费）。
 */
export class EclosionSession {
  readonly appId: string
  /** 会话域 id：L1=specId；L2=世界行 slug（事件与镜像的标识）。 */
  readonly specId: string
  private snapshot: EclosionSessionSnapshot
  private readonly listeners = new Set<Listener>()
  private readonly settlers = new Array<() => void>()

  constructor(appId: string, specId: string) {
    this.appId = appId
    this.specId = specId
    this.snapshot = {
      appId,
      specId,
      phase: 'queued',
      thinkChars: 0,
      chunks: [],
      scripts: [],
      source: null,
      errorCode: null,
      attempt: 1,
      passwordInputSeen: false,
      fellBack: false,
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EclosionSessionSnapshot => this.snapshot

  /** 终态（done/error）一次性通知；预取用它串行等待（§5.2 顺序预取）。 */
  settled = (): Promise<void> =>
    new Promise((resolve) => {
      if (this.snapshot.phase === 'done' || this.snapshot.phase === 'error') {
        resolve()
        return
      }
      this.settlers.push(resolve)
    })

  /** 编排器内部：合并快照并广播。 */
  commit(patch: Partial<EclosionSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
    if (this.snapshot.phase === 'done' || this.snapshot.phase === 'error') {
      for (const settle of this.settlers.splice(0)) settle()
    }
  }
}

interface PipelineOptions {
  /** 跳过本地缓存读取（重试/重新羽化：既有内容已证不可用）。 */
  skipLocalCache: boolean
  /** POST regenerate:true——服务端跳过全局缓存读写（个人版本，§9.2）。 */
  regenerate: boolean
}

/** 注入式传输（测试换假实现）；签名比 typeof fetch 窄——编排器只按 URL 字符串调用。 */
export type EclosionFetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface EclosionOrchestratorOptions {
  fetcher?: EclosionFetcher
  cache?: EclosionCache
  concurrency?: number
  /** 测试注入的生成端点（缺省 /api/eclosion/generate）。 */
  generateUrl?: string
  quotaUrl?: string
  worldUrl?: string
  worldRegenerateUrl?: string
  /** 测试注入的举报样本端点（缺省 /api/dynamic/samples）。 */
  sampleReportUrl?: string
}

interface GenerateRequestBody {
  kind: 'basic' | 'today' | 'imagine'
  specId?: string
  worldDate?: string
  slug?: string
  query?: string
  locale: string
  theme: 'light' | 'dark'
  regenerate: boolean
}

/**
 * 会话生成目标：L1 走规格表；L2 今日应用 = 世界行（slug + 当日 worldDate）；
 * L3 想象应用 = 自由 query（§7：会话内同 query 复用同一 appId，HTML 只存内存）；
 * 「获取」留存应用 = kept 快照（只读缓存，不经网络）。
 */
type EclosionTarget =
  | { kind: 'basic'; appId: string; spec: EclosionSpec }
  | { kind: 'today'; appId: string; slug: string; worldDate: string }
  | { kind: 'imagine'; appId: string; query: string }
  | { kind: 'kept'; appId: string; slug: string }

export class EclosionOrchestrator {
  private readonly sessions = new Map<string, EclosionSession>()
  private readonly controllers = new Map<string, AbortController>()
  /** 重试后仍失败的应用：本次登录会话内不再预取（防失败循环烧额度）。 */
  private readonly gaveUp = new Set<string>()
  /** 每应用关注者计数（宿主容器挂载/卸载、预取持有）：归零且仍在生成即中止。 */
  private readonly attachments = new Map<string, number>()
  private readonly waiting: Array<() => void> = []
  private active = 0
  private started = false
  private unsubscribes: Array<() => void> = []
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null
  private prefetchIdleHandle: number | null = null
  private prefetchScheduled = false

  private fetcher: EclosionFetcher
  private cache: EclosionCache
  private readonly concurrency: number
  private readonly generateUrl: string
  private readonly quotaUrl: string
  private readonly worldUrl: string
  private readonly worldRegenerateUrl: string
  private readonly sampleReportUrl: string
  /**
   * 举报后会话封禁（§10）：内存级 Set，登出清空、不持久化（与锁记录同哲学）。
   * 封禁 appId 开窗即封禁卡（无重试），本登录会话内不可再打开。
   */
  private readonly bannedAppIds = new Set<string>()
  /** 会话级注册的今日世界清单 appIds（登出/跨日整体注销，§3.2）。 */
  private readonly registeredWorldAppIds = new Set<string>()
  /** 会话级注册的想象应用 appIds（登出整体注销；「获取」留存的走 kept 面）。 */
  private readonly registeredImagineAppIds = new Set<string>()
  /** imagine appId → 展示用 query（请求体与 kept 留存的名称来源，会话内有效）。 */
  private readonly imagineQueries = new Map<string, string>()
  /** imagine appId → 生成全文（§8：想象应用 HTML 只存内存，「获取」留存的快照源）。 */
  private readonly imagineHtml = new Map<string, string>()
  /** 「获取」留存的 appIds 镜像（store keptAppIds 的编排侧事实源）。 */
  private readonly keptAppIds = new Set<string>()
  /** 今日应用预取去重：每 worldDate 至多安排一次（§6.4 最多前 2 个）。 */
  private todayPrefetchedDate: string | null = null
  private todayPrefetchTimer: ReturnType<typeof setTimeout> | null = null
  private todayPrefetchIdleHandle: number | null = null

  constructor(options: EclosionOrchestratorOptions = {}) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis)
    this.cache = options.cache ?? createEclosionCache()
    this.concurrency = options.concurrency ?? ECLOSION_MAX_CONCURRENT_STREAMS
    this.generateUrl = options.generateUrl ?? '/api/eclosion/generate'
    this.quotaUrl = options.quotaUrl ?? '/api/eclosion/quota'
    this.worldUrl = options.worldUrl ?? '/api/eclosion/world'
    this.worldRegenerateUrl = options.worldRegenerateUrl ?? '/api/eclosion/world/regenerate'
    this.sampleReportUrl = options.sampleReportUrl ?? '/api/dynamic/samples'
  }

  /** 测试注入传输/存储（生产代码不经此路径）。 */
  configureForTests(options: EclosionOrchestratorOptions): void {
    if (options.fetcher !== undefined) this.fetcher = options.fetcher
    if (options.cache !== undefined) this.cache = options.cache
  }

  // ── 装配（main.tsx 装配链尾追加；照 systemDynamicDesktop 先例） ──────────

  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    this.unsubscribes.push(
      systemBus.on('user.login', ({ userId }) => {
        this.handleLogin(userId)
      }),
    )
    this.unsubscribes.push(systemBus.on('user.logout', () => this.handleLogout()))
    // 冷启动恢复会话（不经 login()）时补一次登录联动。
    const restored = useSessionStore.getState().user
    if (restored) this.handleLogin(restored.id)
  }

  stop(): void {
    for (const off of this.unsubscribes) off()
    this.unsubscribes = []
    this.cancelAll()
    this.cancelScheduledPrefetch()
    this.cancelTodayPrefetch()
    this.unregisterWorldApps()
    this.unregisterKeptApps()
    this.unregisterImagineApps()
    this.clearBans()
    this.todayPrefetchedDate = null
    this.started = false
  }

  private handleLogin(userId: string): void {
    useEclosionStore.getState().hydrateForUser(userId)
    void this.prepareUserData(userId)
    void this.refreshQuota().then(() => this.schedulePrefetch())
    // 今日世界（§6.2：登录拉取；任何失败静默——不阻塞桌面，AI 铁律）。
    void this.refreshWorld()
  }

  /**
   * 登录准备（§6.4/§8）：次日清理（今日应用 HTML 仅当日有效）+ 恢复「获取」
   * 留存注册（kept store 是跨重启的持久事实源）。失败静默。
   */
  private async prepareUserData(userId: string): Promise<void> {
    await this.cache.pruneTodayBefore(userId, utcDayKey())
    await this.restoreKeptApps(userId)
  }

  private handleLogout(): void {
    this.cancelAll()
    this.sessions.clear()
    this.gaveUp.clear()
    this.cancelScheduledPrefetch()
    this.cancelTodayPrefetch()
    this.unregisterWorldApps()
    this.unregisterKeptApps()
    this.unregisterImagineApps()
    this.clearBans()
    this.todayPrefetchedDate = null
    useEclosionStore.getState().handleLogout()
  }

  /** 封禁清空（登出/stop）：会话级状态，不跨登录保留。 */
  private clearBans(): void {
    this.bannedAppIds.clear()
    useEclosionStore.getState().setBannedAppIds([])
  }

  // ── 会话入口 ────────────────────────────────────────────────────────────

  /**
   * appId → 生成目标：basic=规格表；imagine=会话内想象 query（本会话生成过；
   * 未生成过的 imagine 前缀 = 已「获取」留存的快照 → kept 只读路径）；
   * today=当日世界行（世界摘要在场且含该 slug）；kept=其余 eclosion 前缀
   * （「获取」留存快照，管线内校验缓存）。非羽化应用返回 null。
   */
  private resolveTarget(appId: string): EclosionTarget | null {
    const spec = findEclosionSpecByAppId(appId)
    if (spec !== null) return { kind: 'basic', appId, spec }
    const kind = eclosionAppKind(appId)
    if (kind === null) return null
    if (kind === 'imagine') {
      const query = this.imagineQueries.get(appId)
      if (query !== undefined) return { kind: 'imagine', appId, query }
      // 会话内无此 query（跨重启的「获取」留存）：kept 快照即唯一真身。
      return { kind: 'kept', appId, slug: appId.slice(ECLOSION_APP_ID_PREFIX.length) }
    }
    const slug = appId.slice(ECLOSION_APP_ID_PREFIX.length)
    const world = useEclosionStore.getState().world
    if (
      world !== null &&
      world.worldDate === utcDayKey() &&
      world.apps.some((app) => app.slug === slug)
    ) {
      return { kind: 'today', appId, slug, worldDate: world.worldDate }
    }
    return { kind: 'kept', appId, slug }
  }

  /**
   * 取（或建）某应用的会话。生成中/已就绪的会话直接复用——「同一应用在生成中
   * 再次打开 → 聚焦已有窗口，不重复生成」（§5.4；窗口聚焦由窗口管理层负责）。
   */
  ensureSession(appId: string): EclosionSession | null {
    const target = this.resolveTarget(appId)
    if (target === null) return null
    // 会话封禁（§10）：封禁的应用不再建会话/不发请求（宿主渲染封禁卡）。
    if (this.bannedAppIds.has(appId)) return null
    const existing = this.sessions.get(appId)
    if (existing) {
      // 关窗中止（aborted）的会话：重开 = 重新走一遍缓存优先管线。
      if (existing.getSnapshot().phase === 'error' && existing.getSnapshot().errorCode === 'aborted') {
        this.startAttempt(existing, target, existing.getSnapshot().attempt, {
          skipLocalCache: false,
          regenerate: false,
        })
      }
      return existing
    }
    const session = new EclosionSession(
      appId,
      target.kind === 'basic'
        ? target.spec.specId
        : target.kind === 'imagine'
          ? appId.slice(ECLOSION_IMAGINE_ID_PREFIX.length)
          : target.slug,
    )
    this.sessions.set(appId, session)
    this.mirror(session)
    void this.runPipeline(session, target, { skipLocalCache: false, regenerate: false })
    return session
  }

  // ── 想象搜索（§7：L3 自由文本入口，SearchPalette 唯一调用方） ───────────

  /**
   * 取（或建）想象应用会话，返回 appId（调用方经 launchApp 开窗）。门禁三道：
   * 羽化开 + 已登录；客户端 filterContentText 非违规（§7：违规直接不生成，
   * 服务端 classifier 是第二道）；query trim 后非空。命中即返回 null——绝不
   * 触发网络，绝不阻塞桌面。
   *
   * appId = com.ageha.eclosion.imagine-<hash8>（确定性）：同一会话相同（含
   * 规范化同义的）query 复用同一会话，不发第二次请求（§7 会话内缓存）。
   */
  ensureImagineSession(rawQuery: string): string | null {
    const store = useEclosionStore.getState()
    if (!store.enabled || store.userId === null) return null
    const query = rawQuery.trim()
    if (query.length < 2 || !filterContentText(query).ok) return null
    const appId = imagineAppIdForQuery(query)
    if (getAppManifest(appId) === null) {
      const result = registerRuntimeApp({
        id: appId,
        name: query,
        version: '1.0.0',
        entry: ECLOSION_RUNNER_ENTRY,
        // L3 恒零权限（§4.1 第 4 条 Default Deny；SDK 逐请求拒绝）。
        permissions: [],
        window: ECLOSION_RUNTIME_DEFAULT_WINDOW,
      })
      if (!result.ok) return null
    }
    this.registeredImagineAppIds.add(appId)
    this.imagineQueries.set(appId, query)
    return this.ensureSession(appId) === null ? null : appId
  }

  /** 会话级想象清单注销（登出/stop；「获取」留存的注册面归 kept 生命周期）。 */
  private unregisterImagineApps(): void {
    for (const appId of [...this.registeredImagineAppIds]) {
      unregisterRuntimeApp(appId)
      this.registeredImagineAppIds.delete(appId)
    }
    this.imagineQueries.clear()
    this.imagineHtml.clear()
  }

  /** 关注者计数（宿主容器挂载时调用）。 */
  attach(appId: string): void {
    this.attachments.set(appId, (this.attachments.get(appId) ?? 0) + 1)
  }

  /**
   * 取消关注（宿主容器卸载）：无人关注且仍在生成 → AbortController 中止
   * （§5.3 客户端断开即中止，不空烧 token；预取持有期间不中止）。
   */
  detach(appId: string): void {
    const next = (this.attachments.get(appId) ?? 0) - 1
    if (next > 0) {
      this.attachments.set(appId, next)
      return
    }
    this.attachments.delete(appId)
    const snapshot = this.sessions.get(appId)?.getSnapshot()
    if (snapshot !== undefined && (snapshot.phase === 'queued' || snapshot.phase === 'generating')) {
      this.cancel(appId)
    }
  }

  /**
   * 「重新羽化」（§5.2/§6.4）：弃本地缓存重生成；结果覆盖本地缓存（服务端
   * 全局缓存不回写）。留存（kept）应用没有网络真身——管线回落快照重放。
   */
  regenerate(appId: string): EclosionSession | null {
    const session = this.sessions.get(appId)
    const target = this.resolveTarget(appId)
    if (!session || target === null) return this.ensureSession(appId)
    this.startAttempt(session, target, session.getSnapshot().attempt + 1, {
      skipLocalCache: true,
      regenerate: true,
    })
    return session
  }

  /**
   * 质量回退驱动（§5.2：宿主在 eclosion:error / 5 秒无 rendered 时调用）。
   * 返回 true = 已开始第二轮；false = 已终态回落（L1 落原生兜底，L2/kept
   * 由宿主渲染错误卡——它们没有原生真身可回）。
   */
  requestRetry(appId: string, reason: string): boolean {
    const session = this.sessions.get(appId)
    const target = this.resolveTarget(appId)
    if (!session || target === null) return false
    const snapshot = session.getSnapshot()
    if (snapshot.fellBack) return false
    const generationFailed = snapshot.phase === 'error'
    // 主动取消（关窗）不是失败：不发事件、不重试、不回落。
    if (generationFailed && snapshot.errorCode === 'aborted') return false
    if (snapshot.attempt >= ECLOSION_MAX_ATTEMPTS) {
      this.giveUp(session, target, reason)
      return false
    }
    if (generationFailed && !RETRYABLE_ERROR_CODES.has(snapshot.errorCode ?? '')) {
      this.giveUp(session, target, snapshot.errorCode ?? reason)
      return false
    }
    this.startAttempt(session, target, snapshot.attempt + 1, {
      // 上一轮内容已证不可用：跳过本地缓存，服务端 regenerate 绕开全局缓存。
      skipLocalCache: true,
      regenerate: true,
    })
    return true
  }

  /** 宿主收到 eclosion:rendered 后上报（每轮尝试至多一次）。 */
  reportRendered(appId: string): void {
    const session = this.sessions.get(appId)
    if (!session) return
    const snapshot = session.getSnapshot()
    if (snapshot.phase !== 'done' || snapshot.source === null) return
    systemBus.emit('eclosion.app.ready', {
      appId,
      specId: snapshot.specId,
      source: snapshot.source,
    })
  }

  /** 关窗即取消（§5.3：客户端断开即中止，不空烧 token）。 */
  cancel(appId: string): void {
    this.controllers.get(appId)?.abort()
  }

  private cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  /** Settings「清除羽化数据」：清当前用户名下全部生成产物。 */
  async clearData(): Promise<void> {
    const userId = useEclosionStore.getState().userId
    if (!userId) return
    await this.cache.clearUserData(userId)
  }

  // ── 今日世界（§6.2/§6.3：拉取、当日缓存、蝶谱、就绪事件） ────────────────

  /**
   * 拉取当日世界：羽化开 + 已登录才拉；当日缓存命中（store 摘要即今日）时
   * 不再发请求、只重播就绪事件（重登录/开关重开时主题与应用接线重跑）。
   * 校验失败/网络失败一律静默返回 false（不阻塞桌面）。
   */
  async refreshWorld(): Promise<boolean> {
    const store = useEclosionStore.getState()
    if (!store.enabled || store.userId === null) return false
    const today = utcDayKey()
    if (store.world?.worldDate === today) {
      // 当日缓存命中（重登录/开关重开）：重播就绪事件，并补运行时清单注册
      //（登出时已整体注销）。
      this.syncWorldApps(store.world)
      this.scheduleTodayPrefetch()
      this.announceWorld(store.world, 'cache')
      return true
    }
    try {
      const response = await this.fetcher(this.worldUrl, { credentials: 'same-origin' })
      if (!response.ok) return false
      const world = validateEclosionWorld(await response.json())
      if (world === null || world.worldDate !== today) return false
      const summary = toWorldSummary(world)
      useEclosionStore.getState().applyWorld(summary)
      this.syncWorldApps(summary)
      this.scheduleTodayPrefetch()
      await this.recordReplay(store.userId, summary)
      this.announceWorld(summary, 'llm')
      return true
    } catch {
      return false // AI 铁律：世界不可得时桌面照常（无今日世界）。
    }
  }

  /**
   * 个人重生成今日世界（§6.2/§11-1：全局共享 + 个人重生成耗 today 档额度）。
   * 服务端只写个人键；成功后与拉取同一落地路径（蝶谱同日覆盖）。
   */
  async regenerateWorld(): Promise<boolean> {
    const store = useEclosionStore.getState()
    if (!store.enabled || store.userId === null) return false
    try {
      const response = await this.fetcher(this.worldRegenerateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) return false
      const world = validateEclosionWorld(await response.json())
      if (world === null || world.worldDate !== utcDayKey()) return false
      const summary = toWorldSummary(world)
      useEclosionStore.getState().applyWorld(summary)
      this.syncWorldApps(summary)
      this.scheduleTodayPrefetch()
      await this.recordReplay(store.userId, summary)
      this.announceWorld(summary, 'llm')
      void this.refreshQuota()
      return true
    } catch {
      return false
    }
  }

  /** 世界就绪广播：主题/应用接线（world.ready）+ AI 决策事件（§3.2）。 */
  private announceWorld(summary: EclosionWorldSummary, source: 'llm' | 'cache'): void {
    systemBus.emit('eclosion.world.ready', { worldDate: summary.worldDate })
    systemBus.emit('ai.decision.performed', { domain: 'world', source })
  }

  /** 蝶谱写入（§8：每日一条、不存 HTML；同日已有则不重复写）。 */
  private async recordReplay(userId: string, summary: EclosionWorldSummary): Promise<void> {
    try {
      const existing = await this.cache.readReplay(userId, summary.worldDate)
      if (existing !== null) return
      await this.cache.writeReplay(userId, {
        worldDate: summary.worldDate,
        headline: summary.headline,
        paletteId: summary.paletteId,
        accentHue: summary.accentHue,
        apps: summary.apps.map(({ slug, name, hue, tagline, category }) => ({
          slug,
          name,
          hue,
          tagline,
          category,
        })),
        createdAt: new Date().toISOString(),
      })
    } catch {
      /* 缓存不可用：蝶谱缺条不阻塞世界 */
    }
  }

  // ── 今日应用落位（§6.4：运行时清单注册 / 按需生成 / 预取前 2） ──────────

  /**
   * 世界清单 → 运行时注册表（§3.2 AppRegistry）：manifest schema 冻结照旧，
   * 会话级注册（不进 INSTALLED_KEY）；跨日/个人重生成差异即时注销防陈旧。
   * L2 恒零权限（§4.1 第 4 条 Default Deny）。
   */
  private syncWorldApps(world: EclosionWorldSummary): void {
    const desired = new Set(world.apps.map((app) => ECLOSION_APP_ID_PREFIX + app.slug))
    for (const appId of [...this.registeredWorldAppIds]) {
      if (!desired.has(appId)) {
        unregisterRuntimeApp(appId)
        this.registeredWorldAppIds.delete(appId)
      }
    }
    for (const app of world.apps) {
      const appId = ECLOSION_APP_ID_PREFIX + app.slug
      if (this.registeredWorldAppIds.has(appId)) continue
      const result = registerRuntimeApp({
        id: appId,
        name: app.name,
        version: '1.0.0',
        entry: ECLOSION_RUNNER_ENTRY,
        permissions: [],
        window: { ...app.window, resizable: true },
      })
      if (result.ok) this.registeredWorldAppIds.add(appId)
    }
  }

  private unregisterWorldApps(): void {
    for (const appId of [...this.registeredWorldAppIds]) {
      unregisterRuntimeApp(appId)
      this.registeredWorldAppIds.delete(appId)
    }
  }

  /**
   * 空闲预取（§6.4：最多前 2 个；点击瓦片前常见款先备好，命中即秒开）。
   * 每 worldDate 只安排一次；串行占一个并发槽（照 prefetchMissing 先例）。
   */
  scheduleTodayPrefetch(): void {
    const { enabled, userId, world } = useEclosionStore.getState()
    if (!enabled || userId === null || world === null) return
    if (this.todayPrefetchedDate === world.worldDate) return
    this.todayPrefetchedDate = world.worldDate
    const firstTwo = world.apps.slice(0, 2).map((app) => ECLOSION_APP_ID_PREFIX + app.slug)
    const run = (): void => {
      void this.prefetchTodayApps(firstTwo)
    }
    if (typeof requestIdleCallback === 'function') {
      this.todayPrefetchIdleHandle = requestIdleCallback(run, { timeout: 10_000 })
    } else {
      this.todayPrefetchTimer = setTimeout(run, 2_000)
    }
  }

  private cancelTodayPrefetch(): void {
    if (this.todayPrefetchIdleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.todayPrefetchIdleHandle)
    }
    this.todayPrefetchIdleHandle = null
    if (this.todayPrefetchTimer !== null) clearTimeout(this.todayPrefetchTimer)
    this.todayPrefetchTimer = null
  }

  private async prefetchTodayApps(appIds: readonly string[]): Promise<void> {
    const { enabled, userId } = useEclosionStore.getState()
    if (!enabled || userId === null) return
    for (const appId of appIds) {
      if (this.gaveUp.has(appId)) continue
      this.attach(appId) // 预取持有：宿主短暂关窗不打断后台生成
      try {
        const session = this.ensureSession(appId)
        if (!session) continue
        await session.settled()
      } finally {
        this.detach(appId)
      }
    }
  }

  // ── 「获取」留存（§6.4/§8：kept 快照 + 「我的羽化」清单，P3 想象域复用） ──

  /** 登录恢复：kept store 是跨重启的持久事实源 → 运行时注册 + store 镜像。 */
  private async restoreKeptApps(userId: string): Promise<void> {
    try {
      const kept = await this.cache.listKept(userId)
      const ids: string[] = []
      for (const entry of kept) {
        // 已作为今日应用在册（同 id 双源）时注册会撞——清单照收，注册留世界侧。
        registerRuntimeApp({
          id: entry.appId,
          name: entry.name,
          version: '1.0.0',
          entry: ECLOSION_RUNNER_ENTRY,
          permissions: [],
          window: ECLOSION_RUNTIME_DEFAULT_WINDOW,
        })
        this.keptAppIds.add(entry.appId)
        ids.push(entry.appId)
      }
      useEclosionStore.getState().setKeptAppIds(ids)
    } catch {
      /* 缓存不可用：本会话无「我的羽化」，不阻塞桌面 */
    }
  }

  private unregisterKeptApps(): void {
    for (const appId of [...this.keptAppIds]) {
      unregisterRuntimeApp(appId)
      this.keptAppIds.delete(appId)
    }
    useEclosionStore.getState().setKeptAppIds([])
  }

  private syncKeptMirror(): void {
    useEclosionStore.getState().setKeptAppIds([...this.keptAppIds])
  }

  /**
   * 「获取」（§6.4/§7）：把应用 HTML 快照留入 kept（≤30 LRU，userId 分区）并
   * 注册清单——「我的羽化」跨重启可用。今日应用源 = 当日 today 缓存；想象应用
   * 源 = 会话内存里的生成全文（§8）。源不在（未生成/已清理）时返回 false，
   * 绝不触发新的生成。
   */
  async keepApp(appId: string): Promise<boolean> {
    const store = useEclosionStore.getState()
    if (store.userId === null) return false
    if (this.keptAppIds.has(appId)) return true
    if (eclosionAppKind(appId) === 'imagine') {
      const html = this.imagineHtml.get(appId)
      if (html === undefined) return false
      const name = this.imagineQueries.get(appId) ?? appId
      await this.cache.writeKept(store.userId, {
        appId,
        name,
        html,
        createdAt: new Date().toISOString(),
      })
      if (getAppManifest(appId) === null) {
        registerRuntimeApp({
          id: appId,
          name,
          version: '1.0.0',
          entry: ECLOSION_RUNNER_ENTRY,
          permissions: [],
          window: ECLOSION_RUNTIME_DEFAULT_WINDOW,
        })
      }
      this.keptAppIds.add(appId)
      this.syncKeptMirror()
      return true
    }
    const slug = appId.slice(ECLOSION_APP_ID_PREFIX.length)
    const world = store.world
    if (world === null) return false
    const entry = await this.cache.readToday(store.userId, world.worldDate, slug).catch(() => null)
    if (entry === null) return false
    const row = world.apps.find((app) => app.slug === slug)
    await this.cache.writeKept(store.userId, {
      appId,
      name: row?.name ?? slug,
      html: entry.html,
      ...(row ? { hue: row.hue } : {}),
      createdAt: new Date().toISOString(),
    })
    if (!this.registeredWorldAppIds.has(appId)) {
      registerRuntimeApp({
        id: appId,
        name: row?.name ?? slug,
        version: '1.0.0',
        entry: ECLOSION_RUNNER_ENTRY,
        permissions: [],
        window: row ? { ...row.window, resizable: true } : ECLOSION_RUNTIME_DEFAULT_WINDOW,
      })
    }
    this.keptAppIds.add(appId)
    this.syncKeptMirror()
    return true
  }

  /** 卸载留存（§8 可卸载）：删 kept 记录 + 注销清单（仍是今日应用时保留注册）。 */
  async unkeepApp(appId: string): Promise<boolean> {
    const userId = useEclosionStore.getState().userId
    if (userId === null || !this.keptAppIds.has(appId)) return false
    await this.cache.deleteKept(userId, appId)
    this.keptAppIds.delete(appId)
    if (!this.registeredWorldAppIds.has(appId)) unregisterRuntimeApp(appId)
    this.syncKeptMirror()
    return true
  }

  // ── 举报与会话封禁（§10 P4：ADR 22 样本链路 + 本地封禁） ─────────────────

  /** 蝶谱清单（§8：Settings 时间线数据源；未登录/缓存不可用返回空）。 */
  async listReplay(): Promise<EclosionReplayEntry[]> {
    const userId = useEclosionStore.getState().userId
    if (userId === null) return []
    return this.cache.listReplay(userId).catch(() => [])
  }

  /**
   * 组装举报载荷（§10）：text = 应用名/tagline/query 组合摘要（≤512），
   * detail = 生成全文前 2KB（≤2048）。来源按分域取：L1 规格表名 + basic 缓存；
   * 今日应用 = 世界行 name/tagline + today 缓存；想象应用 = 会话内 query 与
   * 生成全文（§8 只存内存）；留存 = kept 快照。任一来源拿不到生成内容 → null
   * （没见过内容就没有可举报的证据，绝不触发新的生成）。
   */
  async buildReportPayload(
    appId: string,
  ): Promise<{ text: string; source: 'eclosion'; detail: string } | null> {
    const userId = useEclosionStore.getState().userId
    if (userId === null) return null
    const target = this.resolveTarget(appId)
    if (target === null) return null

    const parts: string[] = []
    let html: string | null = null
    if (target.kind === 'basic') {
      parts.push(translate(getLocale(), target.spec.titleKey))
      html =
        (
          await this.cache
            .readBasic(userId, target.spec.specId, target.spec.specVersion)
            .catch(() => null)
        )?.html ?? null
    } else if (target.kind === 'today') {
      const row = useEclosionStore.getState().world?.apps.find((app) => app.slug === target.slug)
      if (row) parts.push(row.name, row.tagline)
      else parts.push(target.slug)
      html =
        (
          await this.cache.readToday(userId, target.worldDate, target.slug).catch(() => null)
        )?.html ?? null
    } else if (target.kind === 'imagine') {
      parts.push(target.query)
      html = this.imagineHtml.get(appId) ?? null
    } else {
      const kept = await this.cache.readKept(userId, appId).catch(() => null)
      if (kept !== null) {
        parts.push(kept.name)
        html = kept.html
      }
    }
    // 今日/想象会话已过期（跨日/重启）：留存快照是最后的内容来源。
    if (html === null) {
      const kept = await this.cache.readKept(userId, appId).catch(() => null)
      if (kept !== null) {
        if (parts.length === 0) parts.push(kept.name)
        html = kept.html
      }
    }
    if (html === null || html === '') return null
    const text = parts.filter((part) => part !== '').join(' · ').slice(0, REPORT_TEXT_MAX_LENGTH)
    if (text === '') return null
    return { text, source: 'eclosion', detail: html.slice(0, REPORT_DETAIL_MAX_LENGTH) }
  }

  /**
   * 举报（§10）：宿主同意框确认后调用。上报走既有匿名样本链路（ADR 22，
   * POST /api/dynamic/samples）；成功后本地立即封禁该会话 + 关窗 + 发
   * eclosion.app.reported（预留键，ADR 4）。失败（网络/4xx/无内容来源）返回
   * false——不封禁、不关窗，用户可重试。幂等：已封禁直接 true。
   */
  async reportApp(appId: string, windowId: string): Promise<boolean> {
    if (this.bannedAppIds.has(appId)) return true
    const payload = await this.buildReportPayload(appId)
    if (payload === null) return false
    try {
      const response = await this.fetcher(this.sampleReportUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) return false
    } catch {
      return false // 上传失败：样本没进复审队列，保持现状可重试
    }
    this.cancel(appId) // 仍在生成则中止（不空烧 token）
    this.bannedAppIds.add(appId)
    useEclosionStore.getState().setBannedAppIds([...this.bannedAppIds])
    useWindowStore.getState().close(windowId)
    systemBus.emit('eclosion.app.reported', { appId, windowId })
    return true
  }

  // ── 生成管线 ────────────────────────────────────────────────────────────

  private startAttempt(
    session: EclosionSession,
    target: EclosionTarget,
    attempt: number,
    options: PipelineOptions,
  ): void {
    this.controllers.get(session.appId)?.abort()
    session.commit({
      phase: 'queued',
      attempt,
      thinkChars: 0,
      chunks: [],
      scripts: [],
      source: null,
      errorCode: null,
      passwordInputSeen: false,
      fellBack: false,
    })
    this.gaveUp.delete(session.appId)
    this.mirror(session)
    void this.runPipeline(session, target, options)
  }

  private async runPipeline(
    session: EclosionSession,
    target: EclosionTarget,
    options: PipelineOptions,
  ): Promise<void> {
    const store = useEclosionStore.getState()
    if (!store.enabled || store.userId === null) {
      this.failSession(session, 'not-authenticated')
      return
    }
    const userId = store.userId

    // 缓存命中：一次性切分全部内容，秒开（§4.2 缓存命中跳过流式 2–3）。
    if (target.kind === 'basic') {
      if (!options.skipLocalCache) {
        try {
          const entry = await this.cache.readBasic(
            userId,
            target.spec.specId,
            target.spec.specVersion,
          )
          if (entry !== null) {
            this.serveFromCache(session, entry.html)
            return
          }
        } catch {
          /* 缓存不可用：照常走网络 */
        }
      }
    } else if (target.kind === 'today') {
      // 当日缓存（§6.4：当日内同一应用重开走缓存）。skipLocalCache 仅重新
      // 羽化时为真——那时既有内容已证不可用。
      if (!options.skipLocalCache) {
        const entry = await this.cache
          .readToday(userId, target.worldDate, target.slug)
          .catch(() => null)
        if (entry !== null) {
          this.serveFromCache(session, entry.html)
          return
        }
      }
    } else if (target.kind === 'imagine') {
      // §8：想象应用 HTML 只存内存（会话级）——会话对象本身就是缓存，
      // ensureSession 的复用已保证同 query 不发第二次请求；无 IndexedDB 层。
    } else {
      // 留存快照是唯一真身：只读 kept 缓存，绝不走网络（§8）。skipLocalCache
      // 对它无意义（重新羽化 = 重放快照）。
      const entry = await this.cache.readKept(userId, target.appId).catch(() => null)
      if (entry !== null) {
        this.serveFromCache(session, entry.html)
      } else {
        this.failSession(session, 'unknown-app')
      }
      return
    }

    // 并发闸（§5.4：同一用户最多 2 个流，超出排队）。
    if (this.active >= this.concurrency) {
      session.commit({ phase: 'queued' })
      this.mirror(session)
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve)
      })
    } else {
      this.active += 1
    }

    try {
      await this.streamGeneration(session, target, userId, options)
    } finally {
      this.releaseSlot()
    }
  }

  private releaseSlot(): void {
    const next = this.waiting.shift()
    if (next) next() // 槽位直接移交给队首
    else this.active = Math.max(0, this.active - 1)
  }

  private serveFromCache(session: EclosionSession, html: string): void {
    const splitter = createHtmlStreamSplitter()
    const chunks = [...splitter.push(html), ...splitter.flush()]
    session.commit({
      phase: 'done',
      chunks,
      scripts: splitter.scripts(),
      source: 'cache',
      thinkChars: 0,
      // §10 密码框警示对缓存秒开同样生效：缓存存的是生成全文（与网络路径
      // 扫描的 rawHtml 同一份输入），重开/重启后警示不得消失。
      passwordInputSeen: PASSWORD_INPUT_PATTERN.test(html),
    })
    this.mirror(session)
    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'cache' })
  }

  private async streamGeneration(
    session: EclosionSession,
    target: EclosionTarget,
    userId: string,
    options: PipelineOptions,
  ): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(session.appId, controller)
    session.commit({ phase: 'generating' })
    this.mirror(session)
    systemBus.emit('eclosion.app.generating', { appId: target.appId, specId: session.specId })

    const body: GenerateRequestBody =
      target.kind === 'basic'
        ? {
            kind: 'basic',
            specId: target.spec.specId,
            locale: getLocale(),
            theme: this.hostTheme(),
            regenerate: options.regenerate,
          }
        : target.kind === 'today'
          ? {
              kind: 'today',
              worldDate: target.worldDate,
              slug: target.slug,
              locale: getLocale(),
              theme: this.hostTheme(),
              regenerate: options.regenerate,
            }
          : target.kind === 'imagine'
            ? {
                kind: 'imagine',
                query: target.query,
                locale: getLocale(),
                theme: this.hostTheme(),
                regenerate: options.regenerate,
              }
            : {
                // kept 只在缓存命中路径被服务（runPipeline 早退）；此分支不可达，
                // 仅为满足请求体类型而保留。
                kind: 'today',
                worldDate: '',
                slug: target.slug,
                locale: getLocale(),
                theme: this.hostTheme(),
                regenerate: options.regenerate,
              }

    const splitter = createHtmlStreamSplitter()
    const parser: SseParser = createSseParser()
    let rawHtml = ''
    let thinkChars = 0
    let finished = false
    let aborted = false

    const consumeDelta = (text: string): void => {
      rawHtml += text
      session.commit({
        chunks: [...session.getSnapshot().chunks, ...splitter.push(text)],
        passwordInputSeen: PASSWORD_INPUT_PATTERN.test(rawHtml),
      })
    }

    try {
      const response = await this.fetcher(this.generateUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        let code = `http-${response.status}`
        try {
          const payload = (await response.json()) as { error?: unknown }
          if (typeof payload.error === 'string') code = payload.error
        } catch {
          /* 非 JSON 错误体：保留 http-<status> */
        }
        this.failSession(session, code)
        return
      }
      if (!response.body) {
        this.failSession(session, 'ai-upstream')
        return
      }

      const handleFrame = (frame: { event: string; data: string }): void => {
        if (frame.event === 'think') {
          const chars = readNumber(frame.data, 'chars')
          if (chars !== null) {
            thinkChars = chars
            session.commit({ thinkChars })
          }
          return
        }
        if (frame.event === 'delta') {
          const text = readString(frame.data, 'text')
          if (text !== null && text !== '') consumeDelta(text)
          return
        }
        if (frame.event === 'done') {
          // 服务端已在 done 前冲净 holdback；截流侧再 flush 一次兜底。
          session.commit({ chunks: [...session.getSnapshot().chunks, ...splitter.flush()] })
          finished = true
          return
        }
        if (frame.event === 'error') {
          const code = readString(frame.data, 'code') ?? 'ai-upstream'
          finished = true
          this.failSession(session, code)
          return
        }
        // meta： requestId/model 不消费。
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          handleFrame(frame)
        }
        if (finished) {
          // error 帧提前停读：释放连接（服务端可能仍在写）。
          await reader.cancel().catch(() => undefined)
          break
        }
      }
      if (!finished && session.getSnapshot().phase === 'generating') {
        for (const frame of parser.close()) handleFrame(frame)
      }
      if (!finished) {
        // 流断在半途（无 done/error 帧）。
        this.failSession(session, 'network')
        return
      }
      if (session.getSnapshot().phase !== 'done' && session.getSnapshot().phase !== 'error') {
        this.succeedSession(session, target, userId, rawHtml, splitter)
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        aborted = true
        this.failSession(session, 'aborted')
        return
      }
      this.failSession(session, 'network')
      return
    } finally {
      this.controllers.delete(session.appId)
      // 主动取消（关窗）不刷额度；其余终态刷新快照供 Settings 展示。
      if (!aborted) void this.refreshQuota()
    }
  }

  private succeedSession(
    session: EclosionSession,
    target: EclosionTarget,
    userId: string,
    rawHtml: string,
    splitter: { scripts(): string[] },
  ): void {
    session.commit({
      phase: 'done',
      scripts: splitter.scripts(),
      source: 'network',
    })
    this.mirror(session)
    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'llm' })
    // 本地缓存：重新羽化结果同样覆盖（重开即用新版本；§9.2 的「不进全局缓存」
    // 是服务端侧语义）。按分域落 store：basic=按规格版本失效；today=按日分区；
    // imagine 只存会话内存（§8），重开靠会话快照、「获取」留存靠 imagineHtml。
    if (target.kind === 'basic') {
      void this.cache.writeBasic(userId, {
        appId: target.appId,
        specId: target.spec.specId,
        specVersion: target.spec.specVersion,
        html: rawHtml,
        createdAt: new Date().toISOString(),
      })
    } else if (target.kind === 'today') {
      void this.cache.writeToday(userId, {
        appId: target.appId,
        worldDate: target.worldDate,
        slug: target.slug,
        html: rawHtml,
        createdAt: new Date().toISOString(),
      })
    } else if (target.kind === 'imagine') {
      this.imagineHtml.set(target.appId, rawHtml)
    }
  }

  private failSession(session: EclosionSession, code: string): void {
    session.commit({ phase: 'error', errorCode: code })
    this.mirror(session)
    if (code !== 'aborted') void this.refreshQuota()
  }

  /** 重试后仍失败：终态回落（§5.2）。事件与通知（重试后仍失败才发）从这里出。 */
  private giveUp(session: EclosionSession, target: EclosionTarget, reason: string): void {
    this.gaveUp.add(session.appId)
    session.commit({ fellBack: true, errorCode: session.getSnapshot().errorCode ?? reason })
    this.mirror(session)
    systemBus.emit('eclosion.app.failed', {
      appId: target.appId,
      specId: session.specId,
      reason,
    })
    systemBus.emit('ai.decision.performed', { domain: 'app', source: 'local' })
  }

  private mirror(session: EclosionSession): void {
    const snapshot = session.getSnapshot()
    useEclosionStore.getState().setStatus(session.appId, {
      phase: snapshot.phase,
      thinkChars: snapshot.thinkChars,
      attempt: snapshot.attempt,
      errorCode: snapshot.errorCode,
      fellBack: snapshot.fellBack,
      passwordInputSeen: snapshot.passwordInputSeen,
    })
  }

  private hostTheme(): 'light' | 'dark' {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark'
    }
    return 'light'
  }

  // ── 额度与预取 ──────────────────────────────────────────────────────────

  async refreshQuota(): Promise<void> {
    const userId = useEclosionStore.getState().userId
    if (!userId) return
    const unconfigured: EclosionQuotaState = {
      configured: false,
      basic: { used: 0, limit: 10 },
      today: { used: 0, limit: 30 },
      imagine: { used: 0, limit: 20 },
      resetAtIso: null,
    }
    try {
      const response = await this.fetcher(this.quotaUrl, { credentials: 'same-origin' })
      if (!response.ok) {
        useEclosionStore.getState().applyQuota(unconfigured)
        return
      }
      const payload = (await response.json()) as {
        configured?: unknown
        quotas?: Record<'basic' | 'today' | 'imagine', { used?: unknown; limit?: unknown } | undefined>
        resetAtIso?: unknown
      }
      const tiers = payload.quotas
      const readTier = (tier: 'basic' | 'today' | 'imagine') =>
        typeof tiers?.[tier]?.used === 'number' && typeof tiers?.[tier]?.limit === 'number'
          ? { used: tiers[tier]!.used as number, limit: tiers[tier]!.limit as number }
          : null
      const basic = readTier('basic')
      const today = readTier('today')
      const imagine = readTier('imagine')
      if (typeof payload.configured !== 'boolean' || !basic || !today || !imagine) {
        useEclosionStore.getState().applyQuota(unconfigured)
        return
      }
      useEclosionStore.getState().applyQuota({
        configured: payload.configured,
        basic,
        today,
        imagine,
        resetAtIso: typeof payload.resetAtIso === 'string' ? payload.resetAtIso : null,
      })
    } catch {
      useEclosionStore.getState().applyQuota(unconfigured)
    }
  }

  /** 登录后空闲期按顺序预取三件套（§5.2：开关开且缓存缺失时）。 */
  schedulePrefetch(): void {
    const { enabled, userId, quota } = useEclosionStore.getState()
    if (!enabled || userId === null) return
    if (quota !== null && !quota.configured) return
    if (this.prefetchScheduled) return
    this.prefetchScheduled = true
    const run = (): void => {
      this.prefetchScheduled = false
      void this.prefetchMissing()
    }
    if (typeof requestIdleCallback === 'function') {
      this.prefetchIdleHandle = requestIdleCallback(run, { timeout: 10_000 })
    } else {
      this.prefetchTimer = setTimeout(run, 2_000)
    }
  }

  private cancelScheduledPrefetch(): void {
    if (this.prefetchIdleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.prefetchIdleHandle)
    }
    this.prefetchIdleHandle = null
    if (this.prefetchTimer !== null) clearTimeout(this.prefetchTimer)
    this.prefetchTimer = null
    this.prefetchScheduled = false
  }

  /** 顺序预取（每时刻至多占用一个并发槽）。 */
  async prefetchMissing(): Promise<void> {
    const { enabled, userId } = useEclosionStore.getState()
    if (!enabled || userId === null) return
    for (const spec of BASIC_ECLOSION_SPECS) {
      if (this.gaveUp.has(spec.appId)) continue
      const cached = await this.cache
        .readBasic(userId, spec.specId, spec.specVersion)
        .catch(() => null)
      if (cached !== null) continue
      this.attach(spec.appId) // 预取持有：宿主短暂关窗不打断后台生成
      try {
        const session = this.ensureSession(spec.appId)
        if (!session) continue
        await session.settled()
      } finally {
        this.detach(spec.appId)
      }
    }
  }
}

function readNumber(data: string, field: string): number | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    return typeof parsed[field] === 'number' ? (parsed[field] as number) : null
  } catch {
    return null
  }
}

function readString(data: string, field: string): string | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    return typeof parsed[field] === 'string' ? (parsed[field] as string) : null
  } catch {
    return null
  }
}

/** 校验后的世界载荷 → store 摘要（§3.1：大对象不进 store；hint 已在校验层剥除）。 */
function toWorldSummary(world: EclosionWorld): EclosionWorldSummary {
  return {
    worldDate: world.worldDate,
    headline: world.theme.headline,
    paletteId: world.theme.paletteId,
    accentHue: world.theme.accentHue,
    degraded: world.degraded,
    signalCount: world.signalCount,
    signals: world.signals,
    apps: world.apps.map(({ slug, name, hue, tagline, category, window }) => ({
      slug,
      name,
      hue,
      tagline,
      category,
      window,
    })),
  }
}

/** 装配单例（main.tsx 装配链尾追加 start()）。 */
export const systemEclosion = new EclosionOrchestrator()
