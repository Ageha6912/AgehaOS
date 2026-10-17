import { create } from 'zustand'

/**
 * 系统音效偏好（motion-prefs-store 同款范式）：设备本地存储，不进云端
 * 同步——音量/外放是本机属性，与他人共享会话的设备各有各的安静需求。
 * 默认开：全部音效为低增益（峰值 ≤0.16）振荡器合成短音，设置里一键关。
 */

const STORAGE_KEY = 'agehaos.sound.prefs.v1'

export interface SoundPrefs {
  /** 系统音效总开关（通知 / 吸附 / Mission Control / 登录）。 */
  enabled: boolean
}

interface SoundPrefsState extends SoundPrefs {
  setEnabled: (value: boolean) => void
}

const DEFAULTS: SoundPrefs = { enabled: true }

function sanitize(raw: unknown): SoundPrefs {
  const value = (raw ?? {}) as Partial<SoundPrefs>
  return { enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled }
}

function load(): SoundPrefs {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return DEFAULTS
  }
}

function persist(prefs: SoundPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 配额满/隐私模式：偏好仅本会话生效 */
  }
}

const initial = load()

export const useSoundPrefsStore = create<SoundPrefsState>()((set, get) => ({
  ...initial,
  setEnabled: (value) => {
    set({ enabled: value })
    persist(get())
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadSoundPrefsStore(): void {
  useSoundPrefsStore.setState(load())
}

/** 测试隔离出口。 */
export function resetSoundPrefsStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  useSoundPrefsStore.setState(load())
}
