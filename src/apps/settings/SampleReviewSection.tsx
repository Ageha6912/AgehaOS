import { useCallback, useEffect, useState } from 'react'

import { ArrowClockwise, ListChecks } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { formatMessage } from '@/core/i18n'
import { ScrollFadeList } from '@/components/scroll-fade-list'

/**
 * 内容复审（DDS §8.6 + ADR 22 的 admin 尾巴，PRD §47 应用审核前置）：
 * 查看举报样本清单（GET /api/dynamic/samples，仅 role=admin；服务端已过滤
 * violation、匿名存储、新样本在前）。只读视图——处置动作（删除/封禁联动）
 * 留待 §47 应用审核完整交付。
 */

interface ContentSample {
  id: string
  text: string
  classification: 'ok' | 'misleading' | 'discomfort'
  createdAt: string
}

const CLASS_KEY: Record<ContentSample['classification'], MessageKey> = {
  ok: 'settings.reviewClass.ok',
  misleading: 'settings.reviewClass.misleading',
  discomfort: 'settings.reviewClass.discomfort',
}

/** 分类徽标配色：正常=中性、误导=警示、不适=警告（对齐 Token 语义色）。 */
const CLASS_STYLE: Record<ContentSample['classification'], string> = {
  ok: 'bg-surface-raised text-text-muted',
  misleading: 'bg-warning/10 text-warning',
  discomfort: 'bg-warning/10 text-warning',
}

export function SampleReviewSection() {
  const { t } = useTranslation()
  const [samples, setSamples] = useState<ContentSample[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const response = await fetch('/api/dynamic/samples', { credentials: 'same-origin' })
      if (!response.ok) {
        setLoadError(true)
        return
      }
      const body = (await response.json()) as { samples: ContentSample[] }
      setSamples(body.samples)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    // 坑 4：effect 内同步 setState 触发级联渲染告警——退一拍再装配。
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <section aria-label={t('settings.review')} data-testid="sample-review-section">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text">
          <ListChecks aria-hidden="true" size={16} className="text-primary" />
          {t('settings.review')}
        </h2>
        <button
          type="button"
          aria-label={t('settings.reviewRefresh')}
          title={t('settings.reviewRefresh')}
          data-testid="sample-review-refresh"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-text"
          onClick={() => void load()}
        >
          <ArrowClockwise size={13} weight="regular" />
        </button>
      </div>
      <p className="mb-4 text-xs text-text-muted">{t('settings.reviewHint')}</p>

      {loadError ? (
        <p role="alert" className="text-xs text-danger" data-testid="sample-review-error">
          {t('settings.reviewLoadError')}
        </p>
      ) : samples === null ? (
        <p className="flex items-center gap-2 text-xs text-text-muted" role="status">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {t('files.loading')}
        </p>
      ) : samples.length === 0 ? (
        <p className="text-xs text-text-muted" data-testid="sample-review-empty">
          {t('settings.reviewEmpty')}
        </p>
      ) : (
        <>
          <p className="mb-2 font-mono text-[11px] text-text-muted">
            {formatMessage(t('settings.reviewCount'), { count: String(samples.length) })}
          </p>
          <div className="flex h-80 flex-col rounded-md border border-border">
            <ScrollFadeList className="space-y-1.5 p-2" testId="sample-review-list">
              {samples.map((sample) => (
                <li
                  key={sample.id}
                  className="rounded-md border border-border bg-surface-raised/50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CLASS_STYLE[sample.classification]}`}
                    >
                      {t(CLASS_KEY[sample.classification])}
                    </span>
                    <span className="font-mono text-[11px] text-text-muted">{sample.createdAt}</span>
                  </div>
                  <p className="mt-1 break-words text-xs text-text">{sample.text}</p>
                </li>
              ))}
            </ScrollFadeList>
          </div>
        </>
      )}
    </section>
  )
}
