import { VfsError } from '../filesystem'
import type { Vfs, VfsNode } from '../filesystem'
import type { MessageKey } from '../i18n'

/**
 * 终端伪 Shell（PRD §26 Terminal，v0.2）：以 VFS 为文件系统的纯 TS 命令引擎。
 *
 * 无转义/引号解析——参数按空白切分（v0.2 口径）；`rm` 沿用 VFS 回收站语义
 * （与 Files 应用一致，help 中说明）。输出行是结构化的：字面文本或 i18n 键，
 * 渲染层负责翻译。
 */

export type TerminalTone = 'default' | 'error' | 'muted'

export type TerminalLine =
  | { kind: 'text'; text: string; tone?: TerminalTone }
  | { kind: 'message'; key: MessageKey; params?: Record<string, string>; tone?: TerminalTone }

export interface TerminalResult {
  lines: TerminalLine[]
  /** true 时组件清空既有输出（clear 命令）。 */
  clear?: boolean
}

export const TERMINAL_COMMANDS = [
  'pwd',
  'ls',
  'cd',
  'cat',
  'echo',
  'mkdir',
  'touch',
  'rm',
  'date',
  'whoami',
  'clear',
  'help',
] as const

export function resolvePath(cwd: string, input: string): string {
  const raw = input.trim()
  const absolute = raw.startsWith('/')
  const parts = (absolute ? raw : `${cwd}/${raw}`).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join('/')}`
}

export class TerminalShell {
  private cwdInternal = '/'

  constructor(
    private readonly vfs: Vfs,
    private readonly options: { user?: string } = {},
  ) {}

  get cwd(): string {
    return this.cwdInternal
  }

  get prompt(): string {
    return `${this.options.user ?? 'user'}@agehaos:${this.cwdInternal}$`
  }

  async run(input: string): Promise<TerminalResult> {
    try {
      return await this.runCommand(input)
    } catch (cause) {
      // VFS 异常映射为错误行（B2 审查）：rm /、mkdir deep/nested、cat 二进制
      // 等此前直接 reject——用户只看到回显、组件 unhandled rejection 且零输出。
      const detail =
        cause instanceof VfsError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause)
      return { lines: [message('terminal.err.failed', { message: detail }, 'error')] }
    }
  }

  private async runCommand(input: string): Promise<TerminalResult> {
    const tokens = input.trim().split(/\s+/).filter((token) => token.length > 0)
    if (tokens.length === 0) return { lines: [] }
    const [command, ...args] = tokens
    switch (command) {
      case 'pwd':
        return { lines: [text(this.cwdInternal)] }
      case 'ls':
        return this.ls(args[0])
      case 'cd':
        return this.cd(args[0])
      case 'cat':
        return this.cat(args[0])
      case 'echo':
        return { lines: [text(args.join(' '))] }
      case 'mkdir':
        return this.mkdir(args[0])
      case 'touch':
        return this.touch(args[0])
      case 'rm':
        return this.rm(args[0])
      case 'date':
        return { lines: [text(new Date().toISOString(), 'muted')] }
      case 'whoami':
        return { lines: [text(this.options.user ?? 'user')] }
      case 'clear':
        return { lines: [], clear: true }
      case 'help':
        return { lines: [{ kind: 'message', key: 'terminal.help.body' }] }
      default:
        return {
          lines: [
            {
              kind: 'message',
              key: 'terminal.err.unknownCommand',
              params: { command: String(command) },
              tone: 'error',
            },
          ],
        }
    }
  }

  private async lookup(rawPath: string | undefined): Promise<{ path: string; node: VfsNode } | null> {
    if (rawPath === undefined) return null
    const path = resolvePath(this.cwdInternal, rawPath)
    const node = await this.vfs.get(path)
    return node ? { path, node } : null
  }

  private async ls(rawPath: string | undefined): Promise<TerminalResult> {
    const path = resolvePath(this.cwdInternal, rawPath ?? '.')
    const node = await this.vfs.get(path)
    if (!node) return this.notFound(path)
    if (node.type === 'file') return { lines: [text(node.name)] }
    const children = await this.vfs.list(path)
    const lines = children
      .map((child) => text(child.type === 'directory' ? `${child.name}/` : child.name))
      .sort((a, b) => {
        const aText = a.kind === 'text' ? a.text : ''
        const bText = b.kind === 'text' ? b.text : ''
        return aText.localeCompare(bText)
      })
    return { lines }
  }

  private async cd(rawPath: string | undefined): Promise<TerminalResult> {
    const path = resolvePath(this.cwdInternal, rawPath ?? '/')
    const node = await this.vfs.get(path)
    if (!node) return this.notFound(path)
    if (node.type !== 'directory') {
      return {
        lines: [message('terminal.err.notDirectory', { path })],
      }
    }
    this.cwdInternal = path
    return { lines: [] }
  }

  private async cat(rawPath: string | undefined): Promise<TerminalResult> {
    if (rawPath === undefined) return this.missingOperand('cat')
    const resolved = await this.lookup(rawPath)
    if (!resolved) return this.notFound(resolvePath(this.cwdInternal, rawPath))
    if (resolved.node.type !== 'file') {
      return { lines: [message('terminal.err.isDirectory', { path: resolved.path })] }
    }
    const content = await this.vfs.readFile(resolved.path)
    return { lines: content.split('\n').map((line) => text(line)) }
  }

  private async mkdir(rawPath: string | undefined): Promise<TerminalResult> {
    if (rawPath === undefined) return this.missingOperand('mkdir')
    const path = resolvePath(this.cwdInternal, rawPath)
    if (await this.vfs.get(path)) {
      return { lines: [message('terminal.err.exists', { path })] }
    }
    await this.vfs.createDirectory(path)
    return { lines: [] }
  }

  private async touch(rawPath: string | undefined): Promise<TerminalResult> {
    if (rawPath === undefined) return this.missingOperand('touch')
    const path = resolvePath(this.cwdInternal, rawPath)
    if (await this.vfs.get(path)) return { lines: [] }
    await this.vfs.writeFile(path, '')
    return { lines: [] }
  }

  private async rm(rawPath: string | undefined): Promise<TerminalResult> {
    if (rawPath === undefined) return this.missingOperand('rm')
    const resolved = await this.lookup(rawPath)
    if (!resolved) return this.notFound(resolvePath(this.cwdInternal, rawPath))
    await this.vfs.remove(resolved.path)
    // VFS 语义是回收站删除（与 Files 应用一致），提示避免「文件去哪了」困惑。
    return { lines: [message('terminal.info.trashed', { path: resolved.path }, 'muted')] }
  }

  private notFound(path: string): TerminalResult {
    return { lines: [message('terminal.err.notFound', { path }, 'error')] }
  }

  private missingOperand(command: string): TerminalResult {
    return { lines: [message('terminal.err.missingOperand', { command }, 'error')] }
  }
}

function text(value: string, tone?: TerminalTone): TerminalLine {
  return { kind: 'text', text: value, ...(tone ? { tone } : {}) }
}

function message(
  key: MessageKey,
  params?: Record<string, string>,
  tone?: TerminalTone,
): TerminalLine {
  return { kind: 'message', key, ...(params ? { params } : {}), ...(tone ? { tone } : {}) }
}
