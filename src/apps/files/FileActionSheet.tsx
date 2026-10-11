import { useEffect, useRef, useState } from 'react'

import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  PencilSimple,
  Trash,
  TrashSimple,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'

import { fileRowActions } from './file-actions'
import type { FileBrowseMode, FileEntry, FileRowAction } from './file-actions'

/**
 * Files 行操作单（M3-6 Files 长按操作单，HANDOFF §4.0-7「Files 右键操作等价
 * 入口」）：桌面 Files 没有逐行右键菜单——逐行的真实可用操作 = 单击选中后
 * 工具栏的重命名/删除（回收站：还原/彻底删除）+ 双击打开；本组件把同一
 * 子集摆成 Bottom Sheet（动作清单由 file-actions.ts 纯函数分发，单测钉住），
 * 动作执行全部走 FileManager 既有逻辑（onAction 回调），本组件零业务。
 *
 * 形态语言与三张 M2 sheet + 最近任务（MobileNotificationSheet 等同构，互指）：
 * - `closed/open/leaving` 三相位——open→false 不经 null 空档，退场帧与原树
 *   同一 commit 接续，leaving 播完 200ms 再卸载，期间 pointer-events-none +
 *   aria-hidden 不挡底下应用；退场帧沿用最后一次条目渲染（动作把 entry 清
 *   null 后面板不闪空）。
 * - 玻璃口径（DESIGN.md §35.1）：白名单「Bottom Sheet」位 = surface-glass
 *   基底 + glass-raise 唯一玻璃层 + 顶部发丝边；backdrop 纯色压暗零 blur。
 * - 动效（§35.5）：进出场 200ms 只动 transform/opacity（--ag-motion-base）；
 *   prefers-reduced-motion 全局塌缩承接；motion-prefs「窗口切换转场」关档 →
 *   `.mobile-fileactions-static` 直切。
 * - 关闭路径：backdrop 点击 + Esc（document 捕获阶段）+ 取消行——关闭回焦
 *   长按行（接线在持有方 FileManager，桌面弹层关闭契约 §0.4 的移动口径）。
 * - 触控 ≥44px（§35.3）：动作行与取消行 min-h-[44px]。
 *
 * 挂载点在 Files 应用内部（`.mobile-shell` 作用域内，仅窄容器分支触发）；
 * 桌面宽容器此组件永不渲染，桌面右键菜单零接触。edge-back 共存：sheet 是
 * 宿主面板子树，左缘滑入返回时随面板一起退场（视图语义不变）。
 */
/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const SHEET_TRANSITION_MS = 200

/** sheet 相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type SheetPhase = 'closed' | 'open' | 'leaving'

/** 动作文案：打开是新键；重命名/删除/还原/彻底删除/取消复用桌面 Files
    同一词典键（A1：同一语义不另造键）。 */
const ACTION_LABEL_KEYS: Record<FileRowAction, MessageKey> = {
  open: 'mobile.files.actions.open',
  rename: 'files.rename',
  delete: 'files.delete',
  restore: 'files.restore',
  purge: 'files.purge',
}

const ACTION_ICONS: Record<FileRowAction, Icon> = {
  open: ArrowSquareOut,
  rename: PencilSimple,
  delete: Trash,
  restore: ArrowCounterClockwise,
  purge: TrashSimple,
}

/** 破坏性动作 danger 色（工具栏删除/彻底删除同语言）。 */
const DANGER_ACTIONS: ReadonlySet<FileRowAction> = new Set<FileRowAction>(['delete', 'purge'])

export interface FileActionSheetProps {
  /** 操作目标；null = 关闭（持有方持有开合状态，与三张 M2 sheet 同口径）。 */
  entry: FileEntry | null
  /** 当前视图（浏览 / 回收站）——动作子集随视图切换。 */
  mode: FileBrowseMode
  /** 目标显示名解析（根级目录本地化名归持有方词典逻辑）；退场帧沿用最后
      一次条目渲染，标题随 lastEntry 解析、不随 entry 清 null 闪空。 */
  titleFor: (entry: FileEntry) => string
  onClose: () => void
  onAction: (action: FileRowAction, entry: FileEntry) => void
}

export function FileActionSheet({ entry, mode, titleFor, onClose, onAction }: FileActionSheetProps) {
  const { t } = useTranslation()
  // 窗口切换转场档（motion-prefs）：关档 = sheet 直切（见模块注释动效段）。
  const transitionsOn = useMotionPrefsStore((s) => s.windowTilt)

  // ── 开关状态机：与 MobileNotificationSheet 同款（open→false 不经 null
  //    空档，退场帧与原树同一 commit 接续；渲染期校正，重开即时恢复入场）。 ─
  const open = entry !== null
  const [phase, setPhase] = useState<SheetPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('leaving')

  // 退场帧沿用最后一次条目渲染（渲染期校正，React 官方模式——禁渲染期读
  // ref 改用 state）：onAction 已把 entry 清 null，退场 200ms 内面板不闪空。
  const [lastEntry, setLastEntry] = useState<FileEntry | null>(entry)
  if (entry !== null && entry !== lastEntry) setLastEntry(entry)

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('closed'), SHEET_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // ── Esc 关闭：document 捕获阶段（三张 M2 sheet 同款，不参与桌面
  //    popover-store 互斥）；onClose 走 ref 免监听重挂；只在 open 相位监听。 ──
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
  const shown = lastEntry
  if (shown === null) return null
  const actions = fileRowActions(mode, shown.node)

  return (
    <div
      data-testid="files-action-sheet"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-fileactions fixed inset-0 z-[70] ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${transitionsOn ? '' : 'mobile-fileactions-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭。 */}
      <div
        data-testid="files-action-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-fileactions-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock/三张 M2 sheet 同档 blur 20px），顶部发丝边；
          锚底升出，上限 80% 视口（同构口径）。 */}
      <div
        data-testid="files-action-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.files.actions.title')}
        className="mobile-fileactions-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        {/* 抓手条：纯装饰（aria-hidden），Bottom Sheet 的形态语言。 */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--ag-border-strong)' }}
        />
        {/* 目标名：让用户明确在操作谁（长按后浮层盖住原行）。 */}
        <p
          data-testid="files-action-title"
          className="min-w-0 shrink-0 truncate px-4 pb-1 pt-2 text-xs"
          style={{ color: 'var(--ag-text-muted)' }}
        >
          {titleFor(shown)}
        </p>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {actions.map((action) => {
            const ActionIcon = ACTION_ICONS[action]
            const danger = DANGER_ACTIONS.has(action)
            return (
              <li key={action}>
                <button
                  type="button"
                  data-testid="files-action-item"
                  data-action={action}
                  onClick={() => onAction(action, shown)}
                  className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm transition-opacity active:opacity-80 ${
                    danger ? 'text-danger' : ''
                  }`}
                  style={danger ? undefined : { color: 'var(--ag-text)' }}
                >
                  <ActionIcon size={18} weight="regular" aria-hidden="true" />
                  {t(ACTION_LABEL_KEYS[action])}
                </button>
              </li>
            )
          })}
          <li className="mt-1 border-t" style={{ borderColor: 'var(--ag-border-subtle)' }}>
            {/* 取消行：显式 ≥44px 关闭目标（backdrop/Esc 之外的第三条路）。 */}
            <button
              type="button"
              data-testid="files-action-cancel"
              onClick={onClose}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl px-3 text-sm font-medium transition-opacity active:opacity-80"
              style={{ color: 'var(--ag-text)' }}
            >
              {t('files.dialog.cancel')}
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
