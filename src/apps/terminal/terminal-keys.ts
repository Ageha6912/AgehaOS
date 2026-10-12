/**
 * 终端快捷键 wire 契约（M4-4，可单测纯函数）：软键盘缺失的行编辑键
 * （Esc / Tab / Ctrl+C / ↑ / ↓）→ 终端控制序列的编码映射 + 会话侧解码 +
 * Tab 命令名补全。判定全部离成纯函数（手势家族同款纪律），渲染层只消费。
 *
 * 序列取真终端 wire 语义：ESC = 0x1B、Tab = HT 0x09、Ctrl+C = ETX 0x03
 * （POSIX 终端 intr 中断符）、↑/↓ = CSI A/B（`ESC [ A` / `ESC [ B`）。
 * 会话行编辑语义（TerminalApp 消费）：↑↓ 召回历史（与物理方向键同一
 * recall 通道）、Tab 补全命令名、Esc 取消当前行草稿（cmd.exe/PowerShell
 * 行编辑同款）、Ctrl+C 提示符处中断——回显「提示符 / 草稿^C」后清行
 * （bash 的可见效果；伪 Shell 无进程模型，busy 期整行随输入一并禁用，
 * 绝不做假中断）。
 */

export type TerminalActionKey = 'esc' | 'tab' | 'ctrl-c' | 'arrow-up' | 'arrow-down'

/** 键 → 控制序列（wire 契约；码位由单测钉扎）。 */
export const TERMINAL_KEY_SEQUENCES: Readonly<Record<TerminalActionKey, string>> = {
  esc: '\x1b',
  tab: '\t',
  'ctrl-c': '\x03',
  'arrow-up': '\x1b[A',
  'arrow-down': '\x1b[B',
}

export interface TerminalKeyCap {
  id: TerminalActionKey
  /** 键帽字面（通用键名/符号，与 locale 无关）；动作说明走 i18n aria 标签。 */
  cap: string
}

/** 键帽行排列序（Esc / Tab / Ctrl+C / ↑ / ↓）——渲染序单一来源。 */
export const TERMINAL_KEY_ROW: readonly TerminalKeyCap[] = [
  { id: 'esc', cap: 'Esc' },
  { id: 'tab', cap: 'Tab' },
  { id: 'ctrl-c', cap: 'Ctrl+C' },
  { id: 'arrow-up', cap: '↑' },
  { id: 'arrow-down', cap: '↓' },
]

/** 控制序列 → 会话行编辑动作（与编码映射互逆；未知序列回 null 绝不抛错）。 */
export function sequenceAction(sequence: string): TerminalActionKey | null {
  const entry = (Object.entries(TERMINAL_KEY_SEQUENCES) as [TerminalActionKey, string][]).find(
    ([, seq]) => seq === sequence,
  )
  return entry ? entry[0] : null
}

/**
 * Tab 命令名补全（readline 口径）：仅补首个词——命令名；参数是文件路径，
 * VFS 补全不在本期（带空白即不动作，绝不猜路径）。唯一命中（含已完整
 * 输入）补全命令名 + 尾随空格（bash 同款，补完即可接参数）；多命中补到
 * 公共前缀，公共前缀不长于现输入（无进展）回 null。
 */
export function completeCommandLine(input: string, commands: readonly string[]): string | null {
  if (input.length === 0 || /\s/.test(input)) return null
  const matches = commands.filter((command) => command.startsWith(input))
  if (matches.length === 0) return null
  if (matches.length === 1) return `${matches[0]} `
  let prefix = matches[0]
  for (const command of matches.slice(1)) {
    let i = 0
    while (i < prefix.length && i < command.length && prefix[i] === command[i]) i += 1
    prefix = prefix.slice(0, i)
  }
  return prefix.length > input.length ? prefix : null
}
