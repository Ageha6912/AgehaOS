import { useCallback, useEffect, useRef, useState } from 'react'

import { useNarrowContainer } from '@/apps/use-narrow-container'
import { isImeComposing } from '@/components/ime-guard'
import { useTranslation } from '@/core/i18n'
import { formatMessage } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { systemVfs } from '@/services/vfs'
import { useDeviceStore } from '@/store/device-store'
import { useSessionStore } from '@/store/session-store'
import { TERMINAL_COMMANDS, TerminalShell } from '@/core/terminal/shell'
import type { TerminalLine } from '@/core/terminal/shell'

import { keyboardInsetPx } from './keyboard-inset'

/** 会话历史与输出行上限（D1 审查：长会话内存/DOM 不再无界增长）。 */
const TERMINAL_HISTORY_LIMIT = 500
const TERMINAL_OUTPUT_LIMIT = 800
import { completeCommandLine, sequenceAction, TERMINAL_KEY_ROW, TERMINAL_KEY_SEQUENCES } from './terminal-keys'
import type { TerminalActionKey } from './terminal-keys'

/** 键帽 → aria 动作说明（键帽本身是通用键名，说明文案走 i18n 双语铁律）。 */
const TERMINAL_KEY_ARIA: Record<TerminalActionKey, MessageKey> = {
  esc: 'terminal.keys.esc',
  tab: 'terminal.keys.tab',
  'ctrl-c': 'terminal.keys.ctrlC',
  'arrow-up': 'terminal.keys.arrowUp',
  'arrow-down': 'terminal.keys.arrowDown',
}

/**
 * 终端应用（PRD §26，v0.2）：伪 Shell over VFS。输出区 + 单行输入，↑↓ 召回
 * 本会话命令历史，终端语义的 clear 由 shell 返回 clear 标记驱动。
 *
 * 窄容器适配（M3-5）：根内容盒 <560px 时（移动全屏视图 / 桌面窄窗口）
 * ①字号抬到 16px 档——长行照旧 break-all 折行不横向溢出，且输入行 ≥16px
 * 后 iOS Safari 聚焦不再触发页面自动缩放；②输入行触控档 ≥44px（§35.3）；
 * ③输出井 overscroll-contain 收滚动链（滚到头不传给宿主面板，滚动顺畅）；
 * ④触屏设备（device-store 能力位）上做软键盘避让——visualViewport 被
 * 键盘压缩时根高度让出遮挡部分、输入行保持可视（「可输入可滚动」；
 * 光标定位等真机细节归真机冒烟调参）。宽容器 DOM 与改前字面等价；
 * visualViewport 处理只在触屏生效，桌面 Ctrl+缩放不改变形。判定与设备
 * 无关走 use-narrow-container 契约（禁视口 media query），触屏与否只读
 * device-store（设备判定铁律的既有豁免点）。
 *
 * 快捷键行（M4-4，仅窄容器）：软键盘没有 Esc/Tab/Ctrl/方向键，输出井
 * 下方补一排五个真实触控键（§35.3 命中区 ≥44px）——发送通道与物理键盘
 * 同一条会话语义：键先按 wire 契约编码成控制序列（terminal-keys.ts），
 * 会话侧解码后复用 recall / 输入 / 输出井状态（↑↓ 召回、Tab 命令名补全、
 * Esc 取消草稿、Ctrl+C 提示符处中断回显 ^C）。行是根的最后一个流内
 * 子元素——软键盘弹起时根由④让高，行贴键盘上沿、在输入行之下不遮挡
 * （键盘行为归真机冒烟，e2e 只钉流内几何）。busy 期整行随输入行一并
 * 禁用：伪 Shell 无进程模型，不做假中断。§35.1 玻璃清单外：实色轻透明
 * 白纱 + 零 blur；`data-no-edge-back` = 行首按键起手的拖拽不触发边缘
 * 返回（Files 工具行同款误手势豁免）。宽容器不渲染，DOM 与改前等价。
 */
export function TerminalApp() {
  const { t } = useTranslation()
  const user = useSessionStore((s) => s.user)
  // Shell 随窗口创建一次；窗口关闭即销毁，无跨会话状态。
  const [shell] = useState(() => new TerminalShell(systemVfs, { user: user?.username }))

  const [entries, setEntries] = useState<TerminalLine[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const aliveRef = useRef(true)

  // 窄容器分支（M3-5）：观测应用根内容盒宽，与设备判定（device-store）
  // 无关——桌面窄窗口同样进入窄分支，移动宽视口保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  // 软键盘避让的触屏门（见模块注释④）：桌面 visualViewport 只会因缩放
  // 变化，窄窗口不应跟着变形。
  const isTouch = useDeviceStore((s) => s.capabilities.isTouch)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const scrollWellToBottom = useCallback((): void => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [])

  useEffect(() => {
    scrollWellToBottom()
  }, [entries, scrollWellToBottom])

  // 软键盘避让（M3-5④，窄容器 + 触屏）：visualViewport resize/scroll 时把
  // 根高度让出被键盘盖住的部分——输出井收短、输入行保持可视；inset 增大
  // （键盘弹起）顺手把井滚到底让输入行立即可见，vv 用户滚动（inset 不变）
  // 不抢滚动权。事件 rAF 合帧直写 style，全程零 React render（手势同款
  // 纪律）；键盘收起恢复类名控高、卸载清理监听。visualViewport 缺席
  // （老浏览器 / jsdom）整段不接，终端照常「可输入可滚动」。
  useEffect(() => {
    if (!narrow || !isTouch) return
    const root = rootRef.current
    const viewport = typeof visualViewport === 'undefined' ? null : visualViewport
    if (!root || !viewport) return
    let rafId: number | null = null
    let lastInset = -1
    const flush = (): void => {
      rafId = null
      const inset = keyboardInsetPx(window.innerHeight, viewport)
      root.style.height = inset > 0 ? `calc(100% - ${inset}px)` : ''
      if (inset > lastInset && lastInset >= 0 && inset > 0) scrollWellToBottom()
      lastInset = inset
    }
    const schedule = (): void => {
      if (rafId !== null) return
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(flush)
      } else {
        flush()
      }
    }
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    flush()
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      root.style.height = ''
    }
  }, [narrow, isTouch, rootRef, scrollWellToBottom])

  // 点击根聚焦输入（终端即焦点，index.css 对 terminal-input 关焦点环）；
  // 窄容器下顺手滚到底——软键盘弹起前输入行先可见（键盘 inset 路径随后
  // 接管）。桌面聚焦/点选行为与改前一致（不滚动）。
  const focusInput = useCallback((): void => {
    inputRef.current?.focus()
    if (narrow) scrollWellToBottom()
  }, [narrow, scrollWellToBottom])

  const submit = useCallback(async (): Promise<void> => {
    const command = input
    if (command.trim().length === 0) return
    setInput('')
    setEntries((prev) => [...prev, { kind: 'text', text: shell.prompt } , { kind: 'text', text: command }])
    // 会话历史封顶（D1 审查：长会话 setHistory 永久增长，内存/召回遍历膨胀）。
    setHistory((prev) => [...prev.slice(-(TERMINAL_HISTORY_LIMIT - 1)), command])
    setHistoryIndex(null)
    setBusy(true)
    try {
      const result = await shell.run(command)
      if (!aliveRef.current) return
      if (result.clear) {
        setEntries([])
      } else {
        // 输出行保留最近 N 行（D1 审查：entries 无上限长会话 DOM 膨胀）。
        setEntries((prev) => [...prev, ...result.lines].slice(-TERMINAL_OUTPUT_LIMIT))
      }
    } catch (cause) {
      // 兜底（shell 已内建映射）：任何意外异常也不留 unhandled rejection。
      if (aliveRef.current) {
        setEntries((prev) => [
          ...prev,
          {
            kind: 'message',
            key: 'terminal.err.failed',
            params: { message: cause instanceof Error ? cause.message : String(cause) },
            tone: 'error',
          },
        ])
      }
    } finally {
      if (aliveRef.current) setBusy(false)
      inputRef.current?.focus()
    }
  }, [input, shell])

  const recall = (direction: -1 | 1): void => {
    if (history.length === 0) return
    let index = historyIndex ?? history.length
    index = Math.min(Math.max(index + direction, 0), history.length)
    setHistoryIndex(index)
    setInput(history[index] ?? '')
  }

  // 快捷键行发送通道（M4-4）：触控键按 wire 契约编码成控制序列后交会话
  // 解码执行——↑↓ 与物理方向键同一 recall；Tab/Esc/Ctrl+C 是会话行编辑
  // 语义（见 terminal-keys.ts 模块注释）。点击随后冒泡到根的 focusInput，
  // 动作完成后输入行保持聚焦可继续打字；busy 期按钮 disabled 不分发。
  const sendActionKey = (key: TerminalActionKey): void => {
    const action = sequenceAction(TERMINAL_KEY_SEQUENCES[key])
    if (action === 'arrow-up') {
      recall(-1)
    } else if (action === 'arrow-down') {
      recall(1)
    } else if (action === 'tab') {
      // 命令名补全：唯一命中才动输入（null = 无进展，输入原样保留）。
      const completed = completeCommandLine(input, TERMINAL_COMMANDS)
      if (completed !== null) setInput(completed)
    } else if (action === 'esc') {
      // 取消当前行草稿：清空输入并复位历史游标（下次 ↑ 从末尾重召回），
      // 不产生输出、不进历史。
      setInput('')
      setHistoryIndex(null)
    } else if (action === 'ctrl-c') {
      // 提示符处中断（bash 可见效果）：回显「提示符 / 草稿^C」后清行；
      // 游标同 Esc 复位。执行期（busy）整行已禁用——无进程模型不做假中断。
      setEntries((prev) => [
        ...prev,
        { kind: 'text', text: shell.prompt },
        { kind: 'text', text: `${input}^C` },
      ])
      setInput('')
      setHistoryIndex(null)
      scrollWellToBottom()
    }
  }

  const renderLine = (line: TerminalLine): string => {
    if (line.kind === 'text') return line.text
    return formatMessage(t(line.key), line.params ?? {})
  }
  const toneClass = (line: TerminalLine): string =>
    line.tone === 'error' ? 'text-danger' : line.tone === 'muted' ? 'text-text-muted' : 'text-text'

  return (
    <div
      ref={rootRef}
      className={`surface-panel flex h-full flex-col font-mono ${narrow ? 'text-base' : 'text-xs'}`}
      data-testid="terminal-root"
      onClick={focusInput}
    >
      {/* 输出井：内嵌凹槽（DESIGN.md §2.1），终端内容都在井内滚动。窄容器
          追加 overscroll-contain——井滚到头不再把滚动链传给宿主面板
          （.mobile-app-body 同口径），触屏滚动顺畅。 */}
      <div
        ref={scrollRef}
        className={`m-2 min-h-0 flex-1 ${narrow ? 'overscroll-contain ' : ''}overflow-y-auto rounded-md bg-surface-raised/60 p-3 leading-relaxed`}
        data-testid="terminal-output"
      >
        {entries.map((line, index) => (
          <pre key={index} data-testid="terminal-line" className={`whitespace-pre-wrap break-all ${toneClass(line)}`}>
            {renderLine(line)}
          </pre>
        ))}
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="whitespace-nowrap text-primary">
            {shell.prompt}
          </span>
          <input
            ref={inputRef}
            value={input}
            spellCheck={false}
            autoComplete="off"
            {...(narrow
              ? {
                  // 软键盘修正：命令是全小写自由文本，关自动大写/自动更正，
                  // Enter 用 send 键位；聚焦即滚到底（输入行保持可视）。
                  autoCapitalize: 'off',
                  autoCorrect: 'off',
                  enterKeyHint: 'send',
                  onFocus: scrollWellToBottom,
                }
              : {})}
            aria-label={t('terminal.input')}
            data-testid="terminal-input"
            className={`min-w-0 flex-1 ${narrow ? 'min-h-[44px] ' : ''}bg-transparent text-text caret-primary focus-visible:outline-none`}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // 输入法组合期（选词确认 / 候选翻页）的 Enter/↑/↓ 属于 IME，
              // 不是提交或召回历史（D1 审查：中文文件名/参数必现提前提交）。
              if (isImeComposing(event.nativeEvent)) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                recall(-1)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                recall(1)
              }
            }}
          />
        </div>
      </div>
      {/* 快捷键行（M4-4，仅窄容器）：输出井下方、根的最后一个流内子元素——
          软键盘弹起时根让高，本行贴键盘上沿、在输入行之下不遮挡。 */}
      {narrow ? (
        <div
          role="group"
          aria-label={t('terminal.keys.row')}
          className="flex shrink-0 gap-1.5 px-2 pb-2"
          data-no-edge-back=""
          data-testid="terminal-key-row"
        >
          {TERMINAL_KEY_ROW.map((key) => (
            <button
              key={key.id}
              type="button"
              aria-label={t(TERMINAL_KEY_ARIA[key.id])}
              className="flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-md bg-surface-raised/60 font-mono text-sm text-text active:bg-surface-raised disabled:text-text-disabled"
              data-testid={`terminal-key-${key.id}`}
              disabled={busy}
              onClick={() => sendActionKey(key.id)}
            >
              {key.cap}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
