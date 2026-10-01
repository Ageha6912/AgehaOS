import { launchApp } from '@/apps/launch'
import { getAppManifest, useAppStore } from '@/store/app-store'

import { MENUBAR_HEIGHT_PX } from './window/viewport'

/** 参与轮换的小游戏（商店目录条目；未安装的自动跳过）。 */
export const GAME_APP_IDS: readonly string[] = [
  'com.ageha.games.snake',
  'com.ageha.games.2048',
  'com.ageha.games.memory',
  'com.ageha.games.mines',
]

const LAST_GAME_KEY = 'agehaos.game.rotation.v1'

/**
 * 纯轮换（2026-09-26 用户裁决「每次进入桌面都是不一样的小游戏」）：
 * 从候选中随机挑一个，排除上次打开的那个；候选唯一时只能选它，空集返回 null。
 */
export function pickGameId(
  ids: readonly string[],
  lastId: string | null,
  rng: () => number = Math.random,
): string | null {
  const pool = lastId !== null && ids.length > 1 ? ids.filter((id) => id !== lastId) : ids
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length)]
}

/**
 * 每次进入桌面调用：在已安装的小游戏里轮换打开一个（居中弹出），并把
 * 选择写入 localStorage 供下次排除。没有安装任何游戏则静默跳过。
 */
export function openRandomGame(): string | null {
  const installed = new Set(useAppStore.getState().apps.map((app) => app.id))
  const candidates = GAME_APP_IDS.filter((id) => installed.has(id))
  let lastId: string | null = null
  try {
    lastId = localStorage.getItem(LAST_GAME_KEY)
  } catch {
    /* storage access denied */
  }
  const picked = pickGameId(candidates, lastId)
  if (!picked) return null

  const manifest = getAppManifest(picked)
  const width = manifest?.window?.width ?? 560
  const height = manifest?.window?.height ?? 420
  launchApp(
    picked,
    {
      x: Math.max(8, Math.round((window.innerWidth - width) / 2)),
      // 顶栏常驻（§19）：居中弹出不得钻进菜单栏底下。
      y: Math.max(MENUBAR_HEIGHT_PX + 8, Math.round((window.innerHeight - height) / 2 - 40)),
    },
    'system',
  )
  try {
    localStorage.setItem(LAST_GAME_KEY, picked)
  } catch {
    /* storage access denied */
  }
  return picked
}
