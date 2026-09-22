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
]
