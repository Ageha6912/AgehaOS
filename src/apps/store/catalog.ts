import type { Permission } from '@/core/permissions'

/**
 * App Store 目录（PRD §26 App Store P1 骨架）：随构建打包的可安装 Web 应用清单。
 * 全部为 Type B（iframe 沙箱）站点，声明零权限（DDS §5.5：面板数据由系统注入，
 * 应用自身零能力）；entry 必须通过 `/apps/sites/` 来源 allowlist（§30.3）。
 *
 * 后续接入真实分发（来源校验、签名、版本管理，§47）时替换为远端目录。
 */
export interface StoreCatalogEntry {
  manifest: {
    id: string
    name: string
    version: string
    entry: string
    permissions: Permission[]
    window: { width: number; height: number; resizable: boolean }
    author: string
    description: string
  }
}

export const STORE_CATALOG: StoreCatalogEntry[] = [
  {
    manifest: {
      id: 'com.ageha.samples.clock',
      name: '时钟',
      version: '1.0.0',
      entry: '/apps/sites/clock/index.html',
      permissions: [],
      window: { width: 360, height: 420, resizable: true },
      author: 'AgehaOS Samples',
      description: '桌面时钟与秒表，Type B 沙箱示例应用。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.samples.sketch',
      name: '画板',
      version: '1.0.0',
      entry: '/apps/sites/sketch/index.html',
      permissions: [],
      window: { width: 560, height: 440, resizable: true },
      author: 'AgehaOS Samples',
      description: '随手涂鸦画板，Type B 沙箱示例应用。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.samples.sticky',
      name: '便签',
      version: '1.0.0',
      entry: '/apps/sites/sticky/index.html',
      permissions: ['storage', 'window'],
      window: { width: 380, height: 460, resizable: true },
      author: 'AgehaOS Samples',
      description: 'SDK 示例应用：便签经沙箱桥持久化，标题随数量更新。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.samples.fs-note',
      name: '云笔记',
      version: '1.0.0',
      entry: '/apps/sites/fs-note/index.html',
      permissions: ['filesystem.read', 'filesystem.write', 'notification'],
      window: { width: 460, height: 420, resizable: true },
      author: 'AgehaOS Samples',
      description: 'SDK 示例应用：笔记写入本应用专属目录，并可发送系统通知。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.games.snake',
      name: '贪吃蛇',
      version: '1.0.0',
      entry: '/apps/sites/snake/index.html',
      permissions: [],
      window: { width: 380, height: 500, resizable: true },
      author: 'AgehaOS Games',
      description: '经典街机小游戏：方向键控制小蛇吃食物，撞墙或咬到自己即结束。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.games.2048',
      name: '2048',
      version: '1.0.0',
      entry: '/apps/sites/2048/index.html',
      permissions: [],
      window: { width: 380, height: 520, resizable: true },
      author: 'AgehaOS Games',
      description: '数字合并益智游戏：滑动棋盘合并相同数字，挑战拼出 2048。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.games.memory',
      name: '记忆翻牌',
      version: '1.0.0',
      entry: '/apps/sites/memory/index.html',
      permissions: [],
      window: { width: 380, height: 500, resizable: true },
      author: 'AgehaOS Games',
      description: '记忆力挑战：翻开幕对相同数字的卡牌，用最少步数完成全部配对。',
    },
  },
  {
    manifest: {
      id: 'com.ageha.games.mines',
      name: '扫雷',
      version: '1.0.0',
      entry: '/apps/sites/mines/index.html',
      permissions: [],
      window: { width: 380, height: 480, resizable: true },
      author: 'AgehaOS Games',
      description: '经典逻辑游戏：根据数字推理雷区位置，翻开全部安全格即获胜。',
    },
  },
]
