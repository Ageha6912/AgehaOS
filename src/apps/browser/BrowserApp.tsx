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

import { formatMessage, useTranslation } from '@/core/i18n'
import { isImeComposing } from '@/components/ime-guard'
import { useNarrowContainer } from '@/apps/use-narrow-container'

import { useBrowserStore } from './browser-store'
import { clearSiteData, fetchSiteDataSummary, type SiteDataSummary } from './browser-cookies'
import { displayForTarget, proxyUrlFor, targetForInput, titleForTarget } from './browser-nav'

/**
 * 浏览器应用（档 C：窗口内浏览 + 真实浏览兜底）。
 *
 * 内容经 /api/browse 服务端代理回流（SSRF 闸 + HTML 重写，含 POST 表单原始
 * 体转发与附件直通），窗口内呈现；代理拒绝/上游失败的页面由代理侧错误页兜底
 * 「在新标签页打开」——顶层标签不受任何嵌入限制。搜索走搜狗 Web 端点
 * （中文优先；结果链接经代理重写后窗口内直接可达）。
 *
 * 交互面：标签页（新建/关闭）+ 地址栏（域名直访 / 关键词搜索）+
 * 后退/前进/刷新 + 星标收藏 + 新标签打开；起始页 = 书签 + 最近访问
 * （browser-store，设备本地持久化）。
 *
 * **保活（2026-10-18）**：历史项条目化（TrailEntry 带稳定 id），iframe 按
 * 条目渲染、切前方标签/非活动标签用 display:none 掩藏而非卸载——后退/前进
 * 秒开、切标签不重载；仅刷新（reloadSeq）重挂当前条目、新导航截断卸载前向
 * 条目。保活窗口 = 最近 KEEP_ALIVE_BACK 个后方条目 + 当前条目（内存有界）。
 */

export interface TrailEntry {
  /** 稳定条目 id（iframe key 用；同 URL 两次入栈也不撞）。 */
  id: string
  url: string
  /** 刷新计数：+1 即重挂该条目的 iframe（同 src 不重载的 React 语义）。 */
  reloadSeq: number
}

export interface BrowserTab {
  id: string
  /** 目标 URL 栈（后退/前进）；空栈 = 起始页。 */
  trail: TrailEntry[]
  /** 当前条目下标；-1 = 起始页。 */
  index: number
}

export interface BrowserAppProps {
  windowId: string
}

/** 保活窗口：当前条目前后各 N 个条目常驻 iframe（双向秒开、内存有界）。 */
const KEEP_ALIVE_BACK = 5
const KEEP_ALIVE_AHEAD = 5

let tabSeq = 0
let trailSeq = 0

function newTab(): BrowserTab {
  tabSeq += 1
  return { id: `tab-${tabSeq}`, trail: [], index: -1 }
}

function newTrailEntry(url: string): TrailEntry {
  trailSeq += 1
  return { id: `e-${trailSeq}`, url, reloadSeq: 0 }
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
  /** 地址栏「待全选」标记（导航后/新聚焦时置位）：浏览器在 mousedown/mouseup
   *  的默认动作里按点击落点重置选区——在 mouseup 处 preventDefault 并**重新
   *  select()** 才能保住全选（点地址栏打字=替换）。首次 mouseup 消费标记；
   *  已全选后再点一次（标记已清）正常落光标改局部（地址栏惯例）。 */
  const addressSelectPendingRef = useRef(false)
  // 站点数据（服务端 Cookie 罐）元信息：null = 不可用（本地预览/未登录）→ 隐藏区块。
  const [siteData, setSiteData] = useState<SiteDataSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSiteDataSummary().then((summary) => {
      if (!cancelled) setSiteData(summary)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const activeEntry =
    active !== undefined && active.index >= 0 ? active.trail[active.index] : undefined
  const currentUrl = activeEntry?.url ?? null

  // 切标签/导航/后退前进后地址栏跟随当前条目（起始页清空并聚焦）。
  useEffect(() => {
    setAddress(currentUrl === null ? '' : displayForTarget(currentUrl))
    if (currentUrl === null) {
      addressRef.current?.focus()
    } else {
      // 导航后惯例（Chrome 同款）：地址栏内容处于全选，点击后打字即替换。
      addressSelectPendingRef.current = true
      addressRef.current?.select()
    }
  }, [activeId, currentUrl])

  const updateTab = (id: string, patch: Partial<BrowserTab>): void =>
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))

  /** 导航入口：地址栏输入/起始页点击都收敛到这里（新条目截断前向栈）。 */
  const navigate = (raw: string, explicitTarget?: string): void => {
    if (active === undefined) return
    const target = explicitTarget ?? targetForInput(raw)
    if (target === null) return
    const entry = newTrailEntry(target)
    updateTab(active.id, {
      trail: [...active.trail.slice(0, active.index + 1), entry],
      index: active.index + 1,
    })
    recordVisit(target, titleForTarget(target))
  }

  /** 后退/前进：只挪 index——目标条目在保活窗口内即秒开（iframe 不重挂）。 */
  const step = (delta: 1 | -1): void => {
    if (active === undefined) return
    const next = active.index + delta
    if (next < 0 || next >= active.trail.length) return
    updateTab(active.id, { index: next })
  }

  const reload = (): void => {
    if (active === undefined || activeEntry === undefined) return
    updateTab(active.id, {
      trail: active.trail.map((entry) =>
        entry.id === activeEntry.id ? { ...entry, reloadSeq: entry.reloadSeq + 1 } : entry,
      ),
    })
  }

  const openExternal = (): void => {
    if (currentUrl !== null) window.open(currentUrl, '_blank', 'noopener,noreferrer')
  }

  const bookmarked = currentUrl !== null && bookmarks.some((entry) => entry.url === currentUrl)

  const toggleBookmark = (): void => {
    if (currentUrl === null) return
    if (bookmarked) removeBookmark(currentUrl)
    else addBookmark(currentUrl, titleForTarget(currentUrl))
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

  const tabTitle = (tab: BrowserTab): string => {
    const entry = tab.index >= 0 ? tab.trail[tab.index] : undefined
    return entry === undefined ? t('browser.newTab') : titleForTarget(entry.url)
  }

  const canBack = active !== undefined && active.index > 0
  const canForward =
    active !== undefined && active.index >= 0 && active.index < active.trail.length - 1

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
                {tabTitle(tab)}
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
          onClick={() => step(-1)}
        >
          <ArrowLeft aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          data-testid="browser-forward"
          aria-label={t('browser.forward')}
          className={toolbarButtonClass}
          disabled={!canForward}
          onClick={() => step(1)}
        >
          <ArrowRight aria-hidden="true" size={15} />
        </button>
        <button
          type="button"
          data-testid="browser-reload"
          aria-label={t('browser.reload')}
          className={toolbarButtonClass}
          disabled={currentUrl === null}
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
          // 浏览器惯例：点地址栏打字 = 替换旧地址（而非追加）。
          // 0.6.1 首修只挂 focus 的 select()，被真实浏览器点击默认动作的落点
          // 覆盖（E2E 复验到「example.comwww.sogou.com」）——现在在 mouseup
          // 处 preventDefault 并重新 select()，保住导航后/聚焦时的全选；
          // 已全选后再点一次落光标改局部（惯例第二档）。
          onFocus={(event) => {
            addressSelectPendingRef.current = true
            event.currentTarget.select()
          }}
          onMouseUp={(event) => {
            if (addressSelectPendingRef.current) {
              addressSelectPendingRef.current = false
              event.preventDefault()
              event.currentTarget.select()
            }
          }}
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
          disabled={currentUrl === null}
          onClick={toggleBookmark}
        >
          <Star aria-hidden="true" size={15} weight={bookmarked ? 'fill' : 'regular'} />
        </button>
        <button
          type="button"
          data-testid="browser-open-external"
          aria-label={t('browser.openExternal')}
          className={toolbarButtonClass}
          disabled={currentUrl === null}
          onClick={openExternal}
        >
          <ArrowSquareOut aria-hidden="true" size={15} />
        </button>
      </div>

      {/* 内容区：起始页（书签 + 最近访问）或保活 iframe 组。 */}
      {activeEntry === undefined && (
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
          {/* 站点数据（服务端 Cookie 罐）：只显示条目数，值永不离开服务端。 */}
          {siteData !== null && (
            <div className="pt-3" data-testid="browser-site-data">
              <h3 className="pb-1 text-[11px] font-medium text-text-muted">
                {t('browser.siteData')}
              </h3>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-text-tertiary">
                  {siteData.count === 0
                    ? t('browser.siteDataNone')
                    : formatMessage(t('browser.siteDataCount'), {
                        count: String(siteData.count),
                      })}
                </p>
                <button
                  type="button"
                  data-testid="browser-site-data-clear"
                  disabled={siteData.count === 0}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    void clearSiteData().then((cleared) => {
                      if (cleared) setSiteData({ count: 0, origins: [] })
                    })
                  }}
                >
                  {t('browser.siteDataClear')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 保活 iframe 组：活动标签当前条目可见，其余（当前条目 ±5 窗口内 +
        非活动标签全部在窗条目）display:none 常驻——后退/前进/切标签零重载。 */}
      {tabs.map((tab) => {
        const isActiveTab = tab.id === active?.id
        if (tab.index < 0) return null
        const start = Math.max(0, tab.index - KEEP_ALIVE_BACK)
        const end = Math.min(tab.trail.length, tab.index + 1 + KEEP_ALIVE_AHEAD)
        return tab.trail.slice(start, end).map((entry) => {
          const visible = isActiveTab && entry.id === activeEntry?.id
          return (
            <iframe
              key={`${tab.id}:${entry.id}:${entry.reloadSeq}`}
              data-testid="browser-iframe"
              data-url={entry.url}
              data-active={visible || undefined}
              src={proxyUrlFor(entry.url)}
              title={titleForTarget(entry.url)}
              // 代理文档是不透明 origin（无 allow-same-origin）：脚本可跑但拿不到
              // 宿主存储；allow-popups(-to-escape-sandbox) 让错误页「在新标签页
              // 打开」逃逸沙箱顶层浏览；allow-forms 支持站点表单（action 已重写）；
              // allow-downloads 让附件（content-disposition）直达下载。
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              referrerPolicy="no-referrer"
              className={visible ? 'min-h-0 w-full flex-1 border-0 bg-white' : 'hidden'}
            />
          )
        })
      })}
    </div>
  )
}
