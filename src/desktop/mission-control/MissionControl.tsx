import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { Plus, X } from '@phosphor-icons/react'

import { prefersReducedMotion, useExitPhase } from '@/components/pop-motion'
import { usePopoverDismiss } from '@/components/use-popover-dismiss'
import { formatMessage, useTranslation } from '@/core/i18n'
import type { Space } from '@/core/window'
import { bezier, EASE_FLIGHT_LEG2 } from '@/core/window/motion'
import { activateCardWindow, useMissionControlStore } from '@/store/mission-control-store'
import { useSpaceStore } from '@/store/space-store'
import { useWindowStore } from '@/store/window-store'

import { WindowCard, WindowDragGhost, type CardWindow } from './WindowCard'

/**
 * Mission Control（Window Management 2.0 W7，审计 .tmp/spaces-audit.md §10）：
 * z-[60] 全屏调度层——顶部 Space 条（胶囊=name+N Apps 计数+新建+删除+inline
 * rename）+ 当前 Space 轻量窗口卡片 + 跨 Space 拖窗。
 *
 * 硬性设计决定（审计 §10）：
 * 1. 层级与互斥：`fixed inset-0 z-[60]`（搜索 z-50 之上、模态 z-[70] 之下，
 *    本轮不动阶梯其他成员）；开启即 `usePopoverDismiss('mission-control',
 *    dismissible:false)` 参与单槽互斥（被顶替即关）；backdrop（非卡片/非
 *    胶囊/非按钮区）点击=关闭（内容岛 pointer-events-auto、中间地带
 *    pointer-events-none 让点击落到层根）；Esc=关闭（registry 条目，见
 *    use-global-shortcuts）。
 * 2. 删除流（决策默认值 5 落点）：删除钮仅非最后 Space 显示（隐藏而非禁用）；
 *    空 Space 直接 deleteSpace；非空 Space 走迁移确认弹层——**确认后才同步
 *    「先逐窗 moveWindowToSpace → 最后一步才 deleteSpace」，无半删态**；被删
 *    是 active Space 时先 switchSpace 到迁移目标。默认迁移目标=相邻前一个
 *    Space（首位回落相邻后一个）。
 * 3. 跨 Space 拖窗：pointer 拖卡到 Space 条胶囊落点 → moveWindowToSpace——
 *    窗口组件树全程不动（W3 过滤是可见性级，应用零重启）；拖拽视觉=根层
 *    fixed 容器内的轻量拖拽影（transform-only 跟手、pointer-events-none，
 *    脱离卡片区 overflow 裁剪；原卡拖拽中 pointer-events-none + 半透明
 *    留位——W7 复核修复：命中测试不依赖 overflow 裁剪副作用）；**拖拽期间
 *    禁发 switchSpace**（drop 后才动）。
 * 4. 性能纪律：卡片区对窗口列表 memo（WindowCard React.memo + useCallback
 *    稳定回调——拖拽逐帧重渲染时未动卡零开销）；开启时不写任何窗口几何。
 * 5. 视觉：全走既有 token（surface-glass/glass-popover/--ag-capsule-active/
 *    shadow-popover/bg-scrim-strong，禁新 hex）；「空间展开」气质=整体
 *    zoom-out 入场（240ms ∈ 180-400ms 档，与 SPACE_SWITCH_MS 同档；reduced-
 *    motion/WAAPI 缺失直切）；退场 120ms 淡出（弹层退场档）。
 */

/** 「空间展开」入场时长：与 SPACE_SWITCH_MS 同档同值（core/window/motion.ts 互指）。 */
const MISSION_CONTROL_ENTER_MS = 240
/** 位移阈值：未超过前是点击候选，超过才算拖拽（点击激活不受拖拽污染）。 */
const DRAG_THRESHOLD_PX = 4
/** 拖拽影跟手时的放大档（与窗口飞行同量级的克制浮起）。 */
const DRAG_SCALE = 1.03

/** 确认弹层开启态的模块级镜像（W7 复核 low 备忘）：use-global-shortcuts 的
 * MC Esc 条目要在组件树外实时读「确认弹层未开启」让位，而 deleteCandidateId
 * 是本组件 useState（迁移 store 不持本层局部态）——由下方 effect 依
 * deleteCandidateId 同步镜像，卸载/关闭路径一律复位 false。 */
let deleteConfirmOpen = false

/** 确认弹层是否开启（registry MC Esc 条目的 when 消费；组件外可读）。 */
export function isDeleteConfirmOpen(): boolean {
  return deleteConfirmOpen
}

export type SpaceHitTest = (clientX: number, clientY: number) => string | null

/** 默认落点命中测试：落点元素向上找 `[data-space-drop]`（Space 胶囊）；模块
 * 私有（jsdom 无 elementFromPoint 时返回 null，测试经 hitTest prop 注入桩）。
 * W7 复核修复后命中不依赖裁剪副作用：拖拽影与被拖卡拖拽中均
 * pointer-events-none，elementFromPoint 天然落到下方胶囊。 */
function defaultSpaceHitTest(clientX: number, clientY: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null
  const el = document.elementFromPoint(clientX, clientY)
  const drop = el instanceof Element ? el.closest<HTMLElement>('[data-space-drop]') : null
  return drop?.dataset.spaceDrop ?? null
}

/** 默认迁移目标：相邻前一个 Space；被删者居首则回落相邻后一个。纯函数。 */
function migrationTargetId(spaces: Space[], spaceId: string): string | null {
  const index = spaces.findIndex((space) => space.id === spaceId)
  if (index === -1) return null
  const previous = spaces[index - 1] ?? spaces[index + 1]
  return previous?.id ?? null
}

/** 进行中的拖拽（容器态：根层拖拽影跟手与目标胶囊高亮都从这里派生）。 */
interface DragState {
  windowId: string
  fromSpaceId: string
  /** 当前指针视口坐标（拖拽影 transform-only 跟手的驱动源）。 */
  pointerX: number
  pointerY: number
  /** 抓取点=pointerdown 时光标相对被拖卡左上角的偏移（影按它还原
   * 「卡随手动、抓取点恒在光标下」；同时作为 transform-origin 消除
   * scale 的抓取点漂移）。 */
  grabX: number
  grabY: number
  targetSpaceId: string | null
}

/** pointerdown 起点簿记（active=已越过阈值，正式成为拖拽）。 */
interface PointerTracking {
  windowId: string
  fromSpaceId: string
  startX: number
  startY: number
  grabX: number
  grabY: number
  active: boolean
}

export function MissionControl({
  hitTest = defaultSpaceHitTest,
}: {
  /** 落点命中测试（测试注入桩；生产用 elementFromPoint 默认实现）。 */
  hitTest?: SpaceHitTest
}) {
  const { t } = useTranslation()
  const open = useMissionControlStore((s) => s.open)
  const editingSpaceId = useMissionControlStore((s) => s.editingSpaceId)
  const spaces = useSpaceStore((s) => s.spaces)
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)
  const windows = useWindowStore((s) => s.windows)

  // 退场相位：关闭后 120ms 淡出窗口期保持挂载；jsdom/无动效运行时
  // motionMs=0 → 立即卸载（useExitPhase 直取，pop-motion 范式）。
  const { render, exiting } = useExitPhase(open)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const pointerRef = useRef<PointerTracking | null>(null)
  /** 本次 pointer 序列是否已成为拖拽（拖拽后的合成 click 不得激活窗口）。 */
  const didDragRef = useRef(false)
  const hitTestRef = useRef(hitTest)
  hitTestRef.current = hitTest

  // 弹层互斥（审计 §10 决定 1）：claim 单槽；被其他弹层顶替（active 变他值）
  // → 关闭。dismissible:false——Esc 与 backdrop 点击由本层自理。
  usePopoverDismiss(
    'mission-control',
    open,
    (reason) => {
      if (reason === 'superseded') useMissionControlStore.getState().close()
    },
    { dismissible: false },
  )

  // 「空间展开」整体 zoom-out 入场（审计 §10 决定 5）：WAAPI 消费既有贝塞尔
  // 档；reduced-motion 或 WAAPI 缺失（jsdom）直切。fill:both 的终帧随卸载
  // cancel（同 use-window-motion 落定纪律）。
  useEffect(() => {
    if (!open) return
    const surface = surfaceRef.current
    if (!surface || typeof surface.animate !== 'function' || prefersReducedMotion()) return
    const anim = surface.animate(
      [
        { transform: 'scale(1.035)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: MISSION_CONTROL_ENTER_MS, easing: bezier(EASE_FLIGHT_LEG2), fill: 'both' },
    )
    return () => {
      anim.cancel()
    }
  }, [open])

  // 关闭即清迁移确认候选（编辑态由 store 的 close() 复位；本层局部态随层清）。
  useEffect(() => {
    if (!open) setDeleteCandidateId(null)
  }, [open])

  // 迁移确认弹层的 Esc 取消 + 开启态模块级镜像（W7 复核 low 备忘）：弹层
  // 开启期 registry 的 MC Esc 条目让位（when 读 isDeleteConfirmOpen，见上），
  // Esc 由本层自理——仅取消弹层，MC 层不动；弹层不在场后再按 Esc 才落
  // registry 关 MC。document 捕获段挂接（ShortcutsDialog/FileActionSheet
  // 同款 dialog 模式，不依赖焦点落点）；镜像与监听依 deleteCandidateId
  // 同增同删，cleanup 复位镜像（卸载/换候选两条路径都覆盖）。
  useEffect(() => {
    deleteConfirmOpen = deleteCandidateId !== null
    if (deleteCandidateId === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDeleteCandidateId(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      deleteConfirmOpen = false
    }
  }, [deleteCandidateId])

  // 计数=该 Space 窗口数（审计 §10 决定 2：从 useWindowStore.windows 派生）。
  const countBySpace = useMemo(() => {
    const counts = new Map<string, number>()
    for (const win of windows) counts.set(win.spaceId, (counts.get(win.spaceId) ?? 0) + 1)
    return counts
  }, [windows])

  // 卡片区=当前 Space 窗口（任务书 §25 口径；切 Space 胶囊即切换卡片区）。
  const spaceWindows = useMemo(
    () => windows.filter((win) => win.spaceId === activeSpaceId),
    [windows, activeSpaceId],
  )

  // —— 稳定回调（useCallback + refs + getState）：WindowCard memo 的前提。——

  const onCardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, win: CardWindow) => {
      if (event.button !== 0) return
      didDragRef.current = false
      // 抓取点簿记：光标相对卡左上角的偏移（jsdom rect 全 0 → 测试坐标即
      // 卡面坐标）；拖拽影用它把「抓取点」钉在光标下。
      const rect = event.currentTarget.getBoundingClientRect()
      pointerRef.current = {
        windowId: win.id,
        fromSpaceId: win.spaceId,
        startX: event.clientX,
        startY: event.clientY,
        grabX: event.clientX - rect.left,
        grabY: event.clientY - rect.top,
        active: false,
      }
      // 捕获后续 pointer 事件（jsdom 无此 API → 可选调用）；触摸由 touch-none 兜。
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [],
  )

  const onLayerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const tracking = pointerRef.current
    if (!tracking) return
    const dx = event.clientX - tracking.startX
    const dy = event.clientY - tracking.startY
    if (!tracking.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      tracking.active = true
      didDragRef.current = true
    }
    // 拖拽期间禁发 switchSpace（审计 §10 决定 3）：这里只算落点高亮，
    // 归属变更留给 drop 后的 moveWindowToSpace。
    const target = hitTestRef.current(event.clientX, event.clientY)
    setDrag({
      windowId: tracking.windowId,
      fromSpaceId: tracking.fromSpaceId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      grabX: tracking.grabX,
      grabY: tracking.grabY,
      targetSpaceId: target && target !== tracking.fromSpaceId ? target : null,
    })
  }, [])

  const onLayerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const tracking = pointerRef.current
    pointerRef.current = null
    if (tracking?.active) {
      const target = hitTestRef.current(event.clientX, event.clientY)
      // drop 后才动：跨 Space 归属迁移（窗口组件树不动，应用零重启）。
      if (target && target !== tracking.fromSpaceId) {
        useWindowStore.getState().moveWindowToSpace(tracking.windowId, target)
      }
      // 拖拽抑制窗口期：合成 click 紧随 pointerup 同步派发，宏任务兜底归零
      // （此后到达的 click 恢复点击语义；键盘激活 detail=0 无 pointer 序列，
      // didDragRef 恒 false 不受影响）。
      window.setTimeout(() => {
        didDragRef.current = false
      }, 0)
    }
    setDrag(null)
  }, [])

  const onLayerPointerCancel = useCallback(() => {
    pointerRef.current = null
    setDrag(null)
  }, [])

  /**
   * 点击卡片激活（switchSpace（如需）+restore/focus；minimized 卡转
   * restore+focus）。导出为模块级纯函数供单测（use-switcher applyFocus 同款）。
   */
  const onCardActivate = useCallback((win: CardWindow) => {
    // 拖拽后的合成 click 不是点击激活（落点已由 pointerup 的迁移逻辑处理）。
    if (didDragRef.current) return
    activateCardWindow(win)
  }, [])

  /** ❌ 关闭钮（W11 审计 §13 B①）：useWindowStore close 该窗——卡随窗口列表
   * 更新从卡片区消失，关窗 ghost 在 WindowLayer 原地播完退场（与标题栏关闭
   * 钮同一条引擎路径）；MC 层不关（批量整理窗口的调度语义）。 */
  const onCardClose = useCallback((win: CardWindow) => {
    useWindowStore.getState().close(win.id)
  }, [])

  const onCreateSpace = useCallback(() => {
    useSpaceStore.getState().createSpace()
  }, [])

  const onSpaceClick = useCallback((spaceId: string, detail: number) => {
    // 点击胶囊=switchSpace（引擎拒同 id=no-op）；detail=0 是键盘 Enter 的合成
    // click——Enter 已进 inline rename，不重复触发切换。
    if (detail > 0) useSpaceStore.getState().switchSpace(spaceId)
  }, [])

  const onSpaceRenameEntry = useCallback((spaceId: string) => {
    useMissionControlStore.getState().setEditing(spaceId)
  }, [])

  /** 提交重命名：非空即交引擎（≤120 校验引擎已拒，违规保持原名）；随后退编辑。 */
  const commitRename = useCallback((spaceId: string, value: string) => {
    const name = value.trim()
    if (name !== '') useSpaceStore.getState().renameSpace(spaceId, name)
    useMissionControlStore.getState().setEditing(null)
  }, [])

  /**
   * 确认删除（无半删态，审计 §10 决定 2）：确认弹层是唯一确认步；确认后才
   * 同步执行「先逐窗 moveWindowToSpace → 最后一步才 deleteSpace」。取消路径
   * 零副作用（窗口一个都不动）。
   */
  const onConfirmDelete = useCallback(() => {
    const candidateId = deleteCandidateId
    if (!candidateId) return
    const spaceStore = useSpaceStore.getState()
    const targetId = migrationTargetId(spaces, candidateId)
    if (!targetId) return
    const moving = useWindowStore.getState().windows.filter((win) => win.spaceId === candidateId)
    if (moving.length === 0) {
      spaceStore.deleteSpace(candidateId)
    } else {
      if (spaceStore.activeSpaceId === candidateId) spaceStore.switchSpace(targetId)
      for (const win of moving) {
        useWindowStore.getState().moveWindowToSpace(win.id, targetId)
      }
      spaceStore.deleteSpace(candidateId)
    }
    setDeleteCandidateId(null)
    // spaces 依赖：migrationTargetId 读本轮快照；deleteCandidateId 依赖见上。
  }, [spaces, deleteCandidateId])

  if (!render) return null

  const deleteCandidate = spaces.find((space) => space.id === deleteCandidateId)
  const deleteTarget = deleteCandidate
    ? spaces.find((space) => space.id === migrationTargetId(spaces, deleteCandidate.id))
    : undefined
  // 拖拽影数据源：拖拽中窗口仍属当前 Space（drop 才迁移），必在 windows 里。
  const dragWin = drag ? windows.find((win) => win.id === drag.windowId) : undefined

  return (
    <div
      data-testid="mission-control-layer"
      role="dialog"
      aria-label={t('missionControl.title')}
      onPointerMove={onLayerPointerMove}
      onPointerUp={onLayerPointerUp}
      onPointerCancel={onLayerPointerCancel}
      // backdrop（非卡片/非胶囊/非按钮区）点击=关闭：内容岛 pointer-events-auto，
      // 中间地带 pointer-events-none 让点击目标落回层根。
      onClick={(event) => {
        if (event.target === event.currentTarget) useMissionControlStore.getState().close()
      }}
      className={`fixed inset-0 z-[60] overflow-hidden bg-scrim-strong transition-opacity duration-[120ms] ease-[cubic-bezier(0.55,0,1,0.45)] select-none ${
        exiting ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div
        ref={surfaceRef}
        // gap-6（真机反馈第四轮补偿值）：卡片区滚动容器加 pt-3（❌ 出挑余量，
        // 见下方卡片区注释）后，surface 纵向 gap 8→6 同步补偿——「条底→卡顶」
        // 总量 24+12=36px 与原 gap-8 的 32px 同档（E2E 24-40px 档带内）。
        className="pointer-events-none flex h-full flex-col items-center gap-6 px-10 pb-12 pt-14"
      >
        {/* Space 条（审计 §10 决定 2）：胶囊=name+N Apps；点击切换、双击/回车
            inline rename、+ 新建、删除钮仅非最后 Space 显示。 */}
        <div
          data-testid="mission-control-spaces"
          className="pointer-events-auto surface-glass glass-popover flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border-subtle p-1.5 shadow-popover"
        >
          {spaces.map((space) => {
            const isEditing = editingSpaceId === space.id
            const count = countBySpace.get(space.id) ?? 0
            return (
              <div key={space.id} className="relative flex shrink-0">
                {isEditing ? (
                  <input
                    data-testid="mission-control-space-rename"
                    data-space-id={space.id}
                    aria-label={t('missionControl.renameSpace')}
                    defaultValue={space.name}
                    ref={(el) => {
                      el?.focus()
                      el?.select()
                    }}
                    onBlur={(event) => {
                      // Enter 提交后编辑态已退（input 随即卸载）——blur 不再补刀。
                      if (useMissionControlStore.getState().editingSpaceId === space.id) {
                        commitRename(space.id, event.currentTarget.value)
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRename(space.id, event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        // 还原=直接退编辑（未应用过任何改动）。
                        useMissionControlStore.getState().setEditing(null)
                      }
                    }}
                    className="h-8 w-36 rounded-full bg-surface-raised px-3 text-xs text-text outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    data-testid="mission-control-space"
                    data-space-id={space.id}
                    data-space-drop={space.id}
                    data-active={space.id === activeSpaceId || undefined}
                    data-drop-active={drag?.targetSpaceId === space.id || undefined}
                    aria-current={space.id === activeSpaceId ? 'true' : undefined}
                    onClick={(event) => onSpaceClick(space.id, event.detail)}
                    onDoubleClick={() => onSpaceRenameEntry(space.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        onSpaceRenameEntry(space.id)
                      }
                    }}
                    className={`flex h-8 items-center gap-2 rounded-full px-3.5 text-xs transition-colors ${
                      space.id === activeSpaceId
                        ? '[background:var(--ag-capsule-active)] text-primary-contrast'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    } ${drag?.targetSpaceId === space.id ? 'ring-2 ring-primary' : ''}`}
                  >
                    <span className="max-w-32 truncate">{space.name}</span>
                    <span
                      className={`text-[10px] leading-none ${
                        space.id === activeSpaceId
                          ? 'text-primary-contrast/80'
                          : 'text-text-tertiary'
                      }`}
                    >
                      {formatMessage(t('missionControl.appsCount'), { count: String(count) })}
                    </span>
                  </button>
                )}
                {/* 删除钮仅非最后 Space 显示（隐藏而非禁用，与「最后一个拒删」
                    引擎语义一致，审计 §10 决定 2）；编辑期让位给 input。 */}
                {spaces.length > 1 && !isEditing && (
                  <button
                    type="button"
                    data-testid="mission-control-space-delete"
                    data-space-id={space.id}
                    aria-label={formatMessage(t('missionControl.deleteSpace'), {
                      name: space.name,
                    })}
                    onClick={() => {
                      // 空 Space 直接 deleteSpace；非空走迁移确认流（审计 §10 决定 2）。
                      if ((countBySpace.get(space.id) ?? 0) === 0) {
                        useSpaceStore.getState().deleteSpace(space.id)
                      } else {
                        setDeleteCandidateId(space.id)
                      }
                    }}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-subtle bg-surface-soft text-text-muted shadow-soft hover:text-text"
                  >
                    <X size={10} weight="bold" />
                  </button>
                )}
              </div>
            )
          })}
          <button
            type="button"
            data-testid="mission-control-new-space"
            aria-label={t('missionControl.newSpace')}
            onClick={onCreateSpace}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text"
          >
            <Plus size={14} weight="bold" />
          </button>
        </div>

        {/* 窗口卡片区=当前 Space 窗口；容器 pointer-events-none——卡片之间的
            空隙点击穿透到层根（backdrop 关闭语义），卡片自身恢复命中。
            真机反馈修复（Windows 任务视图同款网格）：旧单行起排在窄视口
            会横向溢出（卡片从视口左缘起排、右缘裁切+横向滚动条），改两层——
            外层=纵向滚动容器（flex-1+min-h-0 占满 Space 条下方余高；
            overflow-y-auto + overflow-x-hidden + 仓库既有 scroll-thin 细滚动
            条，Sidebar 同款组合），内层网格 flex-wrap 自动换行 +
            justify-center 行内居中：换行后任何窗口数量都无横向溢出（横向
            滚动条根除）。
            真机反馈第三轮（用户裁决「网格平移到 Space 条正下方=顶对齐」）：
            内层 m-auto 双向安全居中移除、第二轮 pb-28 上移偏置随之失去意义
            一并移除——网格落回外层滚动容器顶部=Space 条正下方；水平
            justify-center 与换行行为不变。顶对齐后超屏回落路径更简单：
            内容超出余高时 overflow-y-auto 从头滚动全部可达（不再依赖
            auto margin 归零）。
            真机反馈第四轮（❌ 关闭钮上缘被裁，用户截图 ❌ 只剩下半）：❌
            钮绝对定位 -top-2（出挑卡顶 8px），W16 顶对齐后网格紧贴本滚动
            容器上缘——出挑 8px 落在 overflow 裁剪区外被切。修复：本容器加
            pt-3（12px 出挑余量，❌ 完整可见）；surface 纵向 gap-8→gap-6
            同步补偿（24+12=36px ≈ 原 32px，「条底→卡顶」仍在 E2E 24-40px
            档带内，总高不 extra）。水平方向核查无需改动：justify-center
            居中行首尾卡不贴容器缘（-right-2 出挑由居中与 surface px-10
            双兜底），行首尾卡 ❌ 无对称裁切风险。拖拽中跟手视觉在根层
            拖拽影、原卡 pointer-events-none（W7 复核修复），本容器的滚动
            裁剪不参与拖拽视觉与命中测试；W7 语义零回归（elementFromPoint
            命中/影层根/卡片 ❌/pointer-events 分层/React.memo 全部原样）。 */}
        <div
          data-testid="mission-control-cards"
          className="scroll-thin pointer-events-none flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto pt-3"
        >
          <div className="flex w-full flex-wrap justify-center gap-4">
            {spaceWindows.map((win) => (
              <WindowCard
                key={win.id}
                win={win}
                dragging={drag?.windowId === win.id}
                onPointerDown={onCardPointerDown}
                onActivate={onCardActivate}
                onClose={onCardClose}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 根层拖拽影（W7 复核修复：跟手视觉脱离裁剪容器）：层根 fixed inset-0
          之内的 absolute 全屏层、z-20 高于内容岛、全程 pointer-events-none——
          视觉不被卡片区 overflow-y-auto 裁剪（修「拖向胶囊途中上缘被切断」），
          elementFromPoint 也不再有被拖卡遮挡（drop 命中天然落到胶囊）。影随
          指针 transform-only 移动，transform-origin 钉在抓取点=光标下恒定。 */}
      {drag && dragWin && (
        <div
          data-testid="mission-control-drag-layer"
          className="pointer-events-none absolute inset-0 z-20"
        >
          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate3d(${drag.pointerX - drag.grabX}px, ${
                drag.pointerY - drag.grabY
              }px, 0) scale(${DRAG_SCALE})`,
              transformOrigin: `${drag.grabX}px ${drag.grabY}px`,
            }}
          >
            <WindowDragGhost win={dragWin} />
          </div>
        </div>
      )}

      {/* 非空 Space 迁移删除确认（决策默认值 5 落点）：确认前零副作用——
          窗口一个不动、Space 一个不删；确认后同步迁移+删除，无半删态。
          取消路=backdrop 点击（下）与 Esc（上方 effect 自理，仅取消弹层）。 */}
      {deleteCandidate && deleteTarget && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-scrim/60"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDeleteCandidateId(null)
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={formatMessage(t('missionControl.deleteConfirm.title'), {
              name: deleteCandidate.name,
            })}
            data-testid="mission-control-delete-confirm"
            className="surface-glass glass-popover mx-6 w-full max-w-sm rounded-xl border border-border p-5 shadow-popover"
          >
            <h2 className="text-sm font-semibold text-text">
              {formatMessage(t('missionControl.deleteConfirm.title'), {
                name: deleteCandidate.name,
              })}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {formatMessage(t('missionControl.deleteConfirm.body'), {
                count: String(countBySpace.get(deleteCandidate.id) ?? 0),
                target: deleteTarget.name,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-testid="mission-control-delete-cancel"
                onClick={() => setDeleteCandidateId(null)}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-xs text-text hover:bg-surface-raised"
              >
                {t('missionControl.deleteConfirm.cancel')}
              </button>
              <button
                type="button"
                data-testid="mission-control-delete-confirm-button"
                onClick={onConfirmDelete}
                className="rounded-md bg-danger px-3 py-1.5 text-xs text-primary-contrast hover:opacity-90"
              >
                {t('missionControl.deleteConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
