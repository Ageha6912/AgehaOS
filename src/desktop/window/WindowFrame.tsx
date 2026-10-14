import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { MissingApp } from '@/apps/placeholder-app'
import { useTranslation } from '@/core/i18n'
import type { WindowInstance } from '@/core/window'
import { snapIntentFromPointer } from '@/core/window'
import { isAllowedWebAppEntry } from '@/core/apps/web-app'
import { isEclosionAppId } from '@/core/eclosion/spec'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { EclosionAppFrame, EclosionTitleExtras } from '@/components/eclosion-app-frame'
import { WebAppFrame } from '@/components/web-app-frame'
import { getAppManifest } from '@/store/app-store'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useWindowStore } from '@/store/window-store'

import { getWorkspaceBand, getWorkspaceViewport } from './viewport'
import { useWindowMotion } from './use-window-motion'
import { useFocusTilt } from '@/desktop/motion/use-focus-tilt'

interface DragOrigin {
  pointerX: number
  pointerY: number
  x: number
  y: number
}

interface ResizeOrigin {
  pointerX: number
  pointerY: number
  width: number
  height: number
  x: number
  y: number
  dir: ResizeDir
}

/** 八向拖拽（2026-10-02 用户裁决「自由改变大小」）：边缘 6px + 角 14px 命中区。 */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_HANDLES: Array<{ dir: ResizeDir; className: string }> = [
  { dir: 'n', className: 'top-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { dir: 's', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { dir: 'e', className: 'right-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { dir: 'w', className: 'left-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { dir: 'ne', className: 'top-0 right-0 h-3.5 w-3.5 cursor-nesw-resize' },
  { dir: 'nw', className: 'top-0 left-0 h-3.5 w-3.5 cursor-nwse-resize' },
  { dir: 'se', className: 'bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize' },
  { dir: 'sw', className: 'bottom-0 left-0 h-3.5 w-3.5 cursor-nesw-resize' },
]

/**
 * Title-bar buttons must not reach the header's drag handler: it captures the
 * pointer, which would retarget the click away from the button.
 */
function swallowPointerDown(event: ReactPointerEvent<HTMLElement>) {
  event.stopPropagation()
}

/**
 * Type A（内置组件）之外的应用按 Type B 渲染：manifest entry 必须通过同源
 * `/apps/sites/` allowlist（§30.3 纵深防御的第二道闸；第一道在安装目录）。
 */
function TypeBOrMissing({
  appId,
  title,
  windowId,
}: {
  appId: string
  title: string
  windowId: string
}) {
  const manifest = getAppManifest(appId)
  if (manifest && isAllowedWebAppEntry(manifest.entry)) {
    return <WebAppFrame entry={manifest.entry} appId={appId} windowId={windowId} title={title} />
  }
  return <MissingApp windowId={windowId} />
}
export function WindowFrame({
  win,
  ghost = false,
  spaceHidden = false,
}: {
  win: WindowInstance
  ghost?: boolean
  /** W3 Space 渲染过滤（审计 .tmp/spaces-audit.md §6）：非活跃 Space 的窗口传 true。 */
  spaceHidden?: boolean
}) {
  const { t } = useTranslation()
  const focus = useWindowStore((s) => s.focus)
  const minimize = useWindowStore((s) => s.minimize)
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize)
  const move = useWindowStore((s) => s.move)
  const resize = useWindowStore((s) => s.resize)
  const snap = useWindowStore((s) => s.snap)
  const unsnap = useWindowStore((s) => s.unsnap)

  const sectionRef = useRef<HTMLElement | null>(null)
  // 窗口动效（DESIGN.md §12）：打开/关闭/genie 飞行 + 半途抓回；关闭走
  // requestClose（store 立即提交 + ghost 快照续播退场），最小化/还原由
  // store 状态迁移驱动。ghost = 关闭退场中的快照壳：不进可达树、不吃指针。
  const { requestClose } = useWindowMotion(win, sectionRef, { ghost })

  const dragOrigin = useRef<DragOrigin | null>(null)
  // W4（审计 §7）：本次拖拽是否发生过实际位移——pointerup 吸附判定的前置
  // 条件（点击标题栏不动不触发 snap/最大化）。
  const dragMoved = useRef(false)
  const resizeOrigin = useRef<ResizeOrigin | null>(null)

  const maximized = win.state === 'maximized'
  const minimized = win.state === 'minimized'
  const app = componentFor(win.appId)
  // 窗口切换转场（§32.5 修订 10）：聚焦小起立（一次性 WAAPI）+ 失焦微退后。
  const tiltOn = useMotionPrefsStore((s) => s.windowTilt)
  // 空间动效总开关（2026-10-10 空间化裁决 3）：关档时不挂深度类与悬停浮起
  // （挂 sp-motion-static 直切等价类）；prefers-reduced-motion 由全局塌缩兜底。
  const spatialMotion = useMotionPrefsStore((s) => s.spatialMotion)
  // 拖拽进行中：悬停浮起的排除条件之一（拖拽窗口必然已聚焦，此为双保险，
  // 并保证拖拽期间悬停过渡类不在场——跟手零延迟）。只在起拖/收拖各一次渲染。
  const [dragging, setDragging] = useState(false)
  useFocusTilt(sectionRef, win.focused, minimized, tiltOn)

  // 深度类栈（2026-10-10 空间化裁决）：聚焦 = sp-depth-near、失焦可见 =
  // sp-depth-middle；最大化/最小化/ghost 不挂深度。窗口 section 是 E2E 几何
  // 探针与拖拽 ±2px 钉扎的测量面——深度梯的投影型 translateZ 在窗口作用域
  // 被 spatial.css 的 sp-win 覆盖解析为非变换表达（面实度/细边/阴影三档），
  // 静止渲染盒恒等于布局盒（红线 10）。
  const depthClass =
    !ghost && !minimized && !maximized && spatialMotion
      ? win.focused
        ? 'sp-depth-near'
        : 'sp-depth-middle'
      : ''
  // 悬停浮起：仅「失焦 + 非最大化 + 非最小化 + 非拖拽中 + 空间动效开档」；
  // ghost 是关闭退场快照，永不浮起。
  const hoverClass =
    !ghost && spatialMotion && !win.focused && !maximized && !minimized && !dragging
      ? 'sp-win-hover'
      : ''

  // 最大化（2026-10-02 用户裁决，修订 12）：整视口真全屏——横向全幅贴左右
  // 屏幕边缘、上缘到屏幕顶（盖过菜单栏带）、下缘到屏幕底（盖过 Dock 带），
  // 不留任何系统栏带；菜单栏/Dock/左右浮层栏全部置于窗口层（z-[45]）之下，
  // 还原走窗口标题栏。几何改类驱动（断点条件无法走内联样式）；calc 任意值
  // 用下划线空格形式（坑 §25）。
  const style: CSSProperties = maximized
    ? { zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }

  const onTitlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // 只劫持物理命中标题栏自身的按压：portal 出去的子树（如羽化举报同意框挂
    // document.body）经 React 树冒泡回到这里，但不是标题栏的 DOM 后代——若
    // 照常 setPointerCapture，后续 pointerup/click 会被重定到标题栏，弹层按钮
    // 的 onClick 永远收不到（2026-10-03 E2E 实测：同意框取消/确认均失效）。
    if (!event.currentTarget.contains(event.target as Node)) return
    focus(win.id)
    if (maximized || event.button !== 0) return
    // W4 脱 snap 转换点（审计 §7 钉死）：snapped 窗按下标题栏先经 store
    // unsnap()，再从 getState() 读还原后几何记 dragOrigin——move 数学以
    // 还原基线起算，指针移动零跳变（Windows 惯例：拖出即还原）。
    let originX = win.x
    let originY = win.y
    if (win.state === 'snapped') {
      unsnap(win.id)
      const restored = useWindowStore.getState().windows.find((w) => w.id === win.id)
      if (restored) {
        originX = restored.x
        originY = restored.y
      }
    }
    dragOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: originX,
      y: originY,
    }
    dragMoved.current = false
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onTitlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = dragOrigin.current
    if (!origin) return
    if (event.clientX !== origin.pointerX || event.clientY !== origin.pointerY) {
      dragMoved.current = true
    }
    move(
      win.id,
      origin.x + (event.clientX - origin.pointerX),
      origin.y + (event.clientY - origin.pointerY),
      getWorkspaceViewport(),
    )
  }

  const onTitlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragOrigin.current) return
    const moved = dragMoved.current
    dragOrigin.current = null
    dragMoved.current = false
    setDragging(false)
    // W4 吸附判定（审计 §7）：本次拖拽曾移动且 pointer 意图命中才转换——
    // 顶缘命中 → toggleMaximize（复用整视口真全屏，禁改）；左/右缘 →
    // snap(dir, band)。带外放手 = 保持拖拽后几何（normal）。
    if (moved) {
      const band = getWorkspaceBand()
      const intent = snapIntentFromPointer(event.clientX, event.clientY, band)
      if (intent?.kind === 'maximize') {
        toggleMaximize(win.id)
      } else if (intent) {
        snap(win.id, intent.kind, band)
      }
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer capture was already released */
    }
  }

  const onResizePointerDown = (dir: ResizeDir) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    focus(win.id)
    // W4 评审遗留裁决（审计 §7 钉死）：resize 脱 snap 转换点=onResizePointerDown
    // ——snapped 窗按下 resize 手柄先经 store unsnap()、再从 getState() 读
    // 还原后几何作为 resizeOrigin 基线（引擎 resize 分支不做转换；否则首次
    // resize 以 snapped 几何为基线必跳变）。组合层转换后走既有 normal resize。
    let baseWidth = win.width
    let baseHeight = win.height
    let baseX = win.x
    let baseY = win.y
    if (win.state === 'snapped') {
      unsnap(win.id)
      const restored = useWindowStore.getState().windows.find((w) => w.id === win.id)
      if (restored) {
        baseWidth = restored.width
        baseHeight = restored.height
        baseX = restored.x
        baseY = restored.y
      }
    }
    resizeOrigin.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: baseWidth,
      height: baseHeight,
      x: baseX,
      y: baseY,
      dir,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* jsdom 无 pointer capture：拖拽逻辑不依赖它 */
    }
  }

  const onResizePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = resizeOrigin.current
    if (!origin) return
    const dx = event.clientX - origin.pointerX
    const dy = event.clientY - origin.pointerY
    // 钳制在手柄层做（最小尺寸 + 不越过屏幕缘，保留 8px 可见）——不能用
    // manager 的 workspace 钳制：它假定左上角固定、只向东/南长，西/北缘的
    // 位置补偿会让「x 右移 → 上限收窄 → 再缩」正反馈螺旋（2026-10-02 实测：
    // 3 步内窗口被挤到 80px 宽钉死）。
    let width = origin.width + (origin.dir.includes('e') ? dx : origin.dir.includes('w') ? -dx : 0)
    let height = origin.height + (origin.dir.includes('s') ? dy : origin.dir.includes('n') ? -dy : 0)
    const fixedRight = origin.x + origin.width
    const fixedBottom = origin.y + origin.height
    if (origin.dir.includes('w')) width = Math.min(width, fixedRight - 8)
    else width = Math.min(width, window.innerWidth - origin.x - 8)
    if (origin.dir.includes('n')) height = Math.min(height, fixedBottom - 8)
    else height = Math.min(height, window.innerHeight - origin.y - 8)
    width = Math.max(320, width)
    height = Math.max(200, height)
    resize(win.id, width, height)
    if (origin.dir.includes('w') || origin.dir.includes('n')) {
      // 西/北缘：拖的是左/上边——尺寸被钳制后把位置反向补偿（拖哪边哪边跟手）。
      const current = useWindowStore
        .getState()
        .windows.find((candidate) => candidate.id === win.id)
      if (current) {
        const x = origin.dir.includes('w') ? origin.x + (origin.width - current.width) : origin.x
        const y = origin.dir.includes('n') ? origin.y + (origin.height - current.height) : origin.y
        if (x !== current.x || y !== current.y) move(win.id, x, y, getWorkspaceViewport())
      }
    }
  }

  const onResizePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!resizeOrigin.current) return
    resizeOrigin.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* pointer capture was already released */
    }
  }

  return (
    <section
      ref={sectionRef}
      aria-label={win.title}
      aria-hidden={ghost || undefined}
      className={`spatial-window sp-win absolute flex flex-col overflow-hidden ${
        // W3 Space 渲染过滤（审计 §6）：非活跃 Space 的窗口与 minimized 走同一
        // hidden 类机制——可见性非卸载，iframe/应用状态存活，切换不销毁窗口。
        minimized || spaceHidden ? 'hidden' : ''
      } ${
        maximized ? 'inset-0 rounded-none sp-win-max' : ''
      } ${
        // 空间化窗口状态栈（2026-10-10）：材质结构走 .spatial-window 体系
        // （32px 圆角档/40px 磨砂/斜向高光/空间阴影/两处实色兜底），面实度
        // 与细边仍走 --ag 窗口档（工作面承墨字；sp-win 段 unlayered 覆写）——
        // 聚焦 = 更高面实度 + border-strong + 更深空间阴影；失焦 = 基底档。
        // 聚焦档只提实度不加色相（active 禁止整体变蓝）。
        win.focused
          ? 'sp-win-focused'
          : 'sp-win-unfocused'
      } ${depthClass} ${hoverClass} ${tiltOn && !win.focused && !minimized ? 'is-tilt-dim' : ''} ${
        spatialMotion ? '' : 'sp-motion-static'
      } ${ghost ? 'pointer-events-none' : 'pointer-events-auto'}`}
      style={style}
      onPointerDown={() => focus(win.id)}
    >
      <header
        // 2026-10-02 用户裁决：拖动区保持默认箭头（cursor-move 十字观感差）。
        // Shell 3.0 STEP 7：头部 36→44px（ask 档 44-50）——App Icon + 标题 +
        // 控制灯在更舒展的带内保持「干净、精确、轻」（标题常规字重不加重）。
        className="flex h-11 shrink-0 select-none cursor-default items-center gap-2 border-b border-border-subtle px-3"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onDoubleClick={() => {
          if (win.resizable) toggleMaximize(win.id)
        }}
      >
        {/* 交通灯（Q4 裁决，左置；非激活时整体降不透明度，§21）。
            2026-10-02 用户裁决：去掉 ✕/—/⬛ 符号，只留纯色圆点（macOS 素态
            语义）；悬停轻微上浮 + 微放大提示可点；可访问名（aria-label）
            契约不变，键盘/读屏不受影响。 */}
        <div className={`flex items-center gap-2 ${win.focused ? 'opacity-100' : 'opacity-60'}`}>
          {win.closable && (
            <button
              type="button"
              aria-label={t('window.close')}
              className="group/light flex h-6 w-6 items-center justify-center"
              onPointerDown={swallowPointerDown}
              onClick={requestClose}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full bg-wl-close transition-transform duration-150 ease-out group-hover/light:-translate-y-px group-hover/light:scale-110"
              />
            </button>
          )}
          <button
            type="button"
            aria-label={t('window.minimize')}
            className="group/light flex h-6 w-6 items-center justify-center"
            onPointerDown={swallowPointerDown}
            onClick={() => minimize(win.id)}
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full bg-wl-min transition-transform duration-150 ease-out group-hover/light:-translate-y-px group-hover/light:scale-110"
            />
          </button>
          {win.resizable && (
            <button
              type="button"
              aria-label={maximized ? t('window.restore') : t('window.maximize')}
              className="group/light flex h-6 w-6 items-center justify-center"
              onPointerDown={swallowPointerDown}
              onClick={() => toggleMaximize(win.id)}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full bg-wl-max transition-transform duration-150 ease-out group-hover/light:-translate-y-px group-hover/light:scale-110"
              />
            </button>
          )}
        </div>
        <AppIcon appId={win.appId} size={16} />
        <span className={`truncate text-sm ${win.focused ? 'text-text' : 'text-text-muted'}`}>
          {win.title}
        </span>
        {/* 羽化窗口标题栏配件（§5.4/§10）：✦ AI 生成徽标（不可隐藏）+
            重新羽化 + 举报（P4 治理）+ 密码框红色警示。 */}
        {isEclosionAppId(win.appId) && <EclosionTitleExtras appId={win.appId} windowId={win.id} />}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <AppErrorBoundary appId={win.appId} windowId={win.id}>
          {app ? (
            <app.Component windowId={win.id} />
          ) : isEclosionAppId(win.appId) ? (
            // 羽化前缀分支（AI-GENERATED-APPS-DESIGN §3.2）：必须先于 Type B
            // 的 allowlist 判定——runner entry 不在 /apps/sites/ 内，落入
            // TypeBOrMissing 会被判 MissingApp。
            <EclosionAppFrame appId={win.appId} windowId={win.id} title={win.title} />
          ) : (
            <TypeBOrMissing appId={win.appId} title={win.title} windowId={win.id} />
          )}
        </AppErrorBoundary>
      </div>

      {/* 八向拖拽（2026-10-02 用户裁决「自由改变大小」）：边缘 6px + 角
          14px 命中区；角柄外半段会被圆角+overflow-hidden 裁剪（Shell 2.0
          rounded-xl），内侧仍可命中。西/北缘拖拽带位置补偿（见 handler）。 */}
      {win.resizable && !maximized && (
        <>
          {RESIZE_HANDLES.map(({ dir, className }) => (
            <div
              key={dir}
              role="presentation"
              data-testid={`window-resize-${dir}`}
              className={`absolute z-10 ${className}`}
              onPointerDown={onResizePointerDown(dir)}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
            />
          ))}
        </>
      )}
    </section>
  )
}
