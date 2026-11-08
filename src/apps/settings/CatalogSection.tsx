import { useEffect, useState } from 'react'

import { ShieldCheck, Trash } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'

/**
 * 远程目录管理（ADR 20，仅管理员可见）：查看/移除/以 JSON 追加发布签名远程
 * 目录。发布即 PUT `/api/store/admin/catalog`，全部条目整体提交；校验在
 * 服务端（白名单 + /apps/sites/ allowlist），被拒时给出结构化提示。
 */

interface CatalogApp {
  id: string
  name: string
  version: string
  entry: string
  permissions: string[]
  window: { width: number; height: number; resizable: boolean }
  author: string
  description: string
}

type Feedback = { kind: 'error'; key: string } | { kind: 'ok' } | null

export function CatalogSection() {
  const { t } = useTranslation()
  const [apps, setApps] = useState<CatalogApp[] | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [jsonInput, setJsonInput] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/store/admin/catalog', { credentials: 'same-origin' })
        if (!response.ok) {
          if (!cancelled) setLoadState('error')
          return
        }
        const body = (await response.json()) as { apps?: unknown }
        if (!Array.isArray(body.apps)) {
          if (!cancelled) setLoadState('error')
          return
        }
        if (!cancelled) {
          setApps(body.apps as CatalogApp[])
          setLoadState('ready')
        }
      } catch {
        if (!cancelled) setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const publish = async (next: CatalogApp[]): Promise<boolean> => {
    // 未拿到当前目录时禁止发布：服务端是整表替换，单条 PUT 会清空其余条目。
    if (loadState !== 'ready') return false
    setBusy(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/store/admin/catalog', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apps: next }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setFeedback({
          kind: 'error',
          key: body.error === 'invalid-catalog' ? 'settings.catalogInvalid' : 'auth.error.generic',
        })
        return false
      }
      setApps(next)
      setFeedback({ kind: 'ok' })
      return true
    } catch {
      setFeedback({ kind: 'error', key: 'auth.error.generic' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const addFromJson = async () => {
    if (loadState !== 'ready') return
    let entry: CatalogApp
    try {
      entry = JSON.parse(jsonInput) as CatalogApp
    } catch {
      setFeedback({ kind: 'error', key: 'settings.catalogBadJson' })
      return
    }
    const merged = [...(apps ?? []).filter((app) => app.id !== entry.id), entry]
    if (await publish(merged)) setJsonInput('')
  }

  const remove = async (id: string) => {
    if (loadState !== 'ready') return
    await publish((apps ?? []).filter((app) => app.id !== id))
  }

  return (
    <section aria-label={t('settings.catalog')} data-testid="catalog-section">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-text">
        <ShieldCheck aria-hidden="true" size={16} className="text-primary" />
        {t('settings.catalog')}
      </h2>
      <p className="mb-4 text-xs text-text-muted">{t('settings.catalogHint')}</p>

      {loadState === 'error' ? (
        <div className="mb-4 flex items-center gap-2 text-xs" role="alert">
          <p className="text-danger">{t('settings.catalogLoadFailed')}</p>
          <button
            type="button"
            className="h-7 rounded-md border border-border px-2.5 text-xs text-text hover:bg-surface-raised"
            onClick={() => {
              setLoadState('loading')
              setReloadKey((key) => key + 1)
            }}
          >
            {t('settings.catalogRetry')}
          </button>
        </div>
      ) : apps === null ? (
        <p className="flex items-center gap-2 text-xs text-text-muted" role="status">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {t('files.loading')}
        </p>
      ) : apps.length === 0 ? (
        <p className="mb-4 text-xs text-text-muted">{t('settings.catalogEmpty')}</p>
      ) : (
        <ul className="mb-4 space-y-1.5" data-testid="catalog-list">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-raised/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-text">{app.name}</p>
                <p className="truncate font-mono text-[11px] text-text-muted">
                  {app.id} · v{app.version} · {app.entry}
                </p>
              </div>
              <button
                type="button"
                aria-label={`${t('settings.catalogRemove')} ${app.name}`}
                disabled={busy || loadState !== 'ready'}
                onClick={() => void remove(app.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-danger disabled:opacity-40"
              >
                <Trash aria-hidden="true" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <textarea
          aria-label={t('settings.catalogAdd')}
          placeholder={t('settings.catalogPlaceholder')}
          value={jsonInput}
          onChange={(event) => setJsonInput(event.target.value)}
          disabled={loadState !== 'ready'}
          rows={5}
          spellCheck={false}
          className="resize-y rounded-md border border-border bg-surface-raised/60 p-2.5 font-mono text-xs text-text placeholder:text-text-muted focus:border-primary disabled:opacity-60"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || loadState !== 'ready' || jsonInput.trim() === ''}
            onClick={() => void addFromJson()}
            className="h-7 rounded-md bg-primary px-2.5 text-xs text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('settings.catalogAdd')}
          </button>
          {feedback?.kind === 'error' && (
            <p role="alert" className="text-xs text-danger">
              {t(feedback.key as 'auth.error.generic')}
            </p>
          )}
          {feedback?.kind === 'ok' && (
            <p className="text-xs text-success">{t('settings.catalogSaved')}</p>
          )}
        </div>
      </div>
    </section>
  )
}
