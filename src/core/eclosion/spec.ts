/**
 * 羽化 L1 基础软件规格表——客户端副本（AI-GENERATED-APPS-DESIGN §5.2）。
 *
 * 本表只含**元数据**（appId/权限/窗口/标题键/原生兜底映射）；生成提示词 hint
 * 永不下发客户端（ADR 27：hint 只在 server/src/eclosion/spec.ts，客户端仅传
 * specId，生成接口无法被当作通用 LLM 代理）。两表的 ids/versions/permissions
 * 一致性由 server/test/eclosion.test.ts 读文件比对钉死（§6.2 做法）。
 *
 * 规格（含 hint）由系统定义、不由 AI 决定；版本号升级即客户端缓存失效
 * （缓存键含 specVersion）。
 */

import type { MessageKey } from '../i18n/dictionaries'
import type { Permission } from '../permissions'
import { sha256Hex } from '../dynamic/generative/seed'

/** 羽化应用的 appId 前缀（设计 §3.2：WindowFrame 以此路由到 EclosionAppFrame）。 */
export const ECLOSION_APP_ID_PREFIX = 'com.ageha.eclosion.'

/** 原生兜底（§2.1）：计算器/记事本为内置原生组件；时钟为 Type B 静态站点。 */
export type EclosionFallback =
  | { kind: 'component'; component: 'calculator' | 'notes' }
  | { kind: 'web'; entry: string }

export interface EclosionSpec {
  /** 发往 POST /api/eclosion/generate 的短 id（kind=basic）。 */
  specId: string
  /** 注册进 AppRegistry 的羽化应用 id（ECLOSION_APP_ID_PREFIX + slug）。 */
  appId: string
  /** 规格版本：升级即本地 IndexedDB 缓存失效（缓存键组成部分）。 */
  specVersion: number
  /** Manifest 权限（Default Deny；SDK 桥逐请求照此校验）。 */
  permissions: readonly Permission[]
  window: { width: number; height: number; resizable: boolean }
  /** 窗口/启动器标题（词典键，zh-CN/en 同键）。 */
  titleKey: MessageKey
  /** AI 不可用 / 生成失败时的原生兜底。 */
  fallback: EclosionFallback
}

export const BASIC_ECLOSION_SPEC_VERSION = 4  // v4：功能完备性契约 + L2/L3 storage 持久化——旧版全局 HTML 缓存整体失效  // v3：taste v5 设计系统（ax-*）+ 动效契约——旧版全局 HTML 缓存整体失效  // v2：视觉与动效契约升级（taste 优化）——旧版全局 HTML 缓存整体失效

/**
 * L2/L3 运行时应用（今日世界 / 想象搜索 / 留存）的默认窗口（§5.3/§6.4）：
 * 世界行 window 在校验层（core/eclosion/world.ts）已钳制到合法区间并回落
 * 此默认；想象/留存应用无世界行，直接用此默认。resizable 恒 true。
 */
export const ECLOSION_RUNTIME_DEFAULT_WINDOW: { width: number; height: number; resizable: boolean } = {
  width: 720,
  height: 480,
  resizable: true,
}

/** L3 想象应用的 appId 子前缀（§7：com.ageha.eclosion.imagine-<hash8>）。 */
export const ECLOSION_IMAGINE_ID_PREFIX = `${ECLOSION_APP_ID_PREFIX}imagine-`

/** 羽化应用分域（§2 软件分层：L1 基础 / L2 今日世界 / L3 想象；留存复用源 appId）。 */
export type EclosionAppKind = 'basic' | 'today' | 'imagine'

/**
 * appId → 羽化分域判定（WindowFrame 路由 / 启动器过滤 / 编排器管线共用）：
 * - basic：L1 规格表内；
 * - imagine：imagine- 子前缀（P3）；
 * - today：其余 eclosion 前缀（今日世界行 + 由「获取」留存的同源 appId）；
 * - null：非羽化应用。
 */
export function eclosionAppKind(appId: string): EclosionAppKind | null {
  if (findEclosionSpecByAppId(appId) !== null) return 'basic'
  if (appId.startsWith(ECLOSION_IMAGINE_ID_PREFIX)) return 'imagine'
  if (appId.startsWith(ECLOSION_APP_ID_PREFIX)) return 'today'
  return null
}

export const BASIC_ECLOSION_SPECS: readonly EclosionSpec[] = [
  {
    specId: 'calculator',
    appId: 'com.ageha.eclosion.calculator',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    permissions: [],
    window: { width: 300, height: 440, resizable: false },
    titleKey: 'app.calculator.title',
    fallback: { kind: 'component', component: 'calculator' },
  },
  {
    specId: 'notes',
    appId: 'com.ageha.eclosion.notes',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    permissions: ['filesystem.read', 'filesystem.write'],
    window: { width: 720, height: 480, resizable: true },
    titleKey: 'app.notes.title',
    fallback: { kind: 'component', component: 'notes' },
  },
  {
    specId: 'clock',
    appId: 'com.ageha.eclosion.clock',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    // 时钟按 hint 意图取 ['storage']（设计 §5.2 表格写 [] 与「经
    // AgehaOS.storage 记住」矛盾，按 hint 意图裁决：低危、量化限额）。
    permissions: ['storage'],
    window: { width: 420, height: 560, resizable: true },
    titleKey: 'app.clock.title',
    fallback: { kind: 'web', entry: '/apps/sites/clock/index.html' },
  },
]

export function isEclosionAppId(appId: string): boolean {
  return appId.startsWith(ECLOSION_APP_ID_PREFIX)
}

/**
 * 想象 query 规范化（§7）：trim + 连续空白折叠为单空格 + 小写——同一登录会话
 * 内「同义输入」（大小写/空白差异）复用同一 appId（会话内缓存口径）。与服务端
 * `server/src/eclosion/prompts.ts` 的 normalizeImagineQuery 同口径、各自实现，
 * 两侧测试用同一批字面量钉死相关性（照 L1 规格表先例）。
 */
export function normalizeImagineQuery(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * 想象应用的确定性 appId（§7）：`com.ageha.eclosion.imagine-<hash8>`，hash8 =
 * 规范化 query 的 SHA-256 前 8 位 hex（seed.ts 同源哈希，生成路径禁裸随机）。
 * 同 query 恒同 appId——会话内缓存、跨重启「获取」留存共用同一键。
 */
export function imagineAppIdForQuery(raw: string): string {
  return `${ECLOSION_IMAGINE_ID_PREFIX}${sha256Hex(normalizeImagineQuery(raw)).slice(0, 8)}`
}

export function findEclosionSpecByAppId(appId: string): EclosionSpec | null {
  return BASIC_ECLOSION_SPECS.find((spec) => spec.appId === appId) ?? null
}

export function findEclosionSpecBySpecId(specId: string): EclosionSpec | null {
  return BASIC_ECLOSION_SPECS.find((spec) => spec.specId === specId) ?? null
}
