import { useEffect, useMemo, useRef, useState } from 'react'

import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Plus,
  Star,
  X,
} from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { isImeComposing } from '@/components/ime-guard'
import { useNarrowContainer } from '@/apps/use-narrow-container'

import { useBrowserStore } from './browser-store'
import { displayForTarget, proxyUrlFor, targetForInput, titleForTarget } from './browser-nav'

/**
 * 浏览器应用（档 C：窗口内浏览 + 真实浏览兜底）。
 *
 * 内容经 /api/browse 服务端代理回流（SSRF 闸 + HTML 重写），窗口内呈现；
 * 代理拒绝/上游失败的页面由代理侧错误页兜底「在新标签页打开」——顶层标签
 * 不受任何嵌入限制，真实网站 100% 可用。搜索默认走 DuckDuckGo HTML 端点
 * （无 JS 依赖，结果链接经代理重写后窗口内直接可达）。
 *
 * 交互面：标签页（新建/关闭）+ 地址栏（域名直访 / 关键词搜索）+
 * 后退/前进/刷新 + 星标收藏 + 新标签打开；起始页 = 书签 + 最近访问
 * （browser-store，设备本地持久化）。
 */

export interface BrowserTab {
  id: string
  /** null = 起始页（应用内自绘：书签 + 最近访问）。 */
  target: string | null
  title: string
  /** 目标 URL 栈（后退/前进）。 */
  trail: string[]
  index: number
  /** 刷新计数（同名 src 不重载，进 iframe key）。 */
  reloadSeq: number
}

export interface BrowserAppProps {
  windowId: string
}

let tabSeq = 0

function newTab(): BrowserTab {
  tabSeq += 1
  return { id: `tab-${tabSeq}`, target: null, title: '', trail: [], index: -1, reloadSeq: 0 }
}

/** 宿主 props 只有 windowId（本应用不使用）——签名收窄为零参以满足 lint。 */
export function BrowserApp() {
  const { t } = useTranslation()
  const { ref: rootRef, narrow } = useNarrowContainer()
  const bookmarks = useBrowserStore((s) => s.bookmarks)
  const history = useBrowserStore((s) => s.history)
  const addBookmark = useBrowserStore((s) => s.addBookmark)
  const removeBookmark = useBrowserStore((s) => s.removeBookmark)
  const recordVisit = useBrowserStore((s) => s.recordVisit)

  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTab()])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')
  const [address, setAddress] = useState('')
  const addressRef = useRef<HTMLInputElement>(null)

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  // 切标签/导航后地址栏跟随活动标签的目标（起始页清空并聚焦）。
  useEffect(() => {
    if (active === undefined) return
    setAddress(active.target === null ? '' : displayForTarget(active.target))
    if (active.target === null) addressRef.current?.focus()
  }, [active])

  const updateTab = (id: string, patch: Partial<BrowserTab>): void =>
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))

  /** 导航入口：地址栏输入/起始页点击都收敛到这里。 */
  const navigate = (raw: string, explicitTarget?: string): void => {
    if (active === undefined) return
    const target = explicitTarget ?? targetForInput(raw)
    if (target === null) return
    const trail = [...active.trail.slice(0, active.index + 1), target]
    updateTab(active.id, {
      target,
      title: titleForTarget(target),
      trail,
      index: trail.length - 1,
    })
    recordVisit(target, titleForTarget(target))
  }

  const goBack = (): void => {
    if (active === undefined || active.index <= 0) return
    const index = active.index - 1
    const target = active.trail[index]
    if (target === undefined) return
    updateTab(active.id, { index, target, title: titleForTarget(target) })
  }

  const goForward = (): void => {
    if (active === undefined || active.index >= active.trail.length - 1) return
    const index = active.index + 1
    const target = active.trail[index]
    if (target === undefined) return
    updateTab(active.id, { index, target, title: titleForTarget(target) })
  }

  const reload = (): void => {
    if (active !== undefined && active.target !== null) {
      updateTab(active.id, { reloadSeq: active.reloadSeq + 1 })
    }
  }

  const openExternal = (): void => {
    if (active?.target !== null && active?.target !== undefined) {
      window.open(active.target, '_blank', 'noopener,noreferrer')
    }
  }

  const bookmarked =
    active?.target !== null && active?.target !== undefined
      ? bookmarks.some((entry) => entry.url === active.target)
      : false

  const toggleBookmark = (): void => {
    if (active === undefined || active.target === null) return
    if (bookmarked) removeBookmark(active.target)
    else addBookmark(active.target, titleForTarget(active.target))
  }

  const addTab = (): void => {
    const tab = newTab()
    setTabs((current) => [...current, tab])
    setActiveId(tab.id)
  }

  const closeTab = (id: string): void => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const next = tabs.filter((tab) => tab.id !== id)
    if (next.length === 0) {
      const fresh = newTab()
      setTabs([fresh])
      setActiveId(fresh.id)
      return
    }
    setTabs(next)
    if (id === activeId) {
      const fallback = next[Math.min(index, next.length - 1)]
      if (fallback !== undefined) setActiveId(fallback.id)
    }
  }

  const toolbarButtonClass = `flex items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-35 ${
    narrow ? 'h-11 w-11' : 'h-7 w-7'
  }`

  const canBack = active !== undefined && active.index > 0
  const canForward = active !== undefined && active.index < active.trail.length - 1
  const iframeKey =
    active === undefined ? 'none' : `${active.id}-${active.index}-${active.reloadSeq}`
  const iframeSrc = active?.target != null ? proxyUrlFor(active.target) : null

  const recentHistory = useMemo(() => history.slice(0, 8), [history])

  return (
    <div
      ref={rootRef}
      data-testid="browser-app"
      className="surface-panel flex h-full flex-col text-sm"
    >
      {/* 标签条：chips + 新建；关闭钮 44px 命中区在窄容器档。 */}
      <div
        data-testid="browser-tabs"
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-1.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active?.id
          return (
            <span
              key={tab.id}
              data-testid="browser-tab"
              data-active={isActive || undefined}
              className={`group flex shrink-0 items-center gap-1 rounded-md px-2 text-xs ${
                isActive
                  ? 'bg-surface-raised text-text'
                  : 'text-text-muted hover:bg-surface-raised/60'
              } ${narrow ? 'h-11' : 'h-7'}`}
            >
              <button
                type="button"
                className="max-w-36 truncate"
                onClick={() => setActiveId(tab.id)}
              >
                {tab.target === null ? t('browser.newTab') : tab.title}
              </button>
              <button
                type="button"
                data-testid="browser-tab-close"
                aria-label={t('browser.closeTab')}
                className={`flex items-center justify-center rounded text-text-muted hover:bg-surface-raised hover:text-text ${
                  narrow ? 'h-9 w-9' : 'h-5 w-5'
                }`}
                onClick={() => closeTab(tab.id)}
              >
                <X aria-hidden="true" size={11} weight="bold" />
              </button>
            </span>
          )
        })}
        <button
          type="button"
          data-testid="browser-new-tab"
          aria-label={t('browser.newTab')}
          className={`flex shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text ${
            narrow ? 'h-11 w-11' : 'h-7 w-7'
          }`}
          onClick={addTab}
        >
          <Plus aria-hidden="true" size={14} weight="bold" />
        </button>
      </div>

      {/* 工具栏：后退/前进/刷新 + 地址栏 + 星标/外开。 */}
      <div
        data-testid="browser-toolbar"
        className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1"
      >
        <button
          type="button"
          data-testid="browser-back"
          aria-label={t('browser.back')}
          className={toolbarButtonClass}
          disabled={!canBack}
          onClick={goBack}
        >
          <ArrowLeft aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          data-testid="browser-forward"
          aria-label={t('browser.forward')}
          className={toolbarButtonClass}
          disabled={!canForward}
          onClick={goForward}
        >
          <ArrowRight aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          data-testid="browser-reload"
          aria-label={t('browser.reload')}
          className={toolbarButtonClass}
          disabled={active?.target == null}
          onClick={reload}
        >
          <ArrowsClockwise aria-hidden="true" size={14} />
        </button>
        <input
          ref={addressRef}
          value={address}
          aria-label={t('browser.addressPlaceholder')}
          placeholder={t('browser.addressPlaceholder')}
          data-testid="browser-address"
          autoFocus
          className={`min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 text-xs text-text placeholder:text-text-tertiary focus:border-primary focus:outline-none ${
            narrow ? 'h-11' : 'h-7'
          }`}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            // 输入法组合期的 Enter 是选词确认（ime-guard 双重互锁）。
            if (event.key === 'Enter' && !isImeComposing(event.nativeEvent)) {
              event.preventDefault()
              navigate(address)
            }
          }}
        />
        <button
          type="button"
          data-testid="browser-bookmark"
          aria-label={bookmarked ? t('browser.bookmarkRemove') : t('browser.bookmarkAdd')}
          aria-pressed={bookmarked}
          className={`${toolbarButtonClass} ${bookmarked ? 'text-primary' : ''}`}
          disabled={active?.target == null}
          onClick={toggleBookmark}
        >
          <Star aria-hidden="true" size={15} weight={bookmarked ? 'fill' : 'regular'} />
        </button>
        <button
          type="button"
          data-testid="browser-open-external"
          aria-label={t('browser.openExternal')}
          className={toolbarButtonClass}
          disabled={active?.target == null}
          onClick={openExternal}
        >
          <ArrowSquareOut aria-hidden="true" size={15} />
        </button>
      </div>

      {/* 内容区：起始页（书签 + 最近访问）或代理 iframe。 */}
      {iframeSrc === null ? (
        <div data-testid="browser-home" className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="pb-2 text-xs text-text-muted">{t('browser.homeHint')}</p>
          <h3 className="pb-1 pt-3 text-[11px] font-medium text-text-muted">
            {t('browser.bookmarks')}
          </h3>
          {bookmarks.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t('browser.noBookmarks')}</p>
          ) : (
            <ul data-testid="browser-bookmark-list">
              {bookmarks.map((entry) => (
                <li key={entry.url}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text hover:bg-surface-raised"
                    onClick={() => navigate(entry.url, entry.url)}
                  >
                    <Star
                      aria-hidden="true"
                      size={12}
                      weight="fill"
                      className="shrink-0 text-primary"
                    />
                    <span className="min-w-0 truncate">
                      {entry.title}
                      <span className="ml-2 text-text-tertiary">{entry.url}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="pb-1 pt-3 text-[11px] font-medium text-text-muted">
            {t('browser.recent')}
          </h3>
          {recentHistory.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t('browser.noHistory')}</p>
          ) : (
            <ul data-testid="browser-history-list">
              {recentHistory.map((entry) => (
                <li key={`${entry.url}-${entry.visitedAt}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface-raised hover:text-text"
                    onClick={() => navigate(entry.url, entry.url)}
                  >
                    <span className="min-w-0 truncate">
                      {entry.title}
                      <span className="ml-2 text-text-tertiary">{entry.url}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <iframe
          key={iframeKey}
          data-testid="browser-iframe"
          src={iframeSrc}
          title={active?.title ?? t('app.browser.title')}
          // 代理文档是不透明 origin（无 allow-same-origin）：脚本可跑但拿不到
          // 宿主存储；allow-popups(-to-escape-sandbox) 让错误页「在新标签页
          // 打开」逃逸沙箱顶层浏览；allow-forms 支持站点自绘表单（GET 已重写）。
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </div>
  )
}
