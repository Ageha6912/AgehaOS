import { beforeEach, describe, expect, it } from 'vitest'

import { createVfs, MemoryAdapter } from '../filesystem'
import type { Vfs } from '../filesystem'
import { resolvePath, TerminalShell } from './shell'

function makeVfs(): Vfs {
  return createVfs({ adapter: new MemoryAdapter() })
}

async function seed(vfs: Vfs): Promise<void> {
  // The default tree already ships Desktop/Documents/Downloads/Pictures (§11.1).
  await vfs.writeFile('/Documents/todo.txt', 'line one\nline two')
}

let vfs: Vfs

beforeEach(async () => {
  vfs = makeVfs()
  await seed(vfs)
})

describe('resolvePath', () => {
  it('resolves relative paths against the cwd', () => {
    expect(resolvePath('/', 'Documents/todo.txt')).toBe('/Documents/todo.txt')
    expect(resolvePath('/Documents', 'todo.txt')).toBe('/Documents/todo.txt')
  })

  it('handles .. segments and empty parts', () => {
    expect(resolvePath('/Documents', '..')).toBe('/')
    expect(resolvePath('/Documents/sub', '../..')).toBe('/')
    expect(resolvePath('/Documents', './a//b/')).toBe('/Documents/a/b')
  })

  it('supports absolute paths anywhere', () => {
    expect(resolvePath('/Documents', '/Pictures')).toBe('/Pictures')
  })
})

describe('TerminalShell commands', () => {
  let shell: TerminalShell

  beforeEach(() => {
    shell = new TerminalShell(vfs, { user: 'alice' })
  })

  it('prints the cwd for pwd and tracks cd', async () => {
    expect(shell.cwd).toBe('/')
    expect((await shell.run('pwd')).lines).toEqual([{ kind: 'text', text: '/' }])

    await shell.run('cd Documents')
    expect(shell.cwd).toBe('/Documents')
    expect((await shell.run('pwd')).lines).toEqual([{ kind: 'text', text: '/Documents' }])
  })

  it('lists directory entries with a trailing slash for directories', async () => {
    await vfs.createDirectory('/Zed')
    const empty = await shell.run('ls Zed')
    expect(empty.lines).toEqual([])

    const root = await shell.run('ls /')
    const names = root.lines.map((line) => (line.kind === 'text' ? line.text : ''))
    expect(names).toContain('Zed/')
    expect(names).toContain('Documents/')
    // 排序稳定：全部按名称字典序。
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('prints file content across lines for cat', async () => {
    const result = await shell.run('cat Documents/todo.txt')
    expect(result.lines).toEqual([
      { kind: 'text', text: 'line one' },
      { kind: 'text', text: 'line two' },
    ])
  })

  it('creates files with touch and directories with mkdir', async () => {
    await shell.run('mkdir /Zed')
    await shell.run('touch Zed/a.txt')
    expect(await vfs.readFile('/Zed/a.txt')).toBe('')

    const exists = await shell.run('mkdir /Zed')
    expect(exists.lines[0]).toMatchObject({ kind: 'message', params: { path: '/Zed' } })
  })

  it('moves files to the trash with rm', async () => {
    const result = await shell.run('rm Documents/todo.txt')
    expect(result.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.info.trashed' })
    expect(await vfs.get('/Documents/todo.txt')).toBeNull()
    expect((await vfs.listTrash()).length).toBe(1)
  })

  it('echos text and answers whoami', async () => {
    // 无引号解析：参数按空白切分后单空格连接（v0.2 口径）。
    expect(await shell.run('echo hello   world')).toEqual({
      lines: [{ kind: 'text', text: 'hello world' }],
    })
    expect((await shell.run('whoami')).lines).toEqual([{ kind: 'text', text: 'alice' }])
  })

  it('clears the screen via the clear flag', async () => {
    const result = await shell.run('clear')
    expect(result.clear).toBe(true)
    expect(result.lines).toEqual([])
  })

  it('returns help output', async () => {
    const result = await shell.run('help')
    expect(result.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.help.body' })
  })

  it('reports unknown commands and missing operands as errors', async () => {
    const unknown = await shell.run('frobnicate now')
    expect(unknown.lines[0]).toMatchObject({
      kind: 'message',
      key: 'terminal.err.unknownCommand',
      params: { command: 'frobnicate' },
      tone: 'error',
    })

    const missing = await shell.run('cat')
    expect(missing.lines[0]).toMatchObject({
      kind: 'message',
      key: 'terminal.err.missingOperand',
      params: { command: 'cat' },
    })
  })
})

describe('TerminalShell error paths', () => {
  let shell: TerminalShell

  beforeEach(() => {
    shell = new TerminalShell(vfs)
  })

  it('rejects cd into files and missing directories', async () => {
    const file = await shell.run('cd Documents/todo.txt')
    expect(file.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.err.notDirectory' })

    const ghost = await shell.run('cd /Ghost')
    expect(ghost.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.err.notFound' })
  })

  it('rejects cat on directories and missing files', async () => {
    const dir = await shell.run('cat /Documents')
    expect(dir.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.err.isDirectory' })

    const ghost = await shell.run('cat nope.txt')
    expect(ghost.lines[0]).toMatchObject({ kind: 'message', key: 'terminal.err.notFound' })
  })

  it('ignores empty input without output', async () => {
    expect(await shell.run('   ')).toEqual({ lines: [] })
  })
})
