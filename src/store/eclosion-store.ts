import { create } from 'zustand'

/**
 * 羽化模式状态（AI-GENERATED-APPS-DESIGN §3.1：开关、生成状态、额度）。
 *
 * - 总开关默认关（§11 待决 4 默认裁决）；显式偏好按 userId 分键持久化
 *   （`agehaos.eclosion.prefs.v1.<userId>`，照 dynamic-desktop-store 范式），
 *   登出不清偏好（§8：同设备再登录可秒开）。
 * - 生成状态（statuses）是 services/eclosion.ts 会话的**粗粒度镜像**：分片
 *   HTML/脚本等大对象不进 store（序列化负担），宿主容器直接订阅会话快照；
 *   镜像供 Settings / 标题栏徽标等观察者消费。
 */

export const ECLOSION_KEY_PREFIX = 'agehaos.eclosion.prefs.v1.'

/** 基础软件生成方式（Settings「羽化」区；默认羽化，总开关开时生效）。 */
export type EclosionGenerateMode = 'eclosion' | 'classic'

export type EclosionAppPhase = 'queued' | 'generating' | 'done' | 'error'

/** 单个羽化应用的生成状态镜像（宿主/设置区共享的观察面）。 */
export interface EclosionAppStatus {
  appId: string
  phase: EclosionAppPhase
  /** think 事件累计思考字数（「结茧中…（思考 N 字）」）。 */
  thinkChars: number
  /** 尝试轮次（1 起；重试/重新羽化递增）。 */
  attempt: number
  errorCode: string | null
  /** 重试后仍失败、已回落原生实现（通知桥只通知这一态）。 */
  fellBack: boolean
  /** 宿主侧安全扫描：生成内容出现 password 输入框（标题栏红色警示）。 */
  passwordInputSeen: boolean
}

/** 单档生成额度（used/limit；服务端 quota.ts 三档同形）。 */
export interface EclosionKindQuota {
  used: number
  limit: number
}

/** GET /api/eclosion/quota 快照（Settings 展示；configured=false 时开关置灰）。 */
export interface EclosionQuotaState {
  configured: boolean
  basic: EclosionKindQuota
  /** L2 今日应用档（含个人世界重生成，2026-10-02 裁决）。 */
  today: EclosionKindQuota
  /** L3 想象搜索档。 */
  imagine: EclosionKindQuota
  resetAtIso: string | null
}

/** 今日世界摘要（AI-GENERATED-APPS-DESIGN §6）：编排器校验后写入，右栏世界卡信号行（Shell 3.1 STEP 3
 * 自顶栏迁入）、Settings、主题接入消费。大对象（hint、HTML、完整 signals 原文）不进 store。 */
export interface EclosionWorldSummary {
  worldDate: string
  headline: string
  paletteId: string
  accentHue: number
  degraded: boolean
  signalCount: number
  signals: { titles: readonly string[]; sourceName: string; sourceUrl: string }
  apps: ReadonlyArray<{
    slug: string
    name: string
    hue: number
    tagline: string
    category: string
    window: { width: number; height: number }
  }>
}

interface EclosionState {
  userId: string | null
  /** 羽化模式总开关（默认关；§9.3 仅远程认证模式可开，Settings 侧把关）。 */
  enabled: boolean
  /** 基础软件生成方式（键 = specId；缺省即「羽化」）。 */
  modes: Record<string, EclosionGenerateMode>
  /** 「主题跟随今日世界」（§6.3，默认开；仅总开关开启时生效）。 */
  themeFollow: boolean
  /** 今日世界摘要（null = 未就绪/羽化关闭；跨日由编排器换新）。 */
  world: EclosionWorldSummary | null
  /** 「今日世界已就绪」通知去重：每个 worldDate 至多一条（§3.2 通知中心）。 */
  notifiedWorldDate: string | null
  /** 「获取」留存清单镜像（§6.4/§8：编排器写入，启动器「我的羽化」消费）。 */
  keptAppIds: readonly string[]
  /**
   * 举报后会话封禁镜像（§10 P4：编排器内存级 Set 的事实源写入，登出清空、
   * 不持久化）。宿主容器据此渲染封禁卡（无重试）。
   */
  bannedAppIds: readonly string[]
  quota: EclosionQuotaState | null
  statuses: Record<string, EclosionAppStatus>

  hydrateForUser: (userId: string | null) => void
  setEnabled: (enabled: boolean) => void
  setGenerateMode: (specId: string, mode: EclosionGenerateMode) => void
  setThemeFollow: (themeFollow: boolean) => void
  /** 编排器写入世界摘要（校验后的结构化数据）。 */
  applyWorld: (world: EclosionWorldSummary) => void
  markWorldNotified: (worldDate: string) => void
  /** 编排器写入留存清单镜像（登录恢复 keepApp/unkeepApp 后调用）。 */
  setKeptAppIds: (appIds: readonly string[]) => void
  /** 编排器写入封禁镜像（举报成功后调用；登出/hydrate 整体重置）。 */
  setBannedAppIds: (appIds: readonly string[]) => void
  applyQuota: (quota: EclosionQuotaState) => void
  /** 编排器写入会话镜像（patch 合并；appId 不存在则建档）。 */
  setStatus: (appId: string, patch: Partial<EclosionAppStatus>) => void
  /** 「清除羽化数据」：清空全部会话镜像（C2 审查，与内存会话同步）。 */
  clearStatuses: () => void
  handleLogout: () => void
}

function storageKey(userId: string): string {
  return `${ECLOSION_KEY_PREFIX}${userId}`
}

function sanitizeModes(value: unknown): Record<string, EclosionGenerateMode> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, EclosionGenerateMode> = {}
  for (const [specId, mode] of Object.entries(value as Record<string, unknown>)) {
    if ((mode === 'eclosion' || mode === 'classic') && specId.length <= 64) {
      out[specId] = mode
    }
  }
  return out
}

function loadPersisted(userId: string): {
  enabled: boolean
  modes: Record<string, EclosionGenerateMode>
  themeFollow: boolean
} {
  if (typeof localStorage === 'undefined') return { enabled: false, modes: {}, themeFollow: true }
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return { enabled: false, modes: {}, themeFollow: true }
    const parsed = JSON.parse(raw) as { enabled?: unknown; modes?: unknown; themeFollow?: unknown }
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      modes: sanitizeModes(parsed.modes),
      // 老偏好无此字段 → 默认开（§6.3）。
      themeFollow: typeof parsed.themeFollow === 'boolean' ? parsed.themeFollow : true,
    }
  } catch {
    return { enabled: false, modes: {}, themeFollow: true }
  }
}

function persist(state: EclosionState): void {
  if (typeof localStorage === 'undefined' || state.userId === null) return
  try {
    localStorage.setItem(
      storageKey(state.userId),
      JSON.stringify({ enabled: state.enabled, modes: state.modes, themeFollow: state.themeFollow }),
    )
  } catch {
    /* quota or privacy mode: stay in memory */
  }
}

const INITIAL_STATUS: Omit<EclosionAppStatus, 'appId'> = {
  phase: 'queued',
  thinkChars: 0,
  attempt: 1,
  errorCode: null,
  fellBack: false,
  passwordInputSeen: false,
}

export const useEclosionStore = create<EclosionState>()((set, get) => ({
  userId: null,
  enabled: false,
  modes: {},
  themeFollow: true,
  world: null,
  notifiedWorldDate: null,
  keptAppIds: [],
  bannedAppIds: [],
  quota: null,
  statuses: {},

  hydrateForUser: (userId) => {
    if (userId === null) {
      set({
        userId: null,
        enabled: false,
        modes: {},
        themeFollow: true,
        world: null,
        notifiedWorldDate: null,
        keptAppIds: [],
        bannedAppIds: [],
        quota: null,
        statuses: {},
      })
      return
    }
    const persisted = loadPersisted(userId)
    set({
      userId,
      enabled: persisted.enabled,
      modes: persisted.modes,
      themeFollow: persisted.themeFollow,
      // 世界是会话级拉取产物（编排器登录后 GET /world），hydrate 不恢复。
      world: null,
      notifiedWorldDate: null,
      keptAppIds: [],
      bannedAppIds: [],
      quota: null,
      statuses: {},
    })
  },

  setEnabled: (enabled) => {
    set({ enabled })
    persist(get())
  },

  setGenerateMode: (specId, mode) => {
    set({ modes: { ...get().modes, [specId]: mode } })
    persist(get())
  },

  setThemeFollow: (themeFollow) => {
    set({ themeFollow })
    persist(get())
  },

  applyWorld: (world) => set({ world }),

  markWorldNotified: (worldDate) => set({ notifiedWorldDate: worldDate }),

  setKeptAppIds: (appIds) => set({ keptAppIds: appIds }),

  clearStatuses: () => set({ statuses: {} }),

  setBannedAppIds: (appIds) => set({ bannedAppIds: appIds }),

  applyQuota: (quota) => set({ quota }),

  setStatus: (appId, patch) => {
    const current = get().statuses[appId] ?? { appId, ...INITIAL_STATUS }
    set({ statuses: { ...get().statuses, [appId]: { ...current, ...patch } } })
  },

  handleLogout: () => {
    // 偏好按用户保留（§8）；会话级生成状态/世界/额度/封禁清空。
    set({
      userId: null,
      enabled: false,
      modes: {},
      themeFollow: true,
      world: null,
      notifiedWorldDate: null,
      keptAppIds: [],
      bannedAppIds: [],
      quota: null,
      statuses: {},
    })
  },
}))

/** 测试间隔离：清持久键 + 回出厂态（坑 9）。 */
export function resetEclosionStore(): void {
  if (typeof localStorage !== 'undefined') {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(ECLOSION_KEY_PREFIX)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  }
  useEclosionStore.setState({
    userId: null,
    enabled: false,
    modes: {},
    themeFollow: true,
    world: null,
    notifiedWorldDate: null,
    keptAppIds: [],
    bannedAppIds: [],
    quota: null,
    statuses: {},
  })
}

/** 测试种子：认证用户 + 指定开关（不产生持久化副作用）。 */
export function seedEclosionForTests(userId: string, enabled: boolean): void {
  useEclosionStore.setState({ userId, enabled })
}
