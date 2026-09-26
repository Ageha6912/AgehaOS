import { useEffect, useMemo, useRef, useState } from 'react'

import { File } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { launchApp } from '@/apps/launch'
import { componentFor } from '@/apps/builtin'
import { useTranslation } from '@/core/i18n'
import { systemVfs } from '@/services/vfs'
import { useAppStore } from '@/store/app-store'
import { useSearchStore } from '@/store/search-store'
import type { VfsSearchResult } from '@/core/filesystem'

import { limitFiles, rankApps } from './search'

/**
 * 全局搜索面板（PRD §15，Ctrl+K）：应用 + 文件两域，键盘导航
 * （↑↓ 选择、Enter 打开、Esc 关闭）。文件结果现阶段经 Files 应用打开——
 * 「携带文件参数启动应用」（§24.3）依赖 launch 参数化，属后续工作。
 */

export function SearchPalette() {
  const { t } = useTranslation()
  const open = useSearchStore((s) => s.open)
  const close = useSearchStore((s) => s.close)
  const apps = useAppStore((s) => s.apps)

  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<VfsSearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const appHits = useMemo(
    () =>
      rankApps(
        query,
        apps.map((app) => {
          const meta = componentFor(app.id)
          return { id: app.id, name: app.name, title: meta ? t(meta.titleKey) : app.name }
        }),
      ),
    [query, apps, t],
  )
  const fileHits = limitFiles(query.trim() ? files : [])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      // 清空与检索都在异步回调里落地（react-hooks set-state-in-effect 规则）。
      const trimmed = query.trim()
      if (trimmed.length === 0) {
        setFiles([])
        return
      }
      void systemVfs
        .search('/', trimmed)
        .then((results) => setFiles(limitFiles(results)))
        .catch(() => setFiles([]))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, query])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const total = appHits.length + fileHits.length
  const openApp = (appId: string): void => {
    launchApp(appId)
    close()
  }
  const openFile = (): void => {
    // TODO(PRD §24.3): 携带路径参数启动；当前先落到 Files 应用。
    launchApp('com.ageha.files')
    close()
  }
  const openActive = (): void => {
    if (active < appHits.length) {
      const hit = appHits[active]
      if (hit) openApp(hit.id)
    } else if (fileHits.length > 0) {
      openFile()
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      data-testid="search-backdrop"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label={t('search.placeholder')}
        data-testid="search-palette"
        className="surface-glass w-[32rem] max-w-[90%] rounded-xl border border-border p-3 shadow-window"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          aria-label={t('search.placeholder')}
          placeholder={t('search.placeholder')}
          data-testid="search-input"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-primary"
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, total - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              openActive()
            }
          }}
        />

        <div className="mt-2 max-h-80 overflow-y-auto" data-testid="search-results">
          {total === 0 && query.trim() && (
            <p className="px-2 py-4 text-center text-xs text-text-muted">{t('search.empty')}</p>
          )}

          {appHits.length > 0 && (
            <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              {t('search.apps')}
            </p>
          )}
          <ul>
            {appHits.map((hit, index) => (
              <li key={hit.id}>
                <button
                  type="button"
                  data-testid="search-result-app"
                  aria-label={hit.title}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm ${
                    index === active ? 'bg-primary/10 text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => openApp(hit.id)}
                >
                  <AppIcon appId={hit.id} size={16} />
                  {hit.title}
                </button>
              </li>
            ))}
          </ul>

          {fileHits.length > 0 && (
            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-text-muted">
              {t('search.files')}
            </p>
          )}
          <ul>
            {fileHits.map((hit, index) => {
              const flatIndex = appHits.length + index
              return (
                <li key={hit.path}>
                  <button
                    type="button"
                    data-testid="search-result-file"
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm ${
                      flatIndex === active ? 'bg-primary/10 text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                    onMouseEnter={() => setActive(flatIndex)}
                    onClick={openFile}
                  >
                    <File size={15} weight="regular" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-text">{hit.node.name}</span>
                      <span className="block truncate text-[10px] text-text-muted">{hit.path}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <p className="mt-2 border-t border-border px-2 pt-2 text-[10px] text-text-muted">
          {t('search.hint')}
        </p>
      </div>
    </div>
  )
}
