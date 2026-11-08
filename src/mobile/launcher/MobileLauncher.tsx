import { useEffect, useRef, useState } from 'react'

import { FileText, FolderOpen } from '@phosphor-icons/react'

import { AppIcon } from '@/apps/app-icon'
import { prefersReducedMotion } from '@/components/pop-motion'
import { appDisplayName } from '@/apps/launch'
import { dirname } from '@/core/filesystem'
import { formatMessage, useTranslation } from '@/core/i18n'
import { systemVfs } from '@/services/vfs'
import { useAppStore } from '@/store/app-store'
import { useFilesTargetStore } from '@/store/files-target-store'
import { useMobileNavStore } from '@/store/mobile-nav-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

import { orderAppsForMobileGrid } from '../shared/mobile-app-order'
import {
  groupLauncherResults,
  LAUNCHER_FILE_SEARCH_DEBOUNCE_MS,
  LAUNCHER_GROUP_LIMIT,
  type LauncherFileMatch,
} from './launcher-file-search'
import { filterAppsForLauncher } from './launcher-filter'
import { useDebouncedValue } from './use-debounced-value'

/**
 * 移动启动器（M2-1，HANDOFF §4.0-1）：Bottom Sheet 应用抽屉——全部已安装
 * 应用（`useAppStore.apps` 经 `orderAppsForMobileGrid` 排序，与 Home 应用
 * 网格同一优先序纯函数）+ 顶部实时搜索框（按 manifest.name 大小写不敏感
 * 过滤，./launcher-filter 纯函数）+ 无结果空态文案。列表项整行命中区
 * ≥44×44px（DESIGN.md §35.3）；点击 = `mobile-nav-store.openApp(appId)`
 * 并回调 onClose 关闭抽屉（与 Home 其余入口同一导航语义，真实启动仍归
 * M1-6 AppHost）。
 *
 * 全域搜索（M4-1）：搜索框升为「应用 + 文件」双域——应用域即时过滤（现状
 * 不变），文件域走 `systemVfs.search('/')`（VFS 名称子串），输入防抖
 * LAUNCHER_FILE_SEARCH_DEBOUNCE_MS 才发起（use-debounced-value）、结果异步
 * 落地才 setState（不阻塞 UI）；命中按组展示（./launcher-file-search 纯
 * 函数装配：应用组在前、文件组在后，标题走 i18n，各组截断到
 * LAUNCHER_GROUP_LIMIT 条 + 静态截断提示，不做假按钮）。文件行显示完整
 * 路径；点击 = 先 `files-target-store.requestFilesTarget(dirname(path))`
 * 写定位意图（所在目录），再 openApp('files')——Files 已开 = 切回（在场
 * 实例订阅消费并导航，M3-2 窗口常驻），未开 = 新启动（挂载后消费），启动
 * 仍归 AppHost。**空查询 = 仅应用列表（M2-1 现状不变：无分组标题、零 VFS
 * 调用）**。
 *
 * 关闭路径（切片契约）：backdrop 点击与 Esc（document 捕获阶段）都回调
 * onClose——开关状态归持有方（MobileAppGrid 入口按钮），本组件自持的只有
 * 查询串、文件域结果与退场帧。搜索框打开即聚焦（桌面启动器 §0.4「打开即
 * 聚焦搜索框」的移动口径）；重新打开时查询串与文件域复位，不残留上一次
 * 的过滤。
 *
 * 过渡动效（DESIGN.md §35.5）：进出场 200ms 只动 transform/opacity（既有
 * token --ag-motion-base，档带 160–220ms 内）；prefers-reduced-motion 由
 * 全局 0.01ms 塌缩承接（index.css，不建第二套开关）；motion-prefs 的
 * 「窗口切换转场」档（useMotionPrefsStore.windowTilt——MobileAppHost 同款
 * 唯一转场开关）关闭时走 .mobile-launcher-static 直切。退场用「渲染滞后
 * 一拍」（MobileAppHost 同款）：open→false 后带 data-state='leaving' 播完
 * 退场再卸载，期间 pointer-events-none + aria-hidden，不挡底下 Home。
 *
 * 玻璃克制（DESIGN.md §35.1）：Bottom Sheet 是玻璃白名单五处之一——唯一
 * 玻璃层 = surface-glass 基底 + glass-raise（与 Dock 同档）；backdrop 遮罩
 * 是纯色压暗（非玻璃、零 blur），清单外不引入第二个 blur 面。
 */
/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const LAUNCHER_TRANSITION_MS = 200

/** 抽屉相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type LauncherPhase = 'closed' | 'open' | 'leaving'

export function MobileLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const apps = useAppStore((state) => state.apps)
  const openApp = useMobileNavStore((state) => state.openApp)
  // 文件域定位分发（M4-1）：请求「下一次 Files 呈现即定位到所在目录」。
  const requestFilesTarget = useFilesTargetStore((state) => state.requestFilesTarget)
  // 窗口切换转场档（motion-prefs）：关档 = 抽屉直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((state) => state.windowTilt)

  // 每次渲染重排 + 重滤（不 memo，MobileAppGrid 同口径）：locale 切换后
  // 需重取本地化展示名；过滤纯函数保序，排序职责单点在 mobile-app-order。
  const [query, setQuery] = useState('')
  const items = filterAppsForLauncher(orderAppsForMobileGrid(apps, appDisplayName), query)

  // ── 文件域（M4-1）：输入防抖后才认查询串；异步搜索结果单独持有。空查询
  //    或抽屉不在场即时清空文件域（重开不残留）。 ──────────────────────
  const [fileMatches, setFileMatches] = useState<LauncherFileMatch[]>([])
  const debouncedQuery = useDebouncedValue(query, LAUNCHER_FILE_SEARCH_DEBOUNCE_MS)
  const searchNeedle = debouncedQuery.trim()
  const isSearching = query.trim() !== ''
  const groups = groupLauncherResults(items, fileMatches)

  // ── 开关状态机：open↔false 在渲染期同步落到 phase（React「props 变化时
  //    调整派生 state」官方模式）。关键约束：open→false **不经 null 空档**
  //    ——退场帧与原树同一 commit 接续，sheet 元素不重挂（input 的 autoFocus
  //    不重触发，关闭回焦触发器不会被抢回；渲染滞后一拍再卸载 = MobileAppHost
  //    同款）。open→true 立即恢复入场；closed 才真正不渲染。
  //    重开复位（查询串 + 文件域）也放渲染期校正——若放 effect，重开首帧的
  //    搜索 effect 会带着上一次的 stale 查询串先跑一拍（多发一次过期搜索，
  //    结果再被下一帧取消）；渲染期先落 query='' ，effect 首跑即见空查询。 ──
  const [phase, setPhase] = useState<LauncherPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') {
    setPhase('open')
    setQuery('')
    setFileMatches([])
  }
  if (!open && phase === 'open') setPhase('leaving')

  // 退场帧计时：leaving 播完 200ms → closed（卸载）；期间重开由渲染期校正
  // 直接回 open，本 effect 的 cleanup 撤销未到的计时器。退场/关闭期间文件
  // 域结果原样保留（退场动画内容不塌陷），重开时才复位。
  useEffect(() => {
    if (phase !== 'leaving') return
    // 减弱动效/静态档退场立即收尾（F1 审查：不再看 200ms 静止遮罩）。
    const timer = window.setTimeout(
      () => setPhase('closed'),
      prefersReducedMotion() ? 0 : LAUNCHER_TRANSITION_MS,
    )
    return () => window.clearTimeout(timer)
  }, [phase])

  // ── 文件域搜索（M4-1）：防抖后的查询串驱动 systemVfs.search（异步，
  //    结果落地才 setState，不阻塞 UI）。门控用**即时查询** isSearching 而
  //    非防抖镜像：重开抽屉时 query 已复位但 debouncedQuery 要等 200ms 才
  //    同步，若以 needle 判空会拿 stale 词多搜一拍；即时门下重开/清空输入
  //    即时清文件域，防抖镜像只作搜索参数（重开后再输入同词也能靠
  //    isSearching 翻转触发）。cancelled 标志吃掉过期响应（查询串已再变化
  //    或已退场的迟到结果不入 state，后发搜索覆盖先发）。搜索失败 = 安全
  //    回退空文件域（能力不可用不摆假结果）。 ──────────────────────────
  useEffect(() => {
    // leaving 帧不清空（与本 effect 上方注释一致：退场动画内容不塌陷）；
    // 清空只发生在 open 相位内的非搜索态（F1 审查：旧实现 leaving 也清，
    // 关闭抽屉 200ms 退场里文件组塌陷、sheet 高度收缩）。
    if (phase === 'leaving') return
    if (phase !== 'open' || !isSearching || searchNeedle === '') {
      setFileMatches((current) => (current.length === 0 ? current : []))
      return
    }
    let cancelled = false
    void systemVfs
      .search('/', searchNeedle)
      .then((results) => {
        if (cancelled) return
        setFileMatches(
          results.map(({ node, path: resultPath }) => ({
            name: node.name,
            path: resultPath,
            type: node.type,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setFileMatches([])
      })
    return () => {
      cancelled = true
    }
  }, [phase, isSearching, searchNeedle])

  // ── Esc 关闭：document 捕获阶段（桌面弹层契约 §0.4 的移动口径，不参与
  //    桌面 popover-store 互斥——移动侧没有多弹层并存面）；onClose 走 ref
  //    免监听重挂；只在 open 相位监听（leaving 已在退场，不重复回调）。 ──
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (phase !== 'open') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  if (phase === 'closed') return null

  const select = (appId: string): void => {
    // 选中即分发：openApp 推进导航（AppHost 真实启动）+ 关闭抽屉——App 视
    // 图挂起后 Home 卸载，抽屉随宿主树一起退场，无需等待退场动画。
    openApp(appId)
    onClose()
  }

  const openFileLocation = (file: LauncherFileMatch): void => {
    // 文件结果即分发（M4-1）：先写定位意图（所在目录 = dirname，目录结果
    // 的所在目录即其父目录），再 openApp 推进导航 + 关闭抽屉——与选中应用
    // 同一分发形态：Files 已开 = 切回（在场 FileManager 订阅
    // files-target-store 消费并导航，M3-2 窗口常驻），未开 = 新启动（挂载
    // 后消费）；真实目录导航归 FileManager，启动仍归 AppHost。
    // appId 与 Dock/注册表同一字面量（仓库无共享常量，builtin-manifests 为准）。
    requestFilesTarget(dirname(file.path))
    openApp('com.ageha.files')
    onClose()
  }

  // 应用行渲染（空查询单列表与搜索态应用组共用同一形态：AppIcon 装饰位 +
  // 本地化展示名，整行命中区 ≥44×44）。
  const renderAppItem = (app: { id: string }) => (
    <li key={app.id}>
      <button
        type="button"
        data-testid="mobile-launcher-item"
        data-app-id={app.id}
        onClick={() => select(app.id)}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-opacity active:opacity-80"
      >
        {/* AppIcon 无 label = 装饰位（aria-hidden），可访问名由
            应用名文本承担（网格/最近使用同口径）。 */}
        <AppIcon appId={app.id} size={44} />
        <span
          className="min-w-0 truncate text-sm"
          style={{ color: 'var(--ag-text)' }}
        >
          {appDisplayName(app.id)}
        </span>
      </button>
    </li>
  )

  return (
    <div
      data-testid="mobile-launcher"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-launcher fixed inset-0 z-20 ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${transitionsOn ? '' : 'mobile-launcher-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭（切片契约）。 */}
      <div
        data-testid="mobile-launcher-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-launcher-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock 同档 blur 20px），顶部发丝边；锚底升出，
          上限 80% 视口给 Home 留呼吸。 */}
      <div
        data-testid="mobile-launcher-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.launcher.open')}
        className="mobile-launcher-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        {/* 抓手条：纯装饰（aria-hidden），Bottom Sheet 的形态语言。 */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--ag-border-strong)' }}
        />
        <div className="shrink-0 px-4 pb-2 pt-3">
          <input
            data-testid="mobile-launcher-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('mobile.launcher.searchPlaceholder')}
            aria-label={t('mobile.launcher.searchPlaceholder')}
            autoFocus
            className="h-11 w-full rounded-xl border px-3 text-sm transition-opacity focus:outline-none"
            style={{
              borderColor: 'var(--ag-border-subtle)',
              color: 'var(--ag-text)',
              backgroundColor: 'var(--ag-surface-raised)',
            }}
          />
        </div>
        {/* 列表滚动容器：overscroll-contain 防滚动链传给壳根（与
            .mobile-content-scroll 同口径）；行命中区 ≥44×44（§35.3）。
            空查询 = 仅应用单列表（M2-1 现状不变）；搜索态 = 分组渲染
            （应用组在前、文件组在后，launcher-file-search 装配，空组缺席）。 */}
        <div
          data-testid="mobile-launcher-list"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
        >
          {!isSearching ? (
            <ul data-testid="mobile-launcher-items">
              {items.map((app) => renderAppItem(app))}
            </ul>
          ) : (
            <>
              {groups.apps && (
                <section aria-label={t('mobile.launcher.groupApps')}>
                  <h3
                    data-testid="mobile-launcher-group-apps"
                    className="px-2 pb-1 pt-2 text-xs font-medium"
                    style={{ color: 'var(--ag-text-muted)' }}
                  >
                    {t('mobile.launcher.groupApps')}
                  </h3>
                  <ul>{groups.apps.items.map((app) => renderAppItem(app))}</ul>
                  {groups.apps.truncated && (
                    <LauncherTruncationHint total={groups.apps.total} />
                  )}
                </section>
              )}
              {groups.files && (
                <section aria-label={t('mobile.launcher.groupFiles')}>
                  <h3
                    data-testid="mobile-launcher-group-files"
                    className="px-2 pb-1 pt-2 text-xs font-medium"
                    style={{ color: 'var(--ag-text-muted)' }}
                  >
                    {t('mobile.launcher.groupFiles')}
                  </h3>
                  <ul data-testid="mobile-launcher-file-items">
                    {groups.files.items.map((file) => (
                      <li key={file.path}>
                        <button
                          type="button"
                          data-testid="mobile-launcher-file-item"
                          data-file-path={file.path}
                          onClick={() => openFileLocation(file)}
                          className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-opacity active:opacity-80"
                        >
                          {/* 目录/文件图标 = 装饰位（aria-hidden），与 Files
                              应用同款形态语言；可访问名由名称文本承担。 */}
                          {file.type === 'directory' ? (
                            <FolderOpen
                              aria-hidden="true"
                              size={28}
                              weight="fill"
                              className="shrink-0 text-primary/80"
                            />
                          ) : (
                            <FileText
                              aria-hidden="true"
                              size={28}
                              weight="fill"
                              className="shrink-0 text-text-muted/70"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate text-sm"
                              style={{ color: 'var(--ag-text)' }}
                            >
                              {file.name}
                            </span>
                            {/* 完整路径：数据层等宽字体（切片契约「文件项
                                显示路径」，Files 应用搜索结果同口径）。 */}
                            <span className="block truncate font-mono text-[11px] text-text-muted">
                              {file.path}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {groups.files.truncated && (
                    <LauncherTruncationHint total={groups.files.total} />
                  )}
                </section>
              )}
              {/* 无结果空态：状态文案不是可点死元素（§35.7 空态铁律的搜索
                  口径——缺席的是结果，抽屉本身在场）。 */}
              {!groups.apps && !groups.files && (
                <p
                  data-testid="mobile-launcher-empty"
                  className="px-4 py-6 text-center text-sm"
                  style={{ color: 'var(--ag-text-muted)' }}
                >
                  {t('mobile.launcher.empty')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 静态截断提示（M4-1）：该组命中超过每组上限时的状态文案——带全量计数与
 * 上限两个真实参数，不是可点元素（无假按钮，DESIGN.md §0.5 真实性铁律；
 * 想看更多请收窄查询，本片不设「展开更多」交互）。
 */
function LauncherTruncationHint({ total }: { total: number }) {
  const { t } = useTranslation()
  return (
    <p
      data-testid="mobile-launcher-truncated"
      className="px-2 py-1.5 text-xs"
      style={{ color: 'var(--ag-text-muted)' }}
    >
      {formatMessage(t('mobile.launcher.groupTruncated'), {
        count: String(total),
        limit: String(LAUNCHER_GROUP_LIMIT),
      })}
    </p>
  )
}
