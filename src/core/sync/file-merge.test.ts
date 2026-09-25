import { describe, expect, it } from 'vitest'

import { conflictPathFor, hashContent, mergeTrees } from './file-merge'
import type { SyncTreeV2 } from './file-merge'

const h = (content: string): string => hashContent(content)

function tree(
  files: Record<string, string>,
  dirs: string[] = ['/Documents'],
): SyncTreeV2 {
  const entries: SyncTreeV2['files'] = {}
  for (const [path, content] of Object.entries(files)) {
    entries[path] = { hash: h(content), content }
  }
  return { dirs, files: entries }
}

describe('hashContent（变更检测哈希）', () => {
  it('is deterministic and content-sensitive', () => {
    expect(h('hello')).toBe(h('hello'))
    expect(h('hello')).not.toBe(h('helló'))
    expect(h('hello')).toContain('-5')
  })
})

describe('conflictPathFor（冲突副本命名）', () => {
  it('inserts the marker before the extension', () => {
    expect(conflictPathFor('/Documents/a.txt', 1000, new Set())).toBe('/Documents/a.conflict-1000.txt')
    expect(conflictPathFor('/Documents/notes', 1000, new Set())).toBe('/Documents/notes.conflict-1000')
    expect(conflictPathFor('b.md', 7, new Set())).toBe('b.conflict-7.md')
  })

  it('numbers around occupied paths', () => {
    const taken = new Set(['/Documents/a.conflict-1000.txt'])
    expect(conflictPathFor('/Documents/a.txt', 1000, taken)).toBe('/Documents/a.conflict-1000-2.txt')
    taken.add('/Documents/a.conflict-1000-2.txt')
    expect(conflictPathFor('/Documents/a.txt', 1000, taken)).toBe('/Documents/a.conflict-1000-3.txt')
  })
})

describe('mergeTrees（三方逐文件合并，ADR 17）', () => {
  const BASE = { '/Documents/a.txt': h('base') }

  it('uploads the local change when the server is untouched', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({ '/Documents/a.txt': 'local edit' }),
      server: tree({ '/Documents/a.txt': 'base' }),
      savedAt: 1000,
    })
    expect(result.merged.files['/Documents/a.txt']?.content).toBe('local edit')
    expect(result.downloads).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.localDeletions).toEqual([])
  })

  it('downloads the server change when the local side is untouched', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({ '/Documents/a.txt': 'base' }),
      server: tree({ '/Documents/a.txt': 'server edit' }),
      savedAt: 1000,
    })
    expect(result.merged.files['/Documents/a.txt']?.content).toBe('server edit')
    expect(result.downloads).toEqual([{ path: '/Documents/a.txt', content: 'server edit' }])
    expect(result.conflicts).toEqual([])
  })

  it('merges cleanly when both sides applied the same change', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({ '/Documents/a.txt': 'same edit' }),
      server: tree({ '/Documents/a.txt': 'same edit' }),
      savedAt: 1000,
    })
    expect(result.merged.files['/Documents/a.txt']?.content).toBe('same edit')
    expect(result.conflicts).toEqual([])
  })

  it('keeps both versions on a real edit/edit conflict', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({ '/Documents/a.txt': 'local edit' }),
      server: tree({ '/Documents/a.txt': 'server edit' }),
      savedAt: 1000,
    })
    // 本地原地保留。
    expect(result.merged.files['/Documents/a.txt']?.content).toBe('local edit')
    // 服务端版本另存副本，且进入合并树（会上传、也会落盘）。
    expect(result.conflicts).toEqual([
      { path: '/Documents/a.txt', conflictPath: '/Documents/a.conflict-1000.txt', content: 'server edit' },
    ])
    expect(result.merged.files['/Documents/a.conflict-1000.txt']?.content).toBe('server edit')
    // 副本父目录得到保证。
    expect(result.merged.dirs).toContain('/Documents')
  })

  it('keeps both sides of independent new files without a conflict', () => {
    const result = mergeTrees({
      base: {},
      local: tree({ '/Documents/local-new.txt': 'L' }),
      server: tree({ '/Documents/server-new.txt': 'S' }),
      savedAt: 1000,
    })
    expect(Object.keys(result.merged.files).sort()).toEqual(['/Documents/local-new.txt', '/Documents/server-new.txt'])
    expect(result.downloads).toEqual([{ path: '/Documents/server-new.txt', content: 'S' }])
    expect(result.conflicts).toEqual([])
  })

  it('conflicts when both sides create the same path with different content', () => {
    const result = mergeTrees({
      base: {},
      local: tree({ '/Documents/new.txt': 'L' }),
      server: tree({ '/Documents/new.txt': 'S' }),
      savedAt: 2000,
    })
    expect(result.merged.files['/Documents/new.txt']?.content).toBe('L')
    expect(result.merged.files['/Documents/new.conflict-2000.txt']?.content).toBe('S')
    expect(result.conflicts).toHaveLength(1)
  })

  it('follows a server deletion when the local side is untouched', () => {
    const result = mergeTrees({
      base: BASE,
      // 本地磁盘上文件还在（未动）；服务端已删除。
      local: tree({ '/Documents/a.txt': 'base' }),
      server: tree({}),
      savedAt: 1000,
    })
    expect(result.localDeletions).toEqual(['/Documents/a.txt'])
    expect(result.merged.files['/Documents/a.txt']).toBeUndefined()
  })

  it('prefers the local edit over a server deletion (不丢数据)', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({ '/Documents/a.txt': 'local edit' }),
      server: tree({}),
      savedAt: 1000,
    })
    expect(result.merged.files['/Documents/a.txt']?.content).toBe('local edit')
    expect(result.localDeletions).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('propagates a local deletion when the server is untouched', () => {
    const result = mergeTrees({
      base: { '/Documents/a.txt': h('base'), '/Documents/keep.txt': h('k') },
      local: tree({ '/Documents/keep.txt': 'k' }),
      server: tree({ '/Documents/a.txt': 'base', '/Documents/keep.txt': 'k' }),
      savedAt: 1000,
    })
    expect(result.localDeletions).toEqual([])
    expect(result.merged.files['/Documents/a.txt']).toBeUndefined()
    expect(result.merged.files['/Documents/keep.txt']).toBeDefined()
  })

  it('restores a changed server file as a conflict copy when the local side deleted it', () => {
    const result = mergeTrees({
      base: BASE,
      local: tree({}),
      server: tree({ '/Documents/a.txt': 'server edit' }),
      savedAt: 3000,
    })
    // 本地删除意图之外，服务端版本经副本找回；原路径不再出现。
    expect(result.merged.files['/Documents/a.txt']).toBeUndefined()
    expect(result.merged.files['/Documents/a.conflict-3000.txt']?.content).toBe('server edit')
    expect(result.downloads).toEqual([])
  })

  it('ensures parent dirs for deep downloaded files', () => {
    const result = mergeTrees({
      base: {},
      local: tree({}),
      server: tree({ '/Documents/deep/nest/file.txt': 'deep' }, ['/Documents', '/Documents/deep', '/Documents/deep/nest']),
      savedAt: 1000,
    })
    expect(result.downloads).toHaveLength(1)
    for (const dir of ['/Documents/deep', '/Documents/deep/nest']) {
      expect(result.merged.dirs).toContain(dir)
    }
  })
})
