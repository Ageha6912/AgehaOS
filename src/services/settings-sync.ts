import { getLocale } from '@/core/i18n'
import { useSyncStatusStore } from '@/store/sync-status-store'
import { useSettingsStore } from '@/store/settings-store'
import type { FontSize, ThemePreference } from '@/store/settings-store'

/**
 * 用户配置同步（PRD §35 用户配置同步，本地切片）：把 settings-store 的
 * 主题/字体大小/语言作为整块 JSON 与后端 `/api/sync/data` 同步。
 *
 * 语义（v0.5 前置切片）：boot 时拉取并应用（服务端赢），之后本地改动防抖
 * 上推（本地赢）；`applying` 标志阻断回声循环。激活以同步开关为准（开关
 * 即准入）；开关入口在账户分区仅远程认证模式渲染（AccountSection 准入），
 * 本地认证构建默认保持静默。每次真实拉取/上推的 outcome（begin/success/
 * failure + 时刻）如实记入 sync-status-store（M4-3 状态面）；服务端不可达
 * 不重试，等下次变更再试。云同步的冲突合并/多设备仲裁属 Phase 3 完整交付。
 */

const TOGGLE_KEY = 'agehaos.sync.enabled.v1'
const PUSH_DEBOUNCE_MS = 1500
const SYNC_BUDGET = 256 * 1024
/** 同步开关变化事件（同域消费方如 file-sync 监听）。 */
export const SYNC_TOGGLE_EVENT = 'agehaos:sync-toggled'

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system']
const FONT_SIZES: readonly FontSize[] = ['small', 'medium', 'large']
const LOCALES = ['zh-CN', 'en'] as const

interface SyncBlob {
  settings?: { theme?: string; fontSize?: string; locale?: string }
}

let started = false
let applying = false
let pushTimer: number | null = null
let lastPushedJson: string | null = null

export function isSyncEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TOGGLE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSyncEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(TOGGLE_KEY, '1')
    else localStorage.removeItem(TOGGLE_KEY)
  } catch {
    /* storage unavailable */
  }
  // 解耦广播：file-sync 等同域消费方据此刻烟会话内的立即拉取/上推，
  // 不引入 settings-sync → file-sync 的反向依赖。
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYNC_TOGGLE_EVENT))
  }
  if (enabled) schedulePush()
}

/** 幂等启动：订阅设置变化 + boot 拉取。同步开关关闭时静默自禁用。 */
export function startSettingsSync(): void {
  if (started) return
  started = true
  useSettingsStore.subscribe(() => schedulePush())
  void pullOnce()
}

/** 测试间隔离（含未启动状态）。 */
export function resetSyncStateForTests(): void {
  started = false
  applying = false
  lastPushedJson = null
  if (pushTimer !== null) {
    window.clearTimeout(pushTimer)
    pushTimer = null
  }
}

export async function pullOnce(): Promise<void> {
  if (!isSyncEnabled()) return
  const status = useSyncStatusStore.getState()
  status.beginSyncCycle()
  try {
    const response = await fetch('/api/sync/data', { credentials: 'same-origin' })
    if (!response.ok) {
      status.failSyncCycle(Date.now())
      return
    }
    const body = (await response.json()) as { data: string | null }
    if (body.data) applyBlob(body.data)
  } catch {
    // 离线/服务不可达：保留本地值， outcome 记为失败（M4-3 状态面如实呈现）。
    status.failSyncCycle(Date.now())
    return
  }
  status.completeSyncCycle(Date.now())
}

function schedulePush(): void {
  if (started && isSyncEnabled() && !applying) {
    if (pushTimer !== null) window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => {
      pushTimer = null
      void pushNow()
    }, PUSH_DEBOUNCE_MS)
  }
}

async function pushNow(): Promise<void> {
  const data = JSON.stringify({ settings: currentSettings() })
  if (data === lastPushedJson || data.length > SYNC_BUDGET) return
  const status = useSyncStatusStore.getState()
  status.beginSyncCycle()
  try {
    const response = await fetch('/api/sync/data', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    })
    if (response.ok) {
      lastPushedJson = data
      status.completeSyncCycle(Date.now())
    } else {
      status.failSyncCycle(Date.now())
    }
  } catch {
    /* offline: next change retries */
    status.failSyncCycle(Date.now())
  }
}

function applyBlob(data: string): void {
  let blob: SyncBlob
  try {
    blob = JSON.parse(data) as SyncBlob
  } catch {
    return
  }
  const settings = blob.settings
  if (typeof settings !== 'object' || settings === null) return
  applying = true
  try {
    const store = useSettingsStore.getState()
    if (THEMES.includes(settings.theme as never)) store.setTheme(settings.theme as ThemePreference)
    if (FONT_SIZES.includes(settings.fontSize as never)) {
      store.setFontSize(settings.fontSize as FontSize)
    }
    if (LOCALES.includes(settings.locale as never)) store.setLocale(settings.locale as 'zh-CN' | 'en')
    lastPushedJson = JSON.stringify({ settings: currentSettings() })
  } finally {
    applying = false
  }
}

function currentSettings(): { theme: string; fontSize: string; locale: string } {
  const state = useSettingsStore.getState()
  return { theme: state.theme, fontSize: state.fontSize, locale: getLocale() }
}
