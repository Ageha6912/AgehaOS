import { systemBus } from '@/core/events'
import { utcDayKey } from '@/core/eclosion/world'
import { buildContextSnapshot, resetContextVersion } from '@/core/dynamic/context/snapshot'
import { sliderBand } from '@/core/dynamic/decision/engine'
import type { Emit } from '@/core/dynamic/generative/pipeline'
import { generateWallpaper } from '@/core/dynamic/generative/pipeline'
import { deriveSessionSeed } from '@/core/dynamic/generative/seed'
import type { TierSignals } from '@/core/dynamic/governance/tier'
import { lastGoodPlanOf, loadHistory, saveHistory } from '@/core/dynamic/history'
import type { GenerationOutcome, RandomnessBand } from '@/core/dynamic/types'
import {
  MANUAL_REFRESH_THROTTLE_MS,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { useEclosionStore, type EclosionWorldSummary } from '@/store/eclosion-store'
import { useSessionStore } from '@/store/session-store'
import {
  applyWorldAccent,
  buildWorldWallpaperPlan,
  clearWorldAccent,
  isWorldThemeActive,
} from './world-theme'
import { systemVfs } from './vfs'

/**
 * 动态桌面装配单例（设计文档 §3.2）：追加在 main.tsx 既有装配链之后，
 * 不改变既有启动顺序。职责：登录/登出联动、触发生成管线、历史元数据落盘。
 * 状态归 dynamic-desktop-store，管线归 core——本单例只做编排。
 */

let sessionCounter = 0
let started = false
let unsubscribes: Array<() => void> = []
let renewalTimer: number | null = null
let themeObserver: MutationObserver | null = null

/** 随机度档 → 自动换新间隔（分钟；fixed=不自动，Phase A.5 接线 §12.3 缓办项）。 */
export const RENEWAL_MINUTES: Record<RandomnessBand, number> = {
  fixed: 0,
  fine: 15,
  balanced: 10,
  explore: 6,
  wild: 3,
}

const RENEWAL_TICK_MS = 30_000

function resolvedTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark'
  }
  return 'light'
}

/** 能力探测（PRD §31）：任一探测失败都安全回落。 */
function readTierSignals(): TierSignals {
  let hasWebGL2: boolean
  try {
    hasWebGL2 =
      typeof document !== 'undefined' &&
      document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    hasWebGL2 = false
  }
  const nav = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { deviceMemory?: number })
    : undefined
  return {
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    hasWebGL2,
  }
}

async function handleLogin(userId: string): Promise<void> {
  const store = useDynamicDesktopStore.getState()
  store.hydrateForUser(userId)
  resetContextVersion()
  sessionCounter += 1
  try {
    await systemVfs.ready()
  } catch {
    /* VFS 不可用时历史留空，兜底链仍完整（§9.2 VFS 落盘失败行） */
  }
  useDynamicDesktopStore.getState().setHistory(await loadHistory(systemVfs))
  await generate('login')
}

/** 历史落盘（生成与世界主题共用；失败仅存内存，§9.2）。 */
async function persistHistory(): Promise<void> {
  try {
    await saveHistory(systemVfs, useDynamicDesktopStore.getState().history)
  } catch {
    /* VFS 不可用时跳过落盘：不阻塞桌面 */
  }
}

async function generate(trigger: 'login' | 'timer' | 'manual'): Promise<GenerationOutcome | null> {
  const state = useDynamicDesktopStore.getState()
  if (!state.prefs.enabled || state.generating) return null
  // 铁律 1：固定即短路整条生成链，仅展示固定项。
  if (state.prefs.pinned) {
    useDynamicDesktopStore.setState({ currentPlan: state.prefs.pinned, currentLevel: 'L0' })
    return null
  }
  if (trigger === 'manual' && Date.now() - state.lastGenerateAt < MANUAL_REFRESH_THROTTLE_MS) {
    return null
  }
  state.setGenerating(true)
  try {
    const now = new Date()
    const current = useDynamicDesktopStore.getState()
    const snapshot = buildContextSnapshot({
      now,
      theme: resolvedTheme(),
      tierSignals: readTierSignals(),
    })
    const emit: Emit = (eventName, payload) => systemBus.emit(eventName, payload)
    const outcome = generateWallpaper(
      {
        sessionSeed: deriveSessionSeed(current.userId ?? 'anonymous', now, sessionCounter),
        snapshot,
        trigger,
        blockedStyles: current.prefs.blockedStyles,
        randomness: current.prefs.randomness,
        profile: current.profile,
        generationOrdinal: current.generationOrdinal,
        recentStyles: current.recentStyles,
        recentFieldIds: current.recentFieldIds,
      },
      {
        emit,
        now: () => new Date(),
        lastGoodPlan: lastGoodPlanOf(current.history),
      },
    )
    useDynamicDesktopStore.getState().applyOutcome({
      outcome,
      trigger,
      atMs: Date.now(),
      tier: snapshot.tier,
    })
    await persistHistory()
    return outcome
  } catch (error) {
    console.error('[AgehaOS:DynamicDesktop] generation failed', error)
    useDynamicDesktopStore.getState().setGenerating(false)
    return null
  }
}

async function clearAllData(): Promise<void> {
  clearWorldAccent()
  useDynamicDesktopStore.getState().clearAllData()
  try {
    await systemVfs.ready()
    await saveHistory(systemVfs, [])
  } catch {
    /* VFS 不可用时跳过文件清理 */
  }
}

/** 自动换新心跳（§4.6 随机切换）：到间隔即触发 timer 生成；隐藏页/固定态跳过。
 * 今日世界接管期间（羽化开+主题跟随+当日世界在场）跳过——当日壁纸是世界的
 * 一部分，自动换新会把它冲掉；用户手动「换一张」不受此护栏限制。 */
function renewalTick(): void {
  const state = useDynamicDesktopStore.getState()
  if (!state.prefs.enabled || state.prefs.pinned || state.generating) return
  const eclosion = useEclosionStore.getState()
  if (
    isWorldThemeActive({
      enabled: eclosion.enabled,
      themeFollow: eclosion.themeFollow,
      worldDate: eclosion.world?.worldDate ?? null,
      today: utcDayKey(),
    })
  ) {
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  const band = sliderBand(state.prefs.randomness)
  const minutes = RENEWAL_MINUTES[band.band]
  if (minutes <= 0) return
  if (Date.now() - state.lastGenerateAt < minutes * 60_000) return
  void generate('timer')
}

/**
 * 今日世界主题落地（AI-GENERATED-APPS-DESIGN §6.3，经 eclosion.world.ready 触发）：
 * - 强调色：accentHue → v2 Token brand/accent 族（world-theme，只改色相）。
 * - 壁纸：交给现有管线——世界种子驱动 gradient-field 构图、照常过质量门、
 *   经 applyOutcome 照常写入历史；动态桌面关闭或用户固定壁纸时不改壁纸
 *   （铁律 1：固定即短路整条生成链），强调色不受影响。
 */
function applyWorldThemeImpl(world: EclosionWorldSummary): boolean {
  applyWorldAccent(world.accentHue, resolvedTheme())
  const state = useDynamicDesktopStore.getState()
  if (!state.prefs.enabled || state.prefs.pinned) return false
  const plan = buildWorldWallpaperPlan(world, resolvedTheme())
  if (plan === null) return false
  useDynamicDesktopStore.getState().applyOutcome({
    outcome: { plan, level: 'L0', durationMs: 0, decisionSource: 'llm' },
    trigger: 'world',
    atMs: Date.now(),
    tier: state.tier,
  })
  void persistHistory()
  return true
}

export const systemDynamicDesktop = {
  /** 追加在既有装配链之后调用；幂等。 */
  start(): void {
    if (started || typeof window === 'undefined') return
    started = true
    unsubscribes.push(
      systemBus.on('user.login', ({ userId }) => {
        void handleLogin(userId)
      }),
    )
    unsubscribes.push(systemBus.on('user.logout', () => useDynamicDesktopStore.getState().handleLogout()))
    // 今日世界主题接线（§3.2/§6.3）：编排器发 eclosion.world.ready（载荷仅
    // worldDate）→ 世界在 store 里且用户开着「主题跟随」才应用；关闭跟随 =
    // 不改主题、只保留今日应用。
    unsubscribes.push(
      systemBus.on('eclosion.world.ready', ({ worldDate }) => {
        const eclosion = useEclosionStore.getState()
        if (!eclosion.enabled || !eclosion.themeFollow) return
        if (eclosion.world?.worldDate !== worldDate) return
        systemDynamicDesktop.applyWorldTheme(eclosion.world)
      }),
    )
    // 主题切换重派：世界壁纸构图与 accent Token 都按主题取值（浅/深两套）。
    // 观察 documentElement 的 dark class——显式偏好与 'system' 跟随系统
    // （matchMedia 改 class）两条路径都归一到 class 变化。
    themeObserver = new MutationObserver(() => {
      const eclosion = useEclosionStore.getState()
      if (!eclosion.enabled || !eclosion.themeFollow || !eclosion.world) return
      systemDynamicDesktop.applyWorldTheme(eclosion.world)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    // 冷启动恢复会话（不经 login()）时补一次登录联动。
    const restored = useSessionStore.getState().user
    if (restored) void handleLogin(restored.id)
    renewalTimer = window.setInterval(() => renewalTick(), RENEWAL_TICK_MS)
  },

  stop(): void {
    for (const off of unsubscribes) off()
    unsubscribes = []
    if (renewalTimer !== null) {
      window.clearInterval(renewalTimer)
      renewalTimer = null
    }
    themeObserver?.disconnect()
    themeObserver = null
    clearWorldAccent()
    started = false
  },

  /** 今日世界主题落地（§6.3；编排器/主题切换经 world.ready 与订阅触达）。 */
  applyWorldTheme: (world: EclosionWorldSummary) => applyWorldThemeImpl(world),

  /** 手动「换一张」（Settings 入口；节流 ≥5s，§4.6）。 */
  refresh: () => generate('manual'),

  /** 清除全部 AI 数据（§6.5）。 */
  clearAllData,
}
