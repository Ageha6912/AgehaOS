/**
 * Built-in system app manifests (PRD §26), kept as plain data so the store
 * can register them at boot. Entries are validated by parseManifest at
 * registration time — this file stays the single source of truth for what
 * ships with v0.1.
 *
 * Permissions follow the canonical §10.1 names.
 */
import { ECLOSION_RUNNER_ENTRY } from '@/core/apps/web-app'
import { BASIC_ECLOSION_SPECS } from '@/core/eclosion/spec'

/**
 * 羽化 L1 三件套（AI-GENERATED-APPS-DESIGN §3.2）：注册为普通 Manifest——
 * entry 统一指向运行时页（WindowFrame 按 com.ageha.eclosion. 前缀路由到
 * EclosionAppFrame），permissions/window 直接取自规格表（规格由系统定义，
 * 不由 AI 决定；与 server/src/eclosion/spec.ts 一致性由服务端测试钉死）。
 * Manifest schema 不扩（deepFreeze 校验照旧）。非本地化 name 仅作最终回落，
 * 展示标题走 spec.titleKey（launch.ts / AppLauncher）。
 */
const ECLOSION_APP_MANIFESTS: readonly unknown[] = BASIC_ECLOSION_SPECS.map((spec) => ({
  id: spec.appId,
  name: spec.specId,
  version: `1.${spec.specVersion}.0`,
  entry: ECLOSION_RUNNER_ENTRY,
  permissions: spec.permissions,
  window: spec.window,
}))

export const BUILTIN_APP_MANIFESTS: readonly unknown[] = [
  {
    id: 'com.ageha.notes',
    name: 'Notes',
    version: '0.1.0',
    entry: '/apps/notes/index.html',
    permissions: ['storage'],
    window: { width: 720, height: 480 },
  },
  {
    id: 'com.ageha.files',
    name: 'Files',
    version: '0.1.0',
    entry: '/apps/files/index.html',
    permissions: ['filesystem.read', 'filesystem.write', 'storage'],
    window: { width: 880, height: 560 },
  },
  {
    id: 'com.ageha.settings',
    name: 'Settings',
    version: '0.1.0',
    entry: '/apps/settings/index.html',
    permissions: [],
    window: { width: 840, height: 560 },
  },
  {
    id: 'com.ageha.store',
    name: 'App Store',
    version: '0.2.0',
    entry: '/apps/store/index.html',
    permissions: [],
    window: { width: 560, height: 520, resizable: true },
  },
  {
    id: 'com.ageha.calculator',
    name: 'Calculator',
    version: '0.2.0',
    entry: '/apps/calculator/index.html',
    permissions: [],
    window: { width: 300, height: 440, resizable: false },
  },
  {
    id: 'com.ageha.dynamic.panel',
    name: 'Dynamic Panel',
    version: '0.2.0',
    entry: '/apps/dynamic-panel/index.html',
    permissions: [],
    window: { width: 680, height: 420, resizable: true },
  },
  {
    id: 'com.ageha.terminal',
    name: 'Terminal',
    version: '0.2.0',
    entry: '/apps/terminal/index.html',
    permissions: [],
    window: { width: 660, height: 440, resizable: true },
  },
  {
    // 浏览器（档 C）：内容经 /api/browse 服务端代理回流（会话门 + SSRF 闸 +
    // HTML 重写）；窗口内打不开的站点有「在新标签页打开」的真实浏览兜底。
    id: 'com.ageha.browser',
    name: 'Browser',
    version: '0.1.0',
    entry: '/apps/browser/index.html',
    permissions: [],
    window: { width: 1060, height: 700, resizable: true },
  },
  ...ECLOSION_APP_MANIFESTS,
]
