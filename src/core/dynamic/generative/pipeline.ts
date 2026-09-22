import type { SystemEventMap } from '../../events'
import { decideWallpaper } from '../decision/engine'
import { safetyFilter } from '../safety/filter'
import { evaluateQuality } from '../governance/quality-gate'
import { curatedPlans, staticGradientPlan } from './fallbacks'
import { mulberry32 } from './seed'
import type {
  ContextSnapshot,
  FallbackLevel,
  GenerationOutcome,
  PreferenceProfile,
  WallpaperPlan,
  WallpaperStyle,
} from '../types'

/**
 * 生成管线（设计文档 §4.2 决策逻辑 + §6.2 约束求解 + §9.1 兜底链）。
 * 质量门不过 → 可行域内重采样最多 3 次（每轮推进种子）→ 逐级兜底，绝不应用未验证结果。
 */

export type Emit = <K extends keyof SystemEventMap & string>(
  eventName: K,
  payload: SystemEventMap[K],
) => void

export interface GenerateInput {
  sessionSeed: string
  snapshot: ContextSnapshot
  trigger: 'login' | 'timer' | 'manual'
  blockedStyles: readonly string[]
  randomness: number
  profile: PreferenceProfile
  generationOrdinal: number
  recentStyles: readonly WallpaperStyle[]
}

export interface GenerateDeps {
  emit: Emit
  now: () => Date
  /** F1 来源：最近一次质量门合格的计划（历史元数据，§9.1 重放）。 */
  lastGoodPlan: WallpaperPlan | null
  /** 测试注入口：覆盖采样（返回 null 模拟采样失败）。 */
  sample?: (attempt: number) => WallpaperPlan | null
  /** 测试注入口：覆盖 F2 候选集。 */
  curated?: readonly WallpaperPlan[]
}

const MAX_ATTEMPTS = 3

export function generateWallpaper(input: GenerateInput, deps: GenerateDeps): GenerationOutcome {
  const startedAt = deps.now().getTime()
  deps.emit('desktop.wallpaper.generate-started', {
    seed: input.sessionSeed,
    tier: input.snapshot.tier,
    trigger: input.trigger,
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const plan = deps.sample
      ? deps.sample(attempt)
      : decideWallpaper({
          sessionSeed: input.sessionSeed,
          contextVersion: input.snapshot.contextVersion,
          attempt,
          snapshot: input.snapshot,
          blockedStyles: input.blockedStyles,
          randomness: input.randomness,
          profile: input.profile,
          generationOrdinal: input.generationOrdinal,
          recentStyles: input.recentStyles,
        }).plan
    if (!plan) {
      deps.emit('desktop.generation.failed', { seed: input.sessionSeed, stage: 'generate', reason: 'sampling failed' })
      continue
    }
    const safety = safetyFilter({ plan, blockedStyles: input.blockedStyles })
    if (!safety.allowed) {
      deps.emit('desktop.generation.failed', {
        seed: input.sessionSeed,
        stage: 'gate',
        reason: `safety: ${safety.reason ?? 'unknown'}`,
      })
      continue
    }
    const quality = evaluateQuality({ plan, snapshot: input.snapshot })
    if (!quality.passed) {
      deps.emit('desktop.generation.failed', {
        seed: input.sessionSeed,
        stage: 'gate',
        reason: quality.violations.map((v) => `${v.item}: ${v.detail}`).join('; '),
      })
      continue
    }
    deps.emit('desktop.wallpaper.generated', {
      seed: plan.seed,
      templateId: plan.templateId,
      generatorVersion: plan.generatorVersion,
    })
    return finish(input, deps, plan, 'L0', startedAt, 'local')
  }

  // F1：重放最近合格三元组（Phase A 唯一手段：位图不落盘）。
  if (deps.lastGoodPlan) {
    deps.emit('desktop.wallpaper.fallback', { from: 'L0', to: 'F1', reason: 'generation failed after 3 attempts' })
    return finish(input, deps, deps.lastGoodPlan, 'F1', startedAt, 'cache')
  }

  // F2：内置精选集（按种子确定性选 1，且仍须过质量门）。
  const theme = input.snapshot.theme
  const passing = (deps.curated ?? curatedPlans()).filter((plan) => {
    const paletteIsLight = plan.reason.signals.includes('theme:light')
    const themeMatches = (theme === 'light') === paletteIsLight
    return themeMatches && evaluateQuality({ plan, snapshot: input.snapshot }).passed
  })
  if (passing.length > 0) {
    const rng = mulberry32(`${input.sessionSeed}|fallback`)
    const plan = passing[Math.floor(rng() * passing.length)]
    deps.emit('desktop.wallpaper.fallback', { from: 'L0', to: 'F2', reason: 'no replayable history' })
    return finish(input, deps, plan, 'F2', startedAt, 'local')
  }

  // F3：静态渐变（恒定可用的最终保险）。
  deps.emit('desktop.wallpaper.fallback', { from: 'L0', to: 'F3', reason: 'curated set unavailable' })
  return finish(input, deps, staticGradientPlan(theme), 'F3', startedAt, 'local')
}

function finish(
  input: GenerateInput,
  deps: GenerateDeps,
  plan: WallpaperPlan,
  level: FallbackLevel,
  startedAt: number,
  decisionSource: GenerationOutcome['decisionSource'],
): GenerationOutcome {
  const durationMs = deps.now().getTime() - startedAt
  deps.emit('desktop.wallpaper.applied', { seed: plan.seed, tier: input.snapshot.tier, durationMs })
  return { plan, level, durationMs, decisionSource }
}
