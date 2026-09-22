import { describe, it, expect, vi, beforeEach } from 'vitest'

import { EventBus, type SystemEventMap } from '@/core/events'

import { MemoryAdapter } from './adapter'
import { Vfs, DEFAULT_DIRECTORIES } from './vfs'
import { VfsError } from './types'

function createVfsUnderTest() {
  const adapter = new MemoryAdapter()
  const bus = new EventBus<SystemEventMap>()
  const created = vi.fn()
  const updated = vi.fn()
  const deleted = vi.fn()
  bus.on('file.created', created)
  bus.on('file.updated', updated)
  bus.on('file.deleted', deleted)

  let counter = 0
  const vfs = new Vfs({
    adapter,
    bus,
    generateId: () => `id-${++counter}`,
  })
  return { vfs, adapter, created, updated, deleted }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Vfs bootstrap', () => {
  it('seeds the PRD §11.1 directory tree on first run', async () => {
    const { vfs } = createVfsUnderTest()

    const root = await vfs.list('/')
    expect(root.map((node) => node.name)).toEqual([
      'Desktop',
      'Documents',
      'Downloads',
      'Pictures',
      'Videos',
      'Music',
      'Apps',
      'Trash',
      'System',
    ])
    expect(root.every((node) => node.type === 'directory')).toBe(true)
  })

  it('keeps existing content on subsequent boots', async () => {
    const adapter = new MemoryAdapter()
    const first = new Vfs({ adapter })
    await first.ready()
    await first.writeFile('/Documents/a.txt', 'hello')

    const second = new Vfs({ adapter })
    await second.ready()

    expect(await second.readFile('/Documents/a.txt')).toBe('hello')
    const rootNames = (await second.list('/')).map((node) => node.name)
    expect(rootNames).toEqual(DEFAULT_DIRECTORIES)
  })
})

describe('Vfs.createDirectory', () => {
  it('creates nested directories and emits file.created', async () => {
    const { vfs, created } = createVfsUnderTest()

    await vfs.createDirectory('/Documents/projects')
    const node = await vfs.get('/Documents/projects')

    expect(node?.type).toBe('directory')
    expect(created).toHaveBeenCalledWith({ fileId: node?.id, path: '/Documents/projects' })
  })

  it('rejects duplicates, missing parents and files as parents', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.createDirectory('/Documents/dup')
    await expect(vfs.createDirectory('/Documents/dup')).rejects.toMatchObject({
      code: 'already-exists',
    })
    await expect(vfs.createDirectory('/Missing/dir')).rejects.toMatchObject({
      code: 'not-found',
    })
    await vfs.writeFile('/Documents/file.txt', '')
    await expect(vfs.createDirectory('/Documents/file.txt/inner')).rejects.toMatchObject({
      code: 'not-a-directory',
    })
  })

  it('rejects invalid names and missing intermediate directories', async () => {
    const { vfs } = createVfsUnderTest()

    await expect(vfs.createDirectory('/Documents/..')).rejects.toMatchObject({
      code: 'invalid-name',
    })
    await expect(vfs.createDirectory('/Documents/.')).rejects.toMatchObject({
      code: 'invalid-name',
    })
    await expect(vfs.createDirectory('/Documents/bad/name')).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})

describe('Vfs.writeFile / readFile', () => {
  it('creates a file with UTF-8 byte size', async () => {
    const { vfs } = createVfsUnderTest()

    const node = await vfs.writeFile('/Documents/你好.txt', 'hello 你好')

    expect(node.type).toBe('file')
    expect(node.size).toBe(new TextEncoder().encode('hello 你好').length)
    expect(await vfs.readFile('/Documents/你好.txt')).toBe('hello 你好')
  })

  it('updates an existing file and emits created then updated', async () => {
    const { vfs, created, updated } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'v1')
    const node = await vfs.writeFile('/Documents/a.txt', 'v2')

    expect(node.content).toBe('v2')
    expect(created).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledWith({
      fileId: node.id,
      path: '/Documents/a.txt',
    })
    expect(await vfs.readFile('/Documents/a.txt')).toBe('v2')
  })

  it('refuses to read or overwrite directories', async () => {
    const { vfs } = createVfsUnderTest()

    await expect(vfs.readFile('/Documents')).rejects.toMatchObject({ code: 'is-a-directory' })
    await expect(vfs.writeFile('/Documents', 'x')).rejects.toMatchObject({
      code: 'is-a-directory',
    })
  })

  it('throws not-found for missing files', async () => {
    const { vfs } = createVfsUnderTest()

    await expect(vfs.readFile('/Documents/ghost.txt')).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})

describe('Vfs.rename', () => {
  it('renames within the same parent', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/old.txt', 'x')
    const node = await vfs.rename('/Documents/old.txt', 'new.txt')

    expect(node.name).toBe('new.txt')
    expect(await vfs.get('/Documents/new.txt')).not.toBeNull()
    expect(await vfs.get('/Documents/old.txt')).toBeNull()
  })

  it('rejects renames onto existing siblings', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'a')
    await vfs.writeFile('/Documents/b.txt', 'b')

    await expect(vfs.rename('/Documents/a.txt', 'b.txt')).rejects.toMatchObject({
      code: 'already-exists',
    })
  })
})

describe('Vfs.move', () => {
  it('moves a file into another directory', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'x')
    await vfs.move('/Documents/a.txt', '/Desktop')

    expect(await vfs.get('/Desktop/a.txt')).not.toBeNull()
    expect(await vfs.get('/Documents/a.txt')).toBeNull()
  })

  it('refuses to move a directory into its own subtree', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.createDirectory('/Documents/parent')
    await vfs.createDirectory('/Documents/parent/child')

    await expect(vfs.move('/Documents/parent', '/Documents/parent/child')).rejects.toMatchObject({
      code: 'cycle',
    })
  })

  it('refuses to overwrite an existing name in the destination', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'a')
    await vfs.writeFile('/Desktop/a.txt', 'b')

    await expect(vfs.move('/Documents/a.txt', '/Desktop')).rejects.toMatchObject({
      code: 'already-exists',
    })
  })
})

describe('Vfs.copy', () => {
  it('copies a file so both copies stay independent', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/orig.txt', 'content')
    await vfs.copy('/Documents/orig.txt', '/Desktop')

    await vfs.writeFile('/Documents/orig.txt', 'changed')

    expect(await vfs.readFile('/Desktop/orig.txt')).toBe('content')
    expect(await vfs.readFile('/Documents/orig.txt')).toBe('changed')
  })

  it('deep-copies a directory subtree', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.createDirectory('/Documents/project')
    await vfs.writeFile('/Documents/project/main.txt', 'code')
    await vfs.createDirectory('/Documents/project/src')

    await vfs.copy('/Documents/project', '/Desktop')

    expect(await vfs.readFile('/Desktop/project/main.txt')).toBe('code')
    const copiedDir = await vfs.get('/Desktop/project/src')
    expect(copiedDir?.type).toBe('directory')
  })
})

describe('Vfs trash', () => {
  it('remove() hides a node, emits file.deleted and lists it in the trash', async () => {
    const { vfs, deleted } = createVfsUnderTest()

    await vfs.writeFile('/Documents/bye.txt', 'x')
    const node = await vfs.remove('/Documents/bye.txt')

    expect(node.trashed).toBe(true)
    expect(await vfs.get('/Documents/bye.txt')).toBeNull()
    await expect(vfs.readFile('/Documents/bye.txt')).rejects.toThrow(VfsError)
    const trash = await vfs.listTrash()
    expect(trash.map((entry) => entry.id)).toContain(node.id)
    expect(deleted).toHaveBeenCalledWith({ fileId: node.id, path: '/Documents/bye.txt' })
  })

  it('restore() puts a node back unless the name was taken', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'x')
    const node = await vfs.remove('/Documents/a.txt')

    const restored = await vfs.restore(node.id)
    expect(restored.trashed).toBe(false)
    expect(await vfs.get('/Documents/a.txt')).not.toBeNull()

    const node2 = await vfs.remove('/Documents/a.txt')
    await vfs.writeFile('/Documents/a.txt', 'replacement')
    await expect(vfs.restore(node2.id)).rejects.toMatchObject({ code: 'already-exists' })
  })

  it('purge() and emptyTrash() permanently delete trashed nodes', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/a.txt', 'a')
    await vfs.writeFile('/Documents/b.txt', 'b')
    const nodeA = await vfs.remove('/Documents/a.txt')
    await vfs.remove('/Documents/b.txt')

    await vfs.purge(nodeA.id)
    expect((await vfs.listTrash()).map((entry) => entry.name)).toEqual(['b.txt'])

    await vfs.emptyTrash()
    expect(await vfs.listTrash()).toEqual([])
    await expect(vfs.restore(nodeA.id)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('protects the root directories from removal', async () => {
    const { vfs } = createVfsUnderTest()

    await expect(vfs.remove('/')).rejects.toMatchObject({ code: 'root-protected' })
    await expect(vfs.remove('/Documents')).rejects.toMatchObject({ code: 'root-protected' })
  })

  it('hides trashed nodes from directory listings and search', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/hidden.txt', 'x')
    await vfs.remove('/Documents/hidden.txt')

    expect((await vfs.list('/Documents')).map((node) => node.name)).not.toContain('hidden.txt')
    expect(await vfs.search('/', 'hidden')).toEqual([])
  })
})

describe('Vfs.search', () => {
  it('finds nodes by case-insensitive substring under a root', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.writeFile('/Documents/Report-Q3.txt', 'x')
    await vfs.writeFile('/Desktop/report-notes.txt', 'x')
    await vfs.writeFile('/Music/song.mp3', 'x')

    const hits = await vfs.search('/', 'report')
    expect(hits.map((hit) => hit.path).sort()).toEqual([
      '/Desktop/report-notes.txt',
      '/Documents/Report-Q3.txt',
    ])
    expect(await vfs.search('/Music', 'report')).toEqual([])
  })
})

describe('Vfs.pathOfId', () => {
  it('rebuilds absolute paths', async () => {
    const { vfs } = createVfsUnderTest()

    await vfs.createDirectory('/Documents/deep')
    const node = await vfs.get('/Documents/deep')

    expect(vfs.pathOfId(node!.id)).toBe('/Documents/deep')
    expect(vfs.pathOfId('root')).toBe('/')
    expect(vfs.pathOfId('missing')).toBeNull()
  })
})

describe('Vfs persistence', () => {
  it('persists every mutation through the adapter', async () => {
    const adapter = new MemoryAdapter()
    const vfs = new Vfs({ adapter })
    await vfs.ready()
    await vfs.writeFile('/Documents/a.txt', 'persisted')

    const raw = await adapter.load()
    const saved = raw.find((node) => node.name === 'a.txt')

    expect(saved?.content).toBe('persisted')
    // root + 9 default directories + the new file
    expect(raw.length).toBe(11)
  })
})
