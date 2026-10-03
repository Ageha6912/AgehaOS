/**
 * 启动器羽化可见性过滤（AI-GENERATED-APPS-DESIGN §2.1，纯函数）：
 * - 羽化应用：开关开且该规格选「羽化版」（缺省羽化）才可见；
 * - calculator/notes 原生入口：其羽化版接管（开 + 羽化版）时隐藏——渲染层
 *   过滤，不 unregister（原生实现一概不删）；
 * - 时钟原生兜底 = 商店样本 com.ageha.samples.clock：按实施裁决维持现状，
 *   不随开关隐藏；
 * - 未知 `com.ageha.eclosion.*`（imagine 域 P3 预留）：仅开关开时可见。
 */

import { BASIC_ECLOSION_SPECS, ECLOSION_APP_ID_PREFIX } from '@/core/eclosion/spec'
import type { EclosionGenerateMode } from '@/store/eclosion-store'

/** 羽化 ↔ 原生对应关系（§2.1 兜底表；时钟走 web 兜底但维持样本现状）。 */
const ECLOSION_NATIVE_COUNTERPART: ReadonlyMap<string, string> = new Map(
  BASIC_ECLOSION_SPECS.map((spec) => [
    spec.specId,
    spec.fallback.kind === 'component'
      ? spec.fallback.component === 'calculator'
        ? 'com.ageha.calculator'
        : 'com.ageha.notes'
      : 'com.ageha.samples.clock',
  ]),
)

export function filterLauncherAppIds(
  appIds: readonly string[],
  prefs: { enabled: boolean; modes: Record<string, EclosionGenerateMode> },
): string[] {
  const modeOf = (specId: string): EclosionGenerateMode => prefs.modes[specId] ?? 'eclosion'
  const eclosionTakenOver = new Set<string>()
  if (prefs.enabled) {
    for (const spec of BASIC_ECLOSION_SPECS) {
      if (modeOf(spec.specId) !== 'eclosion') continue
      // 仅组件兜底（计算器/记事本）算「接管」；时钟样本维持现状。
      if (spec.fallback.kind === 'component') {
        const nativeId = ECLOSION_NATIVE_COUNTERPART.get(spec.specId)
        if (nativeId) eclosionTakenOver.add(nativeId)
      }
    }
  }
  return appIds.filter((appId) => {
    const spec = BASIC_ECLOSION_SPECS.find((candidate) => candidate.appId === appId)
    if (spec) return prefs.enabled && modeOf(spec.specId) === 'eclosion'
    if (appId.startsWith(ECLOSION_APP_ID_PREFIX)) return prefs.enabled
    return !eclosionTakenOver.has(appId)
  })
}
