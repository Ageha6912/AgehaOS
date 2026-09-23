import type { MessageKey } from '../../i18n'
import type { ContextSnapshot } from '../types'

/**
 * AI 内容面板决策引擎（设计文档 DDS §5.1/§5.3/§5.4，Phase B 本地切片）。
 *
 * 本地规则引擎按时段/情境组装内容卡片：纯函数、零网络、P95 ≤10ms 预算（§7.2）。
 * 卡片全部落在人工审校的模板空间内（铁律 2）——引擎只选择「哪张卡、带什么数据」，
 * 文案渲染由 UI 层经 i18n 词典完成（LLM 自由文本属 Phase C，且必过过滤管线）。
 */

/** 卡片种类（模板白名单）。 */
export const CONTENT_CARD_KINDS = ['greeting', 'wallpaper', 'suggest', 'tip'] as const
export type ContentCardKind = (typeof CONTENT_CARD_KINDS)[number]

export type TimePhase = ContextSnapshot['timePhase']

/** 问候卡：按时段取模板（UI 经 cards.greeting.<phase>.* 键渲染）。 */
export interface GreetingCard {
  kind: 'greeting'
  phase: TimePhase
}

/** 壁纸状态卡：动态桌面开启时展示当前生成结果（style 为词典键后缀）。 */
export interface WallpaperCard {
  kind: 'wallpaper'
  style: string
  level: string
}

/** 应用建议卡：按时间段推荐已安装应用（零权限，仅启动入口建议）。 */
export interface SuggestCard {
  kind: 'suggest'
  appIds: string[]
}

/** 提示卡：轮换的系统小贴士（tipId 为词典键后缀）。 */
export interface TipCard {
  kind: 'tip'
  tipId: string
}

export type ContentCard = GreetingCard | WallpaperCard | SuggestCard | TipCard

export interface ContentCardMeta {
  card: ContentCard
  /** 卡片唯一 id（模板 kind + 序号），供渲染层做 key 与过滤审计。 */
  id: string
}

/** 组装上下文：全部来自本地系统状态（§2.1 信号白名单）。 */
export interface AssembleInput {
  snapshot: Pick<ContextSnapshot, 'timePhase' | 'season' | 'theme'>
  /** 动态桌面是否开启（决定壁纸卡是否出现）。 */
  dynamicEnabled: boolean
  /** 当前壁纸风格词典键后缀与来源层级（动态桌面关闭时忽略）。 */
  wallpaper: { style: string; level: string } | null
  /** 已安装应用 id（建议卡的可行域）。 */
  installedAppIds: readonly string[]
}

export interface AssembleResult {
  cards: ContentCardMeta[]
  /** 被过滤管线拦下的卡片数（审计用，ai.content.blocked 只记枚举原因）。 */
  blocked: number
}

/** 各时段的建议池（DDS §5.3 何时本地：纯规则、离线可用）。 */
const PHASE_SUGGESTIONS: Record<TimePhase, readonly string[]> = {
  morning: ['com.ageha.notes', 'com.ageha.samples.sticky', 'com.ageha.samples.clock'],
  day: ['com.ageha.files', 'com.ageha.notes', 'com.ageha.calculator'],
  evening: ['com.ageha.samples.sketch', 'com.ageha.samples.clock', 'com.ageha.notes'],
  night: ['com.ageha.samples.clock', 'com.ageha.samples.sticky'],
}

/** 提示卡轮换池（tipId = cards.tip.<tipId> 词典键后缀）。 */
export const TIP_IDS = ['privacy', 'pin', 'shortcut'] as const

/** 卡片文案长度上限（过滤管线的 schema 项，为 Phase C 自由文本预备）。 */
export const MAX_CARD_FIELD_LENGTH = 120

/** 卡片 schema 校验（§8.4 过滤管线的本地项；Phase C 起同样约束自由文本派生的卡片）。 */
export function validateContentCard(card: ContentCard): string | null {
  if (!CONTENT_CARD_KINDS.includes(card.kind)) return 'unknown-kind'
  switch (card.kind) {
    case 'wallpaper':
      if (typeof card.style !== 'string' || card.style.length > 64) return 'invalid-style'
      if (typeof card.level !== 'string' || card.level.length > 8) return 'invalid-level'
      return null
    case 'suggest':
      if (!Array.isArray(card.appIds) || card.appIds.length === 0 || card.appIds.length > 4) {
        return 'invalid-suggestions'
      }
      if (card.appIds.some((id) => typeof id !== 'string' || id.length > MAX_CARD_FIELD_LENGTH)) {
        return 'invalid-suggestions'
      }
      return null
    case 'tip':
      if (typeof card.tipId !== 'string' || !TIP_IDS.includes(card.tipId as never)) return 'invalid-tip'
      return null
    case 'greeting':
      return null
  }
}


/** 单张卡片的建议池 → 已安装可行域（保持池内顺序，最多 3 个）。 */
export function suggestionsForPhase(
  phase: TimePhase,
  installedAppIds: readonly string[],
): string[] {
  const installed = new Set(installedAppIds)
  return PHASE_SUGGESTIONS[phase].filter((id) => installed.has(id)).slice(0, 3)
}

/**
 * 组装内容卡片：问候（恒有）→ 壁纸状态（动态桌面开启时）→ 应用建议（可行域非空时）
 * → 提示（按 contextVersion 轮换，同会话稳定）。输出经 schema 过滤，全部本地。
 */
export function assembleContentCards(input: AssembleInput): AssembleResult {
  const { snapshot } = input
  const cards: ContentCardMeta[] = []
  let blocked = 0

  const push = (card: ContentCard): void => {
    const error = validateContentCard(card)
    if (error) {
      blocked += 1
      return
    }
    cards.push({ card, id: `${card.kind}-${cards.length}` })
  }

  push({ kind: 'greeting', phase: snapshot.timePhase })

  if (input.dynamicEnabled && input.wallpaper) {
    push({ kind: 'wallpaper', style: input.wallpaper.style, level: input.wallpaper.level })
  }

  const suggestions = suggestionsForPhase(snapshot.timePhase, input.installedAppIds)
  if (suggestions.length > 0) {
    push({ kind: 'suggest', appIds: suggestions })
  }

  push({
    kind: 'tip',
    tipId: TIP_IDS[snapshot.season === 'spring' ? 0 : snapshot.season === 'summer' ? 1 : snapshot.season === 'autumn' ? 2 : 0],
  })

  return { cards, blocked }
}

/** 供 UI 渲染问候文案的词典键。 */
export function greetingTitleKey(phase: TimePhase): MessageKey {
  return `cards.greeting.${phase}.title` as MessageKey
}

export function greetingBodyKey(phase: TimePhase): MessageKey {
  return `cards.greeting.${phase}.body` as MessageKey
}

export function tipBodyKey(tipId: string): MessageKey {
  return `cards.tip.${tipId}` as MessageKey
}
