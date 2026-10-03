import { useEffect, useMemo, useRef, useState } from 'react'

import { File } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { launchApp } from '@/apps/launch'
import { componentFor } from '@/apps/builtin'
import { formatMessage, useTranslation } from '@/core/i18n'
import { filterContentText } from '@/core/dynamic/content/filter'
import { systemEclosion } from '@/services/eclosion'
import { systemVfs } from '@/services/vfs'
import { useAppStore } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useSearchStore } from '@/store/search-store'
import type { VfsSearchResult } from '@/core/filesystem'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'

import { limitFiles, rankApps } from './search'

/**
 * 全局搜索面板（PRD §15，Ctrl+K）：应用 + 文件两域 + 想象域（羽化 P3，
 * AI-GENERATED-APPS-DESIGN §7——恒排两域之后），键盘导航（↑↓ 选择、Enter
 * 打开/生成、Esc 关闭）。文件结果现阶段经 Files 应用打开——「携带文件参数
 * 启动应用」（§24.3）依赖 launch 参数化，属后续工作。
 *
 * 想象域门控（§7 双端过滤的客户端半场）：输入 trim ≥2 字、羽化模式开启、
 * filterContentText 非违规（违规直接不显示想象项）；服务端 classifier 是
 * 第二道闸。Enter/点击走生成而非 launchApp。
 */

export function SearchPalette() {
  const { t } = useTranslation()
  const open = useSearchStore((s) => s.open)
  const close = useSearchStore((s) => s.close)
  const apps = useAppStore((s) => s.apps)
  const eclosionEnabled = useEclosionStore((s) => s.enabled)

  const phase = useExitPhase(open)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<VfsSearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // 自带遮罩点击与输入框 Esc，只参与弹层互斥（打开搜索即收起启动器等）。
  usePopoverDismiss('search', open, close, { dismissible: false })

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

  if (!phase.render) return null

  const trimmed = query.trim()
  // 想象域（§7）：恒排应用/文件之后；门控 = 羽化开 + ≥2 字 + 客户端过滤通过。
  const imagineVisible =
    eclosionEnabled && trimmed.length >= 2 && filterContentText(trimmed).ok
  const total = appHits.length + fileHits.length + (imagineVisible ? 1 : 0)
  const openApp = (appId: string): void => {
    launchApp(appId)
    close()
  }
  const openFile = (): void => {
    // TODO(PRD §24.3): 携带路径参数启动；当前先落到 Files 应用。
    launchApp('com.ageha.files')
    close()
  }
  const generateImagine = (): void => {
    // §7：Enter/点击即生成——开窗（ensureImagineSession 内部建会话/注册清单）
    // 并按需流式生成；门禁不过时静默无果（不阻塞桌面，AI 铁律）。
    const appId = systemEclosion.ensureImagineSession(trimmed)
    if (appId !== null) launchApp(appId)
    close()
  }
  const openActive = (): void => {
    if (active < appHits.length) {
      const hit = appHits[active]
      if (hit) openApp(hit.id)
    } else if (active < appHits.length + fileHits.length) {
      if (fileHits.length > 0) openFile()
    } else if (imagineVisible) {
      generateImagine()
    }
  }

  return (
    <div
      className={`absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-[120ms] ${
        phase.exiting ? 'bg-scrim/0 opacity-0' : 'bg-scrim opacity-100'
      }`}
      data-testid="search-backdrop"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label={t('search.placeholder')}
        data-testid="search-palette"
        className={`surface-glass glass-popover w-[38rem] max-w-[90%] rounded-xl border border-border p-3 shadow-popover ${popoverMotionClass(phase.exiting)}`}
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
            <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
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
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
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
                      <span className="block truncate text-[11px] text-text-muted">{hit.path}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* 想象域（§7）：恒排最后；形如「✦ 想象一个「<query>」应用」。 */}
          {imagineVisible && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {t('search.imagine')}
              </p>
              <ul>
                <li>
                  <button
                    type="button"
                    data-testid="search-result-imagine"
                    aria-label={formatMessage(t('search.imagineItem'), { query: trimmed })}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm ${
                      total - 1 === active ? 'bg-primary/10 text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                    onMouseEnter={() => setActive(total - 1)}
                    onClick={generateImagine}
                  >
                    <span aria-hidden="true" className="text-primary">
                      ✦
                    </span>
                    <span className="min-w-0 truncate">
                      {formatMessage(t('search.imagineItem'), { query: trimmed })}
                    </span>
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>

        <p className="mt-2 border-t border-border px-2 pt-2 text-[11px] text-text-muted">
          {t('search.hint')}
        </p>
      </div>
    </div>
  )
}
