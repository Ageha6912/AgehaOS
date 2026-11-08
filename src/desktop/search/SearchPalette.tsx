import { useEffect, useMemo, useRef, useState } from 'react'

import { File, MagnifyingGlass } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { launchApp } from '@/apps/launch'
import { componentFor } from '@/apps/builtin'
import { formatMessage, useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { filterContentText } from '@/core/dynamic/content/filter'
import { systemEclosion } from '@/services/eclosion'
import { systemVfs } from '@/services/vfs'
import { useAppStore } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useSearchStore } from '@/store/search-store'
import { useUsageStore } from '@/store/usage-store'
import type { VfsSearchResult } from '@/core/filesystem'

import { popoverMotionClass, useExitPhase } from '@/components/pop-motion'
import { isImeComposing } from '@/components/ime-guard'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'

import { limitFiles, rankApps, type SearchableApp } from './search'

/**
 * 全局搜索面板（PRD §15，Ctrl+K；Shell 3.0 STEP 9 精修为 Raycast/Spotlight
 * 形态）：视口居中 640px（600-720 档）大玻璃面板，结构自上而下 =
 * Search（大号无边框搜索行 + 放大镜）→ 结果区（空查询 = 真实「最近使用」
 * 速览；输入后 = Apps → Files → Actions 三段）→ 底部按键提示条（kbd 芯片）。
 *
 * 能力契约（§23 不变量，全部保留）：搜索逻辑（rankApps/VFS 搜索）、键盘
 * 导航（↑↓ 选择、Enter 打开/生成、Esc 关闭）、testid（search-*）、激活行
 * `bg-primary/10`、pop-motion 动效、bg-scrim 遮罩。
 *
 * Actions 区即想象域（羽化 P3，AI-GENERATED-APPS-DESIGN §7——恒排两域之后，
 * 「✦ 即时羽化…」文案与 Enter 生成不变；从「结果」重归「动作」语义）。
 * 文件结果现阶段经 Files 应用打开——「携带文件参数启动应用」（§24.3）
 * 依赖 launch 参数化，属后续工作。
 *
 * 想象域门控（§7 双端过滤的客户端半场）：输入 trim ≥2 字、羽化模式开启、
 * filterContentText 非违规（违规直接不显示想象项）；服务端 classifier 是
 * 第二道闸。Enter/点击走生成而非 launchApp。
 */

/** 空查询「最近使用」速览行数（usage-store 真数据，装不下的不显示）。 */
const RECENT_RESULTS_LIMIT = 6

export function SearchPalette() {
  const { t } = useTranslation()
  const open = useSearchStore((s) => s.open)
  const close = useSearchStore((s) => s.close)
  const apps = useAppStore((s) => s.apps)
  const eclosionEnabled = useEclosionStore((s) => s.enabled)
  const recent = useUsageStore((s) => s.recent)

  const phase = useExitPhase(open)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<VfsSearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // 自带遮罩点击与输入框 Esc，只参与弹层互斥（打开搜索即收起启动器等）。
  usePopoverDismiss('search', open, close, { dismissible: false })

  const searchableApps = useMemo(
    () =>
      apps.map((app) => {
        const meta = componentFor(app.id)
        return { id: app.id, name: app.name, title: meta ? t(meta.titleKey) : app.name }
      }),
    [apps, t],
  )
  const appHits = useMemo(() => rankApps(query, searchableApps), [query, searchableApps])
  // 空查询速览：真实「最近使用」（usage-store，只记用户主动启动），仅显示
  // 仍安装的应用；一旦输入即让位于搜索结果（Spotlight 建议语义）。
  const recentHits = useMemo(() => {
    if (query.trim().length > 0) return []
    return recent
      .map((entry) => searchableApps.find((app) => app.id === entry.appId))
      .filter((app): app is SearchableApp => app !== undefined)
      .slice(0, RECENT_RESULTS_LIMIT)
  }, [query, recent, searchableApps])
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
  const total = recentHits.length + appHits.length + fileHits.length + (imagineVisible ? 1 : 0)
  // 结果收缩时把激活项钳在有效区间（E2 审查）：旧实现 ArrowDown 在 total=0
  // 时得到 -1，之后结果异步到达也没有行 active，Enter 可能误走想象域分支。
  const activeIndex = Math.min(active, Math.max(total - 1, 0))
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
    if (activeIndex < recentHits.length) {
      const hit = recentHits[activeIndex]
      if (hit) openApp(hit.id)
    } else if (activeIndex < recentHits.length + appHits.length) {
      const hit = appHits[activeIndex - recentHits.length]
      if (hit) openApp(hit.id)
    } else if (activeIndex < recentHits.length + appHits.length + fileHits.length) {
      if (fileHits.length > 0) openFile()
    } else if (imagineVisible) {
      generateImagine()
    }
  }

  // 分组头（§22 STEP 8 同款 11px 标签；en 文案不经 uppercase 变换）。
  const sectionLabel = (labelKey: MessageKey) => (
    <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-text-muted">{t(labelKey)}</p>
  )
  // 应用行（最近使用与应用域同款渲染；激活行 bg-primary/10 是 §23 契约）。
  const appRow = (
    hit: SearchableApp,
    flatIndex: number,
    testId: string,
    onOpen: () => void,
  ) => {
    const isActive = flatIndex === activeIndex
    return (
      <li key={hit.id}>
        <button
          type="button"
          data-testid={testId}
          aria-label={hit.title}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
            isActive ? 'bg-primary/10 text-text' : 'text-text hover:bg-surface-raised'
          }`}
          onMouseEnter={() => setActive(flatIndex)}
          onClick={onOpen}
        >
          <AppIcon appId={hit.id} size={16} />
          <span className="min-w-0 truncate">{hit.title}</span>
          {isActive && (
            <span className="ml-auto shrink-0">
              <Kbd>↵</Kbd>
            </span>
          )}
        </button>
      </li>
    )
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
        aria-modal="true"
        aria-label={t('search.placeholder')}
        data-testid="search-palette"
        className={`surface-glass glass-popover w-[40rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border shadow-popover ${popoverMotionClass(phase.exiting)}`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Search 行：Raycast 式大号无边框输入 + 放大镜（右键位提示交给底部条）。 */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
          <MagnifyingGlass size={18} weight="bold" aria-hidden="true" className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            data-testid="search-input"
            className="w-full min-w-0 bg-transparent text-[15px] text-text placeholder:text-text-tertiary focus:outline-none"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              // 输入法组合期（选词/翻候选）：Enter 确认候选、Esc 取选词，
              // 都不是「打开结果/关闭面板」手势，整段忽略。
              if (isImeComposing(event.nativeEvent)) return
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                // total=0 时保持 0（旧实现给 -1）。
                setActive((index) => Math.min(index + 1, Math.max(total - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                openActive()
              }
            }}
          />
        </div>

        <div className="scroll-thin max-h-[24rem] overflow-y-auto px-2 py-2" data-testid="search-results">
          {total === 0 &&
            (trimmed ? (
              <p className="px-2 py-6 text-center text-xs text-text-muted">{t('search.empty')}</p>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-text-tertiary">
                {t('search.emptyQuery')}
              </p>
            ))}

          {/* 空查询：真实「最近使用」速览（launcher.recent 与启动器同一数据）。 */}
          {recentHits.length > 0 && (
            <section aria-label={t('launcher.recent')}>
              {sectionLabel('launcher.recent')}
              <ul data-testid="search-recent-list">
                {recentHits.map((hit, index) => appRow(hit, index, 'search-result-recent', () => openApp(hit.id)))}
              </ul>
            </section>
          )}

          {appHits.length > 0 && (
            <section aria-label={t('search.apps')}>
              {sectionLabel('search.apps')}
              <ul>
                {appHits.map((hit, index) =>
                  appRow(
                    hit,
                    recentHits.length + index,
                    'search-result-app',
                    () => openApp(hit.id),
                  ),
                )}
              </ul>
            </section>
          )}

          {fileHits.length > 0 && (
            <section aria-label={t('search.files')}>
              {sectionLabel('search.files')}
              <ul>
                {fileHits.map((hit, index) => {
                  const flatIndex = recentHits.length + appHits.length + index
                  const isActive = flatIndex === activeIndex
                  return (
                    <li key={hit.path}>
                      <button
                        type="button"
                        data-testid="search-result-file"
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                          isActive ? 'bg-primary/10 text-text' : 'text-text hover:bg-surface-raised'
                        }`}
                        onMouseEnter={() => setActive(flatIndex)}
                        onClick={openFile}
                      >
                        <File size={16} weight="regular" aria-hidden="true" className="shrink-0 text-text-muted" />
                        <span className="min-w-0">
                          <span className="block truncate">{hit.node.name}</span>
                          <span className="block truncate text-[11px] text-text-tertiary">{hit.path}</span>
                        </span>
                        {isActive && (
                          <span className="ml-auto shrink-0">
                            <Kbd>↵</Kbd>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Actions 区 = 想象域（§7）：恒排最后；行首主色 ✦ 由组件着色，
              词典文案只含「即时羽化「<query>」应用」（避免双 ✦）。 */}
          {imagineVisible && (
            <section aria-label={t('search.actions')}>
              {sectionLabel('search.actions')}
              <ul>
                <li>
                  <button
                    type="button"
                    data-testid="search-result-imagine"
                    aria-label={formatMessage(t('search.imagineItem'), { query: trimmed })}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                      total - 1 === activeIndex ? 'bg-primary/10 text-text' : 'text-text hover:bg-surface-raised'
                    }`}
                    onMouseEnter={() => setActive(total - 1)}
                    onClick={generateImagine}
                  >
                    <span aria-hidden="true" className="shrink-0 text-primary">
                      ✦
                    </span>
                    <span className="min-w-0 truncate">
                      {formatMessage(t('search.imagineItem'), { query: trimmed })}
                    </span>
                    {total - 1 === activeIndex && (
                      <span className="ml-auto shrink-0">
                        <Kbd>↵</Kbd>
                      </span>
                    )}
                  </button>
                </li>
              </ul>
            </section>
          )}
        </div>

        {/* 底部按键提示条（Raycast 式 kbd 芯片；装饰性，真实键盘模型在输入框）。 */}
        <footer
          data-testid="search-footer"
          className="flex items-center gap-4 border-t border-border-subtle px-4 py-2 text-[11px] text-text-muted"
        >
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t('search.hint.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            {t('search.hint.open')}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            {t('search.hint.close')}
          </span>
        </footer>
      </div>
    </div>
  )
}

/** 按键芯片（底部提示条 / 激活行行尾回车提示；纯装饰，10px 徽章豁免档）。 */
function Kbd({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden="true"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border-subtle bg-surface-soft px-1 text-[11px] font-medium leading-none text-text-muted"
    >
      {children}
    </kbd>
  )
}
