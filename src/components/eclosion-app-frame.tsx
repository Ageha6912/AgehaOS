import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation, formatMessage, getLocale } from '@/core/i18n'
import { systemBus } from '@/core/events'
import { filterContentText } from '@/core/dynamic/content/filter'
import { handleSdkRequest, requiredPermission, SDK_RESULT_TYPE } from '@/core/apps/sdk-bridge'
import { ECLOSION_RUNNER_ENTRY, WEB_APP_SANDBOX, hostHelloMessage } from '@/core/apps/web-app'
import type { Permission } from '@/core/permissions'
import {
  parseRunnerToHostMessage,
  sdkCapabilitiesForPermissions,
} from '@/core/eclosion/runner-protocol'
import { eclosionAppKind, findEclosionSpecByAppId, type EclosionSpec } from '@/core/eclosion/spec'
import { MissingApp } from '@/apps/placeholder-app'
import { CalculatorApp } from '@/apps/calculator/CalculatorApp'
import { NotesApp } from '@/apps/notes/NotesApp'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { sdkFilePort } from '@/services/sdk-file-port'
import { themeStyleChunkHtml } from '@/services/eclosion-theme'
import {
  ECLOSION_RENDER_TIMEOUT_MS,
  systemEclosion,
  type EclosionOrchestrator,
  type EclosionSession,
  type EclosionSessionSnapshot,
} from '@/services/eclosion'
import { WebAppFrame } from '@/components/web-app-frame'
import { version as appVersion } from '../../package.json'

/**
 * 握手超时（E3 审查）：iframe load 后这么久仍未收到 `agehaos:ready`（runner
 * 脚本异常 / CSP 拦截 / 扩展拦截 / 消息丢失）→ 走质量回退重试，避免窗口
 * 永久停在「结茧中」且无任何反馈。
 */
export const ECLOSION_HANDSHAKE_TIMEOUT_MS = 8_000

/**
 * 羽化宿主容器（AI-GENERATED-APPS-DESIGN §4/§5.4）：把 AI 生成的自包含 HTML
 * 经分片协议装进 `sandbox="allow-scripts"`（不透明 origin）的 iframe。
 *
 * 安全契约（§4.1 四层隔离在宿主侧的三道）：
 * - iframe 只加载 ECLOSION_RUNNER_ENTRY（?v= 破缓存，坑 70），sandbox 只有
 *   allow-scripts；
 * - postMessage 只接受 `event.source === iframe.contentWindow` 严格相等且过
 *   runner-protocol 白名单（恰四类，多余字段丢弃）的消息；
 * - `<script>` 内容截留在宿主侧（html-stream 分片保证），流结束才随
 *   `eclosion:power-on` 注入（「页面先成形、再破茧」）。
 *
 * 可靠性（§5.2 质量回退）：破茧后 5 秒无 rendered 或收到 eclosion:error →
 * 自动重试一次 → 再失败渲染原生兜底并在标题栏提示「已回落经典版」。
 * 任何 AI 环节失败都不阻塞桌面。
 */

export interface EclosionAppFrameProps {
  appId: string
  windowId: string
  /** 基础标题（回落时追加「已回落经典版」）。 */
  title: string
  /** 测试注入编排器（缺省单例；NotesApp vfs? 同款先例）。 */
  orchestrator?: EclosionOrchestrator
}

// ── 原生兜底（§2.1：羽化关闭 / AI 不可用 / 生成失败） ─────────────────────

function EclosionNativeFallback({
  spec,
  windowId,
  title,
}: {
  spec: EclosionSpec
  windowId: string
  title: string
}) {
  if (spec.fallback.kind === 'component') {
    return spec.fallback.component === 'calculator' ? (
      <CalculatorApp />
    ) : (
      <NotesApp windowId={windowId} />
    )
  }
  return (
    <WebAppFrame entry={spec.fallback.entry} appId={spec.appId} windowId={windowId} title={title} />
  )
}

// ── 标题栏配件（§5.4/§10：徽标 + 重新羽化 + 获取 + 举报 + 密码框红色警示） ──

export function EclosionTitleExtras({
  appId,
  windowId,
  onRegenerate,
  onKeep,
  onReport,
}: {
  appId: string
  /** 举报成功后要关闭的窗口（§10：本地立即关闭 + 会话封禁）。 */
  windowId: string
  /** 测试注入；缺省走编排器单例。 */
  onRegenerate?: (appId: string) => void
  /** 测试注入「获取」（L2/留存域）；缺省走编排器单例。 */
  onKeep?: (appId: string) => Promise<boolean>
  /** 测试注入「举报」（§10）；缺省走编排器单例。 */
  onReport?: (appId: string, windowId: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const status = useEclosionStore((s) => s.statuses[appId])
  const keptAlready = useEclosionStore((s) => s.keptAppIds.includes(appId))
  // 治理门禁（E3 审查）：已举报封禁/羽化总开关关时，标题栏三维动作一律禁用
  // ——旧实现重开窗口后「重新羽化/获取」照样可点，会白烧额度/把封禁内容写回。
  const banned = useEclosionStore((s) => s.bannedAppIds.includes(appId))
  const enabled = useEclosionStore((s) => s.enabled)
  const [keptNow, setKeptNow] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportFailed, setReportFailed] = useState(false)
  const kind = eclosionAppKind(appId)
  const kept = keptAlready || keptNow

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* 「AI 生成」徽标已按 2026-10-03 用户裁决移除（原 §10「不可隐藏」条款作废）；
          密码框红色警示保留——那是防钓鱼的功能性警示，不是来源标识。 */}
      <button
        type="button"
        data-testid="eclosion-regenerate"
        aria-label={t('eclosion.regenerate')}
        title={t('eclosion.regenerate')}
        disabled={banned || !enabled}
        // 标题栏拖拽会吃指针：按下即拦（与红绿灯同款）。
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (onRegenerate ?? ((id: string) => systemEclosion.regenerate(id)))(appId)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none text-text-muted hover:bg-surface-soft hover:text-text disabled:cursor-default disabled:opacity-40"
      >
        ↻ {t('eclosion.regenerate')}
      </button>
      {/* 「获取」（§6.4/§7/§8）：L2 今日域与 L3 想象域留 HTML 快照进「我的羽化」。 */}
      {(kind === 'today' || kind === 'imagine') && (
        <button
          type="button"
          data-testid="eclosion-keep"
          aria-label={kept ? t('eclosion.kept') : t('eclosion.keep')}
          title={kept ? t('eclosion.kept') : t('eclosion.keep')}
          disabled={kept || banned || !enabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            void (onKeep ?? ((id: string) => systemEclosion.keepApp(id)))(appId).then((ok) => {
              if (ok) setKeptNow(true)
            })
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none text-text-muted hover:bg-surface-soft hover:text-text disabled:cursor-default disabled:text-success"
        >
          {kept ? `✓ ${t('eclosion.kept')}` : `⭳ ${t('eclosion.keep')}`}
        </button>
      )}
      {/* 「举报」（§10）：同意框确认后走既有样本链路（ADR 22）+ 会话封禁。 */}
      <button
        type="button"
        data-testid="eclosion-report"
        aria-label={t('eclosion.report')}
        title={t('eclosion.report')}
        disabled={banned || !enabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          setReportFailed(false)
          setReportOpen(true)
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none text-text-muted hover:bg-danger/10 hover:text-danger disabled:cursor-default disabled:opacity-40"
      >
        ⚑ {t('eclosion.report')}
      </button>
      {status?.passwordInputSeen && (
        <span
          role="alert"
          data-testid="eclosion-password-warning"
          className="truncate text-[10px] font-semibold leading-none text-danger"
        >
          ⚠ {t('eclosion.passwordWarning')}
        </span>
      )}
      {/* 同意框走 portal 至 body（坑 67：fixed 弹层不吃窗口拖拽 transform）。 */}
      {reportOpen &&
        createPortal(
          <ConfirmDialog
            title={t('eclosion.reportDialog.title')}
            body={t('eclosion.reportDialog.body')}
            confirmLabel={t('eclosion.reportDialog.confirm')}
            cancelLabel={t('eclosion.reportDialog.cancel')}
            busy={reportBusy}
            error={reportFailed ? t('eclosion.reportDialog.failed') : null}
            onConfirm={() => {
              setReportBusy(true)
              setReportFailed(false)
              void (onReport ?? ((id: string, win: string) => systemEclosion.reportApp(id, win)))(
                appId,
                windowId,
              ).then((ok) => {
                setReportBusy(false)
                if (ok)
                  setReportOpen(false) // 成功路径窗口已被编排器关闭
                else setReportFailed(true)
              })
            }}
            onCancel={() => {
              if (!reportBusy) setReportOpen(false)
            }}
          />,
          document.body,
        )}
    </span>
  )
}

// ── 宿主容器 ────────────────────────────────────────────────────────────────

/**
 * L2/L3 终态错误卡（§6.4/§2 铁律）：今日/留存应用没有原生兜底——重试耗尽/
 * 羽化关闭时呈错误卡（重试入口走重新羽化），绝不落 EclosionNativeFallback。
 */
function EclosionErrorCard({
  title,
  message,
  onRetry,
  testId,
}: {
  title: string
  message: string
  onRetry?: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      data-testid={testId ?? 'eclosion-error-card'}
      className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center"
    >
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-text-muted">{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          data-testid="eclosion-error-retry"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
          onClick={onRetry}
        >
          ↻ {t('eclosion.error.retry')}
        </button>
      )}
    </div>
  )
}

const NO_SESSION_SNAPSHOT: EclosionSessionSnapshot = {
  appId: '',
  specId: '',
  phase: 'queued',
  thinkChars: 0,
  thinkTail: '',
  chunks: [],
  scripts: [],
  source: null,
  errorCode: null,
  attempt: 1,
  passwordInputSeen: false,
  fellBack: false,
}

function themeOf(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
}

/** L2/L3（今日/想象应用）恒为空权限：SDK 一律拒绝（§4.1 第 4 条 Default Deny）。 */
const NO_SDK_PERMISSIONS: readonly Permission[] = []
/** L2/L3（今日/想象应用）的持久化面（2026-10-04 用户裁决：生成应用数据必须跨重开存活）。 */
const L2_L3_SDK_PERMISSIONS: readonly Permission[] = ['storage']

export function EclosionAppFrame({
  appId,
  windowId,
  title,
  orchestrator = systemEclosion,
}: EclosionAppFrameProps) {
  const { t } = useTranslation()
  const enabled = useEclosionStore((s) => s.enabled)
  const banned = useEclosionStore((s) => s.bannedAppIds.includes(appId))
  const spec = findEclosionSpecByAppId(appId)
  const kind = eclosionAppKind(appId)
  // SDK 权限恒来自规格表与设计裁决（§5.2：L1 按各自 permissions）。2026-10-04
  // 用户裁决：L2/L3（今日/想象应用）开放 storage 持久化——生成应用的数据必须
  // 跨重开存活；storage 按 appId 命名空间隔离且配额封顶（64 键/256KB），是
  // 除 theme 外唯一对零规格应用安全的面。不读 permissionManager 的运行时授予
  // ——规格/裁决是唯一事实源，防止把授予面放宽到规格之外；同一来源同时喂
  // 能力声明与逐请求门禁。
  const sdkPermissions =
    spec !== null ? spec.permissions : kind !== null ? L2_L3_SDK_PERMISSIONS : NO_SDK_PERMISSIONS
  const hasSpecPermission = useCallback(
    (permission: Permission) => sdkPermissions.includes(permission),
    [sdkPermissions],
  )
  // 能力声明的唯一派生处（§4.1 第 4 条）：power-on 随信下发与逐请求门禁用同一
  // 份集合——声明给 runner 的面和宿主实际放行的面必须逐字节同源。
  const sdkCapabilities = useMemo(
    () => sdkCapabilitiesForPermissions(sdkPermissions),
    [sdkPermissions],
  )

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // 懒取会话（幂等；开关关/未知 id/已封禁时不建——L1 落原生兜底、L2 落错误卡、
  // 封禁落封禁卡）。按 appId 记忆：同一组件实例被复用于另一个羽化应用时
  // （移动端最近任务 A→B）必须重建，否则会把 A 的会话内容下发给 B。
  const sessionRef = useRef<{ appId: string; session: EclosionSession | null } | null>(null)
  if (
    enabled &&
    kind !== null &&
    !banned &&
    (sessionRef.current === null || sessionRef.current.appId !== appId)
  ) {
    sessionRef.current = { appId, session: orchestrator.ensureSession(appId) }
  }
  const session = sessionRef.current?.appId === appId ? sessionRef.current.session : null

  const snapshot = useSyncExternalStore(
    session?.subscribe ?? (() => () => undefined),
    session?.getSnapshot ?? (() => NO_SESSION_SNAPSHOT),
    session?.getSnapshot ?? (() => NO_SESSION_SNAPSHOT),
  )

  const [fellBack, setFellBack] = useState(false)
  const [renderedOk, setRenderedOk] = useState(false)
  const [handshakeTick, setHandshakeTick] = useState(0)
  /** 回落后写入的标题（E3 审查）：重试/重新羽化时只撤销这一条，不覆盖 SDK 自定义标题。 */
  const fallbackTitleRef = useRef<string | null>(null)
  const titleRef = useRef(title)
  titleRef.current = title

  // 流式状态机（refs：消息回调与定时器读到的一律是最新值）。
  const runnerReadyRef = useRef(false)
  const themeSentRef = useRef(false)
  const poweredOnRef = useRef(false)
  const powerOnAtRef = useRef<number | null>(null)
  const sentChunksRef = useRef(0)
  const nextSeqRef = useRef(0)
  const renderedOkRef = useRef(false)
  const fellBackRef = useRef(false)
  const renderTimerRef = useRef<number | null>(null)
  const handshakeTimerRef = useRef<number | null>(null)
  /** 当前渲染的 attempt（事件回调读最新值）。 */
  const attemptRef = useRef(snapshot.attempt)
  attemptRef.current = snapshot.attempt
  /**
   * 本 attempt 已请求过重试（E3 审查）：同一 iframe 连续上报 runner error /
   * 握手超时不得叠出第二轮 attempt。新 attempt 从新 iframe 来，attempt 变化时
   * 复位——生成期（phase=generating）的首次 runner error 仍能正常回炉。
   */
  const retriedAttemptRef = useRef<number | null>(null)

  const clearRenderTimer = useCallback(() => {
    if (renderTimerRef.current !== null) {
      window.clearTimeout(renderTimerRef.current)
      renderTimerRef.current = null
    }
  }, [])

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current !== null) {
      window.clearTimeout(handshakeTimerRef.current)
      handshakeTimerRef.current = null
    }
  }, [])

  const postToRunner = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const requestRetryRef = useRef<(reason: string) => void>(() => undefined)

  /**
   * 质量回退（§5.2）：重试一次（编排器换新一轮尝试），再失败渲染原生兜底
   * 并在标题栏提示「已回落经典版」。
   *
   * 破茧质量窗（2026-10-05 空白应用修复）：rendered 之后 ECLOSION_RENDER_
   * TIMEOUT_MS 内收到的错误（生成代码异步崩溃等）**仍然回炉**——runner 在
   * power-on 时就会上报 rendered（先注脚本后上报），「已渲染」不等于「真的
   * 画出了东西」；窗外（应用运行期）的错误属于应用自有缺陷，不回炉。
   */
  const handleRunFailure = useCallback(
    (reason: string) => {
      if (fellBackRef.current) return
      // 同一 attempt 的连续失败事件只回炉一次（第二次是旧 iframe 的残留
      // runner error / 超时；新 attempt 的失败来自新 iframe、attempt 已变化）。
      if (retriedAttemptRef.current === attemptRef.current) return
      if (renderedOkRef.current) {
        const powerOnAt = powerOnAtRef.current
        if (powerOnAt === null || Date.now() - powerOnAt > ECLOSION_RENDER_TIMEOUT_MS) return
      }
      clearRenderTimer()
      const retried = orchestrator.requestRetry(appId, reason)
      if (retried) {
        retriedAttemptRef.current = attemptRef.current
      } else {
        fellBackRef.current = true
        setFellBack(true)
        // 「已回落经典版」标题后缀只对 L1 有意义；L2/留存走错误卡。
        if (spec !== null) {
          const fallbackTitle = `${title} · ${t('eclosion.fallbackNotice')}`
          fallbackTitleRef.current = fallbackTitle
          useWindowStore.getState().setTitle(windowId, fallbackTitle)
        }
      }
    },
    [appId, clearRenderTimer, orchestrator, spec, t, title, windowId],
  )

  useEffect(() => {
    requestRetryRef.current = handleRunFailure
  }, [handleRunFailure])

  // 尝试轮次切换（重试/重新羽化）或应用切换：重置状态机并重挂 iframe。
  useEffect(() => {
    runnerReadyRef.current = false
    themeSentRef.current = false
    poweredOnRef.current = false
    powerOnAtRef.current = null
    sentChunksRef.current = 0
    nextSeqRef.current = 0
    renderedOkRef.current = false
    fellBackRef.current = false
    retriedAttemptRef.current = null
    setRenderedOk(false)
    setFellBack(false)
    clearRenderTimer()
    clearHandshakeTimer()
    // 新一轮生成开始：撤销回落后缀（E3 审查：旧实现只写不还原，成功重羽化后
    // 标题长期宣称「已回落」）。仅在窗口标题仍是当初写入的回落标题时还原，
    // 不覆盖用户/SDK 的自定义标题。
    const fallbackTitle = fallbackTitleRef.current
    if (fallbackTitle !== null) {
      fallbackTitleRef.current = null
      const currentTitle = useWindowStore
        .getState()
        .windows.find((win) => win.id === windowId)?.title
      if (currentTitle === fallbackTitle) {
        useWindowStore.getState().setTitle(windowId, titleRef.current)
      }
    }
    return () => {
      clearRenderTimer()
      clearHandshakeTimer()
    }
  }, [appId, snapshot.attempt, clearRenderTimer, clearHandshakeTimer, windowId])

  // 关注者计数：卸载且无人关注 → 编排器中止生成（§5.3 断开即中止）。
  useEffect(() => {
    if (!session) return
    orchestrator.attach(appId)
    return () => orchestrator.detach(appId)
  }, [session, appId, orchestrator])

  /** 增量下发：主题 Token 先行 → 未发分片 → 就绪后破茧。 */
  const flushToRunner = useCallback(
    (snap: EclosionSessionSnapshot) => {
      if (!runnerReadyRef.current) return
      if (!themeSentRef.current) {
        postToRunner({
          type: 'eclosion:chunk',
          seq: nextSeqRef.current,
          html: themeStyleChunkHtml(),
        })
        nextSeqRef.current += 1
        themeSentRef.current = true
      }
      while (sentChunksRef.current < snap.chunks.length) {
        const chunk = snap.chunks[sentChunksRef.current]
        if (!chunk) break
        postToRunner({ type: 'eclosion:chunk', seq: nextSeqRef.current, html: chunk.html })
        nextSeqRef.current += 1
        sentChunksRef.current += 1
      }
      if (
        snap.phase === 'done' &&
        sentChunksRef.current >= snap.chunks.length &&
        !poweredOnRef.current
      ) {
        if (snap.chunks.length === 0) {
          // 空缓存/空流（done 但零内容块）：绝不破茧空页——runner 会对空文档
          // 上报 rendered，宿主随即藏起进度条 → 永久空白零反馈。走质量回退
          // （重试预算耗尽后落错误卡，反馈闭环）。
          requestRetryRef.current('empty-chunks')
          return
        }
        poweredOnRef.current = true
        powerOnAtRef.current = Date.now()
        // 破茧随信声明 SDK 能力（规格权限推导）：runner 据此安装 window.AgehaOS，
        // 未列出的命名空间在沙箱内不存在，生成代码可特性检测分支。
        postToRunner({
          type: 'eclosion:power-on',
          scripts: [...snap.scripts],
          capabilities: sdkCapabilities,
        })
        // 破茧后 5 秒无 rendered 视为失败（§5.2）；rendered 到达也不停表：
        // 质量窗内的错误仍可回炉（见 handleRunFailure），窗外自然失效。
        renderTimerRef.current = window.setTimeout(() => {
          if (!renderedOkRef.current) {
            requestRetryRef.current('render-timeout')
          }
          powerOnAtRef.current = null // 质量窗关闭：此后的错误归应用运行期。
        }, ECLOSION_RENDER_TIMEOUT_MS)
      }
    },
    [clearRenderTimer, postToRunner, sdkCapabilities],
  )

  useEffect(() => {
    if (!session || fellBack) return
    flushToRunner(snapshot)
  }, [session, snapshot, handshakeTick, fellBack, flushToRunner])

  const onIframeLoad = useCallback(() => {
    // 同一 attempt 内 iframe 重载（runner location.reload / 浏览器恢复框架）：
    // 握手与下发游标全部归零，否则新文档收不到任何 chunk/power-on（E3 审查）。
    runnerReadyRef.current = false
    themeSentRef.current = false
    poweredOnRef.current = false
    powerOnAtRef.current = null
    sentChunksRef.current = 0
    nextSeqRef.current = 0
    renderedOkRef.current = false
    setRenderedOk(false)
    clearRenderTimer()
    clearHandshakeTimer()
    // ready 超时 = 质量回退（重试一轮；预算耗尽落原生/错误卡），不再永久结茧。
    handshakeTimerRef.current = window.setTimeout(() => {
      handshakeTimerRef.current = null
      if (!runnerReadyRef.current) requestRetryRef.current('handshake-timeout')
    }, ECLOSION_HANDSHAKE_TIMEOUT_MS)
    // 握手第一步：文档加载完成后再发 hello，runner 此时才注册了 listener。
    postToRunner(hostHelloMessage())
  }, [clearHandshakeTimer, clearRenderTimer, postToRunner])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // §4.1 第 3 条：消息必须来自这个 iframe 自己的 contentWindow。
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = parseRunnerToHostMessage(event.data)
      if (message === null) return

      if (message.type === 'agehaos:ready') {
        runnerReadyRef.current = true
        clearHandshakeTimer()
        setHandshakeTick((tick) => tick + 1)
        return
      }
      if (message.type === 'eclosion:rendered') {
        // 不清渲染超时表：质量窗（power-on 后 5s）继续值守，窗内错误仍回炉；
        // 表回调里见 renderedOk 即关窗不回炉（健康应用不受影响）。
        renderedOkRef.current = true
        setRenderedOk(true)
        orchestrator.reportRendered(appId)
        return
      }
      if (message.type === 'eclosion:error') {
        requestRetryRef.current(`runner-error:${message.message}`)
        return
      }
      // agehaos:sdk：与 WebAppFrame 同款 ctx（逐请求 Default Deny、appId 命名空间）；
      // 权限来源是上面的规格表派生（sdkPermissions），非 permissionManager 运行时授予。
      const source = event.source
      // §4.1 第 4 条能力面枚举：请求的 api 必须在破茧随信声明的能力集内。runner
      // 只安装声明命名空间，但生成代码与 runner 同帧运行，可绕过 window.AgehaOS
      // 特性检测直接 postMessage——sdk-bridge 免许可面里的 user/permissions/system
      // 不属于羽化能力面（ECLOSION_SDK_APIS），宿主必须同样 Default Deny。
      if (!sdkCapabilities.apis.includes(message.api)) {
        // 与桥内拒绝同观感：可映射到 Permission 的（如零权限应用呼 storage）照发
        // permission.denied 审计；免许可命名空间无对应 Permission，只回拒绝。
        const permission = requiredPermission(message.api, message.action)
        if (permission !== null) {
          systemBus.emit('permission.denied', { appId, permission })
        }
        source?.postMessage(
          { type: SDK_RESULT_TYPE, reqId: message.reqId, ok: false, error: 'permission-denied' },
          '*',
        )
        return
      }
      void handleSdkRequest(message, {
        appId,
        hasPermission: hasSpecPermission,
        onPermissionDenied: (permission) => {
          systemBus.emit('permission.denied', { appId, permission })
        },
        storage:
          typeof localStorage === 'undefined'
            ? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
            : localStorage,
        getTheme: themeOf,
        onTitle: (next) => useWindowStore.getState().setTitle(windowId, next),
        notify: (notification) => {
          useNotificationStore.getState().push({
            appId,
            title: notification.title,
            body: notification.body,
          })
        },
        fs: sdkFilePort,
        getUser: () => {
          const user = useSessionStore.getState().user
          return user ? { username: user.username, displayName: user.displayName ?? null } : null
        },
        getGrantedPermissions: () => [...sdkPermissions],
        getSystemInfo: () => ({
          version: appVersion,
          locale: getLocale(),
          tier: useDynamicDesktopStore.getState().tier,
        }),
      }).then((response) => {
        source?.postMessage({ type: SDK_RESULT_TYPE, ...response }, '*')
      })
    },
    [
      appId,
      clearHandshakeTimer,
      clearRenderTimer,
      hasSpecPermission,
      orchestrator,
      sdkCapabilities,
      sdkPermissions,
      windowId,
    ],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // 生成管线失败（非运行期）：同一套重试 → 回落决策。
  useEffect(() => {
    if (!session) return
    if (snapshot.fellBack && !fellBackRef.current) {
      fellBackRef.current = true
      setFellBack(true)
      if (spec !== null) {
        const fallbackTitle = `${title} · ${t('eclosion.fallbackNotice')}`
        fallbackTitleRef.current = fallbackTitle
        useWindowStore.getState().setTitle(windowId, fallbackTitle)
      }
      return
    }
    if (snapshot.phase === 'error' && !snapshot.fellBack && !fellBackRef.current) {
      requestRetryRef.current(`generate-failed:${snapshot.errorCode ?? 'unknown'}`)
    }
  }, [session, snapshot, windowId, title, t, spec])

  // 思考流折叠面板（0fr→1fr，禁 max-height 魔法数字）：思考尾迹一到即自动
  // 展开，done/error 自动收起；用户手动开合后本轮交还用户，新一轮思考
  // （尾迹清空重积）恢复自动。
  const [thinkOpen, setThinkOpen] = useState(false)
  const thinkManualRef = useRef(false)
  const thinkBodyRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (snapshot.thinkTail === '') {
      thinkManualRef.current = false
      setThinkOpen(false)
      return
    }
    if (snapshot.phase === 'done' || snapshot.phase === 'error') {
      setThinkOpen(false)
    } else if (!thinkManualRef.current) {
      setThinkOpen(true)
    }
  }, [snapshot.phase, snapshot.thinkTail])
  useEffect(() => {
    // 展开态跟随流式滚动到底（尾迹持续追加，最新思考恒可见）。
    const body = thinkBodyRef.current
    if (thinkOpen && body) body.scrollTop = body.scrollHeight
  }, [thinkOpen, snapshot.thinkTail])

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  if (kind === null) {
    return <MissingApp windowId={windowId} />
  }

  // 会话封禁（§10）：举报后的应用本登录会话内不再生成/回放——封禁卡，无重试。
  if (banned) {
    return (
      <EclosionErrorCard
        title={t('eclosion.banned.title')}
        message={t('eclosion.banned.body')}
        testId="eclosion-banned-card"
      />
    )
  }

  if (!enabled || fellBack) {
    // L1：回落原生（§2.1 兜底表）；L2/L3：没有原生真身 → 错误卡（§2 铁律）。
    if (spec !== null) {
      return <EclosionNativeFallback spec={spec} windowId={windowId} title={title} />
    }
    // §12 P3「额度耗尽提示清晰」：429 quota-exceeded 展示对应档位剩余额度与
    // 重置时间（§9.3：客户端显示剩余额度与重置时间）。
    let message = enabled ? t('eclosion.error.body') : t('eclosion.error.disabled')
    if (enabled && snapshot.errorCode === 'quota-exceeded') {
      const quota = useEclosionStore.getState().quota
      const tier = quota !== null && kind !== null ? quota[kind] : null
      if (quota !== null && tier !== null) {
        const reset = quota.resetAtIso !== null ? new Date(quota.resetAtIso) : null
        message = formatMessage(t('eclosion.error.quota'), {
          used: String(tier.used),
          limit: String(tier.limit),
          time:
            reset !== null && !Number.isNaN(reset.getTime())
              ? reset.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
              : '',
        })
      }
    }
    return (
      <EclosionErrorCard
        title={t('eclosion.error.title')}
        message={message}
        onRetry={enabled ? () => orchestrator.regenerate(appId) : undefined}
      />
    )
  }

  const generating = snapshot.phase === 'queued' || snapshot.phase === 'generating' || !renderedOk
  // 思考面板可见性：有尾迹且过内容过滤（与想象域同闸——违规时只留字数条）。
  const thinkPanelVisible = snapshot.thinkTail !== '' && filterContentText(snapshot.thinkTail).ok

  return (
    <div className="relative h-full bg-surface" data-testid="eclosion-host">
      <iframe
        key={`${appId}-${snapshot.attempt}`}
        ref={iframeRef}
        src={`${ECLOSION_RUNNER_ENTRY}?v=${appVersion}`}
        sandbox={WEB_APP_SANDBOX}
        title={title}
        className="h-full w-full border-0"
        onLoad={onIframeLoad}
      />
      {generating && (
        <>
          {thinkPanelVisible && (
            <div
              data-testid="eclosion-think"
              className="absolute inset-x-0 bottom-7 z-10 border-t border-border-subtle bg-surface/90"
            >
              <button
                type="button"
                data-testid="eclosion-think-toggle"
                aria-expanded={thinkOpen}
                aria-controls="eclosion-think-body"
                className="flex h-6 w-full items-center gap-1.5 px-3 text-[11px] text-text-muted hover:text-text"
                onClick={() => {
                  thinkManualRef.current = true
                  setThinkOpen((open) => !open)
                }}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block text-[9px] leading-none transition-transform duration-200 ${
                    thinkOpen ? 'rotate-90' : ''
                  }`}
                >
                  ▶
                </span>
                {t('eclosion.think.toggle')}
              </button>
              <div
                id="eclosion-think-body"
                data-testid="eclosion-think-body"
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: thinkOpen ? '1fr' : '0fr' }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div
                    ref={thinkBodyRef}
                    data-testid="eclosion-think-text"
                    className="scroll-thin max-h-36 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-2 text-[11px] leading-relaxed text-text-muted"
                  >
                    {snapshot.thinkTail}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div
            data-testid="eclosion-progress"
            aria-live="polite"
            className="absolute inset-x-0 bottom-0 z-10 flex h-7 items-center justify-center border-t border-border-subtle bg-surface/90 text-xs text-text-muted"
          >
            {snapshot.phase === 'queued' ? (
              t('eclosion.queued')
            ) : (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
                />
                {/* 每帧变化的字数对读屏 aria-hidden（E3 审查）：live region 只留
                    稳定文案，避免高频「结茧中·N 字」播报把别的提示压住。 */}
                <span aria-hidden="true">
                  {formatMessage(t('eclosion.generating'), { count: String(snapshot.thinkChars) })}
                </span>
                <span className="sr-only">{t('eclosion.generatingLabel')}</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
