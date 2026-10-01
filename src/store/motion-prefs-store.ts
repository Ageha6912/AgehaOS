import { create } from 'zustand'

/**
 * 动效增强偏好（docs/DESIGN.md §15）：设备本地存储，不进云端同步——
 * 这些是性能相关的本机开关（跟随类常驻 rAF 的开销因机器而异）。
 * 开关面：指针光晕（默认关，常驻合成层）。壁纸指针视差已随
 * 2026-10-01 用户裁决移除（壁纸静止），prefers 字段一并退役。
 */

const STORAGE_KEY = 'agehaos.motion.prefs.v1'

export interface MotionPrefs {
  /** 桌面指针跟随光晕（enhance-basic cursor-glow，默认关）。 */
  glow: boolean
}

interface MotionPrefsState extends MotionPrefs {
  setGlow: (value: boolean) => void
}

const DEFAULTS: MotionPrefs = { glow: false }

function sanitize(raw: unknown): MotionPrefs {
  const value = (raw ?? {}) as Partial<MotionPrefs>
  return {
    glow: typeof value.glow === 'boolean' ? value.glow : DEFAULTS.glow,
  }
}

function load(): MotionPrefs {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return DEFAULTS
  }
}

function persist(prefs: MotionPrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 配额满/隐私模式：偏好仅本会话生效 */
  }
}

const initial = load()

export const useMotionPrefsStore = create<MotionPrefsState>()((set, get) => ({
  ...initial,
  setGlow: (value) => {
    set({ glow: value })
    persist(get())
  },
}))

/** 测试隔离出口。 */
export function resetMotionPrefsStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  useMotionPrefsStore.setState(load())
}
