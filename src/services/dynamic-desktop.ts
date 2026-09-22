import { systemBus } from '@/core/events'
import { buildContextSnapshot, resetContextVersion } from '@/core/dynamic/context/snapshot'
import type { Emit } from '@/core/dynamic/generative/pipeline'
import { generateWallpaper } from '@/core/dynamic/generative/pipeline'
import { deriveSessionSeed } from '@/core/dynamic/generative/seed'
import type { TierSignals } from '@/core/dynamic/governance/tier'
import { lastGoodPlanOf, loadHistory, saveHistory } from '@/core/dynamic/history'
import type { GenerationOutcome } from '@/core/dynamic/types'
import {
  MANUAL_REFRESH_THROTTLE_MS,
  useDynamicDesktopStore,
} from '@/store/dynamic-desktop-store'
import { useSessionStore } from '@/store/session-store'
import { systemVfs } from './vfs'

/**
 * 动态桌面装配单例（设计文档 §3.2）：追加在 main.tsx 既有装配链之后，
 * 不改变既有启动顺序。职责：登录/登出联动、触发生成管线、历史元数据落盘。
 * 状态归 dynamic-desktop-store，管线归 core——本单例只做编排。
 */

let sessionCounter = 0
let started = false
let unsubscribes: Array<() => void> = []

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
    try {
      await saveHistory(systemVfs, useDynamicDesktopStore.getState().history)
    } catch {
      /* 结果仅存内存并标记未持久化（§9.2）：不阻塞桌面 */
    }
    return outcome
  } catch (error) {
    console.error('[AgehaOS:DynamicDesktop] generation failed', error)
    useDynamicDesktopStore.getState().setGenerating(false)
    return null
  }
}

async function clearAllData(): Promise<void> {
  useDynamicDesktopStore.getState().clearAllData()
  try {
    await systemVfs.ready()
    await saveHistory(systemVfs, [])
  } catch {
    /* VFS 不可用时跳过文件清理 */
  }
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
    // 冷启动恢复会话（不经 login()）时补一次登录联动。
    const restored = useSessionStore.getState().user
    if (restored) void handleLogin(restored.id)
  },

  stop(): void {
    for (const off of unsubscribes) off()
    unsubscribes = []
    started = false
  },

  /** 手动「换一张」（Settings 入口；节流 ≥5s，§4.6）。 */
  refresh: () => generate('manual'),

  /** 清除全部 AI 数据（§6.5）。 */
  clearAllData,
}
