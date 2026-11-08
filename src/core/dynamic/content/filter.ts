/**
 * 内容过滤管线——本地半场（DDS §8.4，Phase C 起对自由文本生效）。
 *
 * 三类违规（铁律 7，渲染前同步过滤，预算 P95 ≤5ms）：
 * - violation   违规：本地词库命中（服务端分类器为 Phase C 完整交付，本地词库先行兜底）
 * - misleading  误导：链接无来源标注 / 联系方式引流（资讯必须带来源与日期）
 * - discomfort  不适：超长重复字符、喊话式全大写
 *
 * 违规产物不进任何状态、不上屏；`ai.content.blocked` 只记原因枚举（不含内容）。
 * 服务端分类器、样本上传（举报后经用户确认）归基础设施就绪后接入。
 */

export type FilterViolation = 'violation' | 'misleading' | 'discomfort'

export interface FilterResult {
  ok: boolean
  reason?: FilterViolation
  text: string
}

/** 本地违规词库（极简代表集；词库可随审校扩充）。 */
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

/** 扫描形态：NFKC 归一（全角→ASCII）+ 去格式字符（零宽等）+ 空白折叠。 */
function scanForms(text: string): { normalized: string; compact: string } {
  const normalized = text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return { normalized, compact: normalized.replace(/\s+/gu, '').toLowerCase() }
}

export function filterContentText(raw: string): FilterResult {
  const text = raw.trim()
  if (text.length === 0) return { ok: false, reason: 'misleading', text }

  const { normalized, compact } = scanForms(text)
  // 词库用紧凑串匹配：全角/零宽/空格插字（ｐｏｒｎ / po 零宽字符 rn / 赌 博）同样命中。
  for (const word of BANNED_WORDS) {
    if (compact.includes(word)) return { ok: false, reason: 'violation', text }
  }

  if (CONTACT_PATTERN.test(normalized)) return { ok: false, reason: 'misleading', text }
  if (URL_PATTERN.test(normalized) && !SOURCE_MARKER.test(normalized)) {
    return { ok: false, reason: 'misleading', text }
  }

  if (REPEAT_PATTERN.test(normalized)) return { ok: false, reason: 'discomfort', text }
  const latin = normalized.replace(/[^A-Za-z]/gu, '')
  if (latin.length >= 12) {
    const upper = latin.replace(/[^A-Z]/gu, '').length
    if (upper / latin.length > 0.6) return { ok: false, reason: 'discomfort', text }
  }

  return { ok: true, text }
}
