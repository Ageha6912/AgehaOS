import { create } from 'zustand'

/**
 * 动效增强偏好（docs/DESIGN.md §15）：设备本地存储，不进云端同步——
 * 这些是性能相关的本机开关（跟随类常驻 rAF 的开销因机器而异）。
 * enhance-basic/advanced 接入的开关面：壁纸视差（默认开，收敛停帧）、
 * 指针光晕（默认关，常驻合成层）。
 */

const STORAGE_KEY = 'agehaos.motion.prefs.v1'

export interface MotionPrefs {
  /** 壁纸指针视差（enhance-advanced parallax 的照片平面化单层版）。 */
  parallax: boolean
  /** 桌面指针跟随光晕（enhance-basic cursor-glow，默认关）。 */
  glow: boolean
}

interface MotionPrefsState extends MotionPrefs {
  setParallax: (value: boolean) => void
  setGlow: (value: boolean) => void
}

const DEFAULTS: MotionPrefs = { parallax: true, glow: false }

function sanitize(raw: unknown): MotionPrefs {
  const value = (raw ?? {}) as Partial<MotionPrefs>
  return {
    parallax: typeof value.parallax === 'boolean' ? value.parallax : DEFAULTS.parallax,
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
  setParallax: (value) => {
    set({ parallax: value })
    persist(get())
  },
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

