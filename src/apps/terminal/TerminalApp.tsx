import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { formatMessage } from '@/core/i18n'
import { systemVfs } from '@/services/vfs'
import { useSessionStore } from '@/store/session-store'
import { TerminalShell } from '@/core/terminal/shell'
import type { TerminalLine } from '@/core/terminal/shell'

/**
 * 终端应用（PRD §26，v0.2）：伪 Shell over VFS。输出区 + 单行输入，↑↓ 召回
 * 本会话命令历史，终端语义的 clear 由 shell 返回 clear 标记驱动。
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

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries])

  const submit = useCallback(async (): Promise<void> => {
    const command = input
    if (command.trim().length === 0) return
    setInput('')
    setEntries((prev) => [...prev, { kind: 'text', text: shell.prompt } , { kind: 'text', text: command }])
    setHistory((prev) => [...prev, command])
    setHistoryIndex(null)
    setBusy(true)
    try {
      const result = await shell.run(command)
      if (!aliveRef.current) return
      if (result.clear) {
        setEntries([])
      } else {
        setEntries((prev) => [...prev, ...result.lines])
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

  const renderLine = (line: TerminalLine): string => {
    if (line.kind === 'text') return line.text
    return formatMessage(t(line.key), line.params ?? {})
  }
  const toneClass = (line: TerminalLine): string =>
    line.tone === 'error' ? 'text-danger' : line.tone === 'muted' ? 'text-text-muted' : 'text-text'

  return (
    <div
      className="surface-panel flex h-full flex-col font-mono text-xs"
      data-testid="terminal-root"
      onClick={() => inputRef.current?.focus()}
    >
      {/* 输出井：内嵌凹槽（DESIGN.md §2.1），终端内容都在井内滚动。 */}
      <div
        ref={scrollRef}
        className="m-2 min-h-0 flex-1 overflow-y-auto rounded-md bg-surface-raised/60 p-3 leading-relaxed"
        data-testid="terminal-output"
      >
        {entries.map((line, index) => (
          <pre key={index} className={`whitespace-pre-wrap break-all ${toneClass(line)}`}>
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
            aria-label={t('terminal.input')}
            data-testid="terminal-input"
            className="min-w-0 flex-1 bg-transparent text-text caret-primary focus-visible:outline-none"
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
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
    </div>
  )
}
