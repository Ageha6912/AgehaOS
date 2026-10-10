import { create } from 'zustand'

/**
 * 动效增强偏好（docs/DESIGN.md §15/§32.5 修订 10）：设备本地存储，不进
 * 云端同步——这些是性能相关的本机开关（跟随类常驻 rAF 的开销因机器而异）。
 * 2026-10-01 用户裁决：跟随光晕默认开，进阶炫技档四项（流光渐变氛围/
 * 窗口切换转场/Dock 高光滑过/主题氛围光晕）一并默认开；壁纸指针视差已随
 * 同日裁决移除（壁纸静止），prefers 字段一并退役。
 */

const STORAGE_KEY = 'agehaos.motion.prefs.v1'

export interface MotionPrefs {
  /** 桌面指针跟随光晕（enhance-basic cursor-glow）。 */
  glow: boolean
  /** 流光渐变氛围（enhance-advanced aurora，壁纸层上的 canvas 光斑）。 */
  aurora: boolean
  /** 窗口切换转场（enhance-advanced window-tilt，聚焦小起立 + 失焦微退后）。 */
  windowTilt: boolean
  /** Dock 高光滑过（enhance-advanced dock-sheen，低频釉面扫光）。 */
  dockSheen: boolean
  /** 主题氛围光晕（enhance-advanced theme-glow，主题色光斑呼吸）。 */
  themeGlow: boolean
  /** 空间动效（2026-10-10 空间化裁决 3）：常驻环境浮动动画——窗口深度
   * （悬浮/氛围）总开关；移动控制中心以「减弱空间动效」反相呈现同一布尔。 */
  spatialMotion: boolean
}

export type MotionPrefKey = keyof MotionPrefs

interface MotionPrefsState extends MotionPrefs {
  setPref: (key: MotionPrefKey, value: boolean) => void
}

const DEFAULTS: MotionPrefs = {
  glow: true,
  aurora: true,
  windowTilt: true,
  dockSheen: true,
  themeGlow: true,
  spatialMotion: true,
}

function sanitize(raw: unknown): MotionPrefs {
  const value = (raw ?? {}) as Partial<MotionPrefs>
  return {
    glow: typeof value.glow === 'boolean' ? value.glow : DEFAULTS.glow,
    aurora: typeof value.aurora === 'boolean' ? value.aurora : DEFAULTS.aurora,
    windowTilt: typeof value.windowTilt === 'boolean' ? value.windowTilt : DEFAULTS.windowTilt,
    dockSheen: typeof value.dockSheen === 'boolean' ? value.dockSheen : DEFAULTS.dockSheen,
    themeGlow: typeof value.themeGlow === 'boolean' ? value.themeGlow : DEFAULTS.themeGlow,
    spatialMotion:
      typeof value.spatialMotion === 'boolean' ? value.spatialMotion : DEFAULTS.spatialMotion,
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
  setPref: (key, value) => {
    set({ [key]: value })
    persist(get())
  },
}))

/** 模拟新页面加载：保留持久化数据重读（区别于 wipe 语义的 reset）。 */
export function reloadMotionPrefsStore(): void {
  useMotionPrefsStore.setState(load())
}

/** 测试隔离出口。 */
export function resetMotionPrefsStore(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
  useMotionPrefsStore.setState(load())
}
