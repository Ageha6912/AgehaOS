/**
 * 内容分类器——服务端权威版（DDS §8.4「分类器服务端化」，Phase B 切片）。
 *
 * 三类口径与客户端离线兜底版（src/core/dynamic/content/filter.ts）一致：
 * - violation   违规：本地词库命中——此类文本不落库（违规内容本体不入任何存储）
 * - misleading  误导：联系方式引流 / 裸链接无来源标注（资讯必须带来源与日期）
 * - discomfort  不适：超长重复字符、喊话式全大写
 *
 * 两侧词库独立演化：服务端随审校扩充，不要求与客户端逐字同步。
 */

export type SampleClassification = 'ok' | 'violation' | 'misleading' | 'discomfort'

export interface ClassificationResult {
  classification: SampleClassification
  text: string
}

/** 违规词库（极简代表集；可随审校扩充）。 */
const BANNED_WORDS: readonly string[] = [
  '赌博',
  '赌场',
  '色情',
  '毒品',
  '枪支',
  'porn',
  'casino',
]

/** 联系方式/引流模式（误导类）。 */
const CONTACT_PATTERN = /(?:微信|扣扣|QQ|电话|whatsapp|telegram|tg)\s*[:：]?\s*@?[0-9A-Za-z_]{5,}/iu

/** 裸链接：出现 URL 但没有来源标注 → 误导。 */
const URL_PATTERN = /https?:\/\//iu
const SOURCE_MARKER = /(?:来源|出处|source)\s*[:：]/iu

/** 不适规则：同字符连续 ≥10 次（含标点/空白刷屏）。 */
const REPEAT_PATTERN = /(.)\1{9,}/u

export function classifyContentText(raw: string): ClassificationResult {
  const text = raw.trim()
  if (text.length === 0) return { classification: 'misleading', text }

  const lower = text.toLowerCase()
  for (const word of BANNED_WORDS) {
    if (lower.includes(word)) return { classification: 'violation', text }
  }

  if (CONTACT_PATTERN.test(text)) return { classification: 'misleading', text }
  if (URL_PATTERN.test(text) && !SOURCE_MARKER.test(text)) {
    return { classification: 'misleading', text }
  }

  if (REPEAT_PATTERN.test(text)) return { classification: 'discomfort', text }
  const latin = text.replace(/[^A-Za-z]/gu, '')
  if (latin.length >= 12) {
    const upper = latin.replace(/[^A-Z]/gu, '').length
    if (upper / latin.length > 0.6) return { classification: 'discomfort', text }
  }

  return { classification: 'ok', text }
}
