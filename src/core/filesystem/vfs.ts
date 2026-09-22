import { systemBus } from '@/core/events'
import type { EventBus, SystemEventMap } from '@/core/events'

import { MemoryAdapter } from './adapter'
import type { VfsStorageAdapter } from './adapter'
import { dirname, joinPath, splitPath, validateName } from './paths'
import { ROOT_ID, VfsError } from './types'
import type { VfsNode, VfsSearchResult } from './types'

export const DEFAULT_DIRECTORIES = [
  'Desktop',
  'Documents',
  'Downloads',
  'Pictures',
  'Videos',
  'Music',
  'Apps',
  'Trash',
  'System',
] as const

export interface VfsOptions {
  adapter: VfsStorageAdapter
  bus?: Pick<EventBus<SystemEventMap>, 'emit'>
  generateId?: () => string
}

/**
 * Local-first virtual file system (PRD §11). All operations take paths,
 * mutate an in-memory tree, persist through the storage adapter, and
 * broadcast `file.created / updated / deleted` on the system bus.
 *
 * Deleting moves nodes to the trash (§11.2 删除/恢复); trashed nodes are
 * invisible to path resolution until restored, and purging is final.
 */
export class Vfs {
  private nodes = new Map<string, VfsNode>()
  private readonly boot: Promise<void>

  constructor(private options: VfsOptions) {
    this.boot = this.bootstrap()
  }

  /** Resolves once the tree is loaded (and seeded on first run). */
  ready(): Promise<void> {
    return this.boot
  }

  list(path: string): Promise<VfsNode[]> {
    return this.operate(async () => {
      const parent = this.requireDirectory(path)
      return this.childrenOf(parent.id)
        .filter((child) => !child.trashed)
        .map(cloneNode)
    })
  }

  listTrash(): Promise<VfsNode[]> {
    return this.operate(async () =>
      [...this.nodes.values()].filter((node) => node.trashed).map(cloneNode),
    )
  }

  get(path: string): Promise<VfsNode | null> {
    return this.operate(async () => {
      const node = this.resolveNode(path)
      return node ? cloneNode(node) : null
    })
  }

  createDirectory(path: string): Promise<VfsNode> {
    return this.operate(async () => {
      const name = this.leafName(path)
      validateName(name)
      const parentPath = dirname(path)
      const parent = this.requireDirectory(parentPath)
      this.requireFreeName(parent.id, name)

      const node = this.createNode({
        parentId: parent.id,
        name,
        type: 'directory',
        content: '',
      })
      await this.persist()
      this.emitFileEvent('file.created', node, joinPath(parentPath, name))
      return cloneNode(node)
    })
  }

  writeFile(path: string, content: string): Promise<VfsNode> {
    return this.operate(async () => {
      const name = this.leafName(path)
      validateName(name)
      const parentPath = dirname(path)
      const parent = this.requireDirectory(parentPath)

      const existing = this.childByName(parent.id, name)
      if (existing && !existing.trashed) {
        if (existing.type === 'directory') {
          throw new VfsError('is-a-directory', `Cannot write a file over the directory "${path}"`)
        }
        existing.content = content
        existing.size = byteSize(content)
        existing.updatedAt = now()
        await this.persist()
        this.emitFileEvent('file.updated', existing, path)
        return cloneNode(existing)
      }

      const node = this.createNode({
        parentId: parent.id,
        name,
        type: 'file',
        content,
      })
      await this.persist()
      this.emitFileEvent('file.created', node, path)
      return cloneNode(node)
    })
  }

  readFile(path: string): Promise<string> {
    return this.operate(async () => {
      const node = this.resolveNode(path)
      if (!node) throw new VfsError('not-found', `No such file: "${path}"`)
      if (node.type === 'directory') {
        throw new VfsError('is-a-directory', `"${path}" is a directory`)
      }
      return node.content
    })
  }

  rename(path: string, newName: string): Promise<VfsNode> {
    return this.operate(async () => {
      validateName(newName)
      const node = this.resolveNode(path)
      this.requireExisting(node, path)
      this.requireNotRoot(node!)
      if (node!.parentId === null) {
        throw new VfsError('root-protected', 'Root directories cannot be renamed')
      }
      this.requireFreeName(node!.parentId, newName, node!.id)

      node!.name = newName
      node!.updatedAt = now()
      await this.persist()
      this.emitFileEvent('file.updated', node!, this.pathOfId(node!.id) ?? path)
      return cloneNode(node!)
    })
  }

  move(path: string, destDirPath: string): Promise<VfsNode> {
    return this.operate(async () => {
      const node = this.resolveNode(path)
      this.requireExisting(node, path)
      this.requireNotRoot(node!)
      const dest = this.requireDirectory(destDirPath)

      if (this.isDescendant(dest.id, node!.id) || dest.id === node!.id) {
        throw new VfsError('cycle', `Cannot move "${path}" into itself or its own subtree`)
      }
      this.requireFreeName(dest.id, node!.name, node!.id)

      node!.parentId = dest.id
      node!.updatedAt = now()
      await this.persist()
      this.emitFileEvent('file.updated', node!, this.pathOfId(node!.id) ?? path)
      return cloneNode(node!)
    })
  }

  copy(path: string, destDirPath: string): Promise<VfsNode> {
    return this.operate(async () => {
      const source = this.resolveNode(path)
      this.requireExisting(source, path)
      this.requireNotRoot(source!)
      const dest = this.requireDirectory(destDirPath)
      this.requireFreeName(dest.id, source!.name)

      const copied = this.copySubtree(source!, dest.id)
      await this.persist()
      this.emitFileEvent('file.created', copied, this.pathOfId(copied.id) ?? path)
      return cloneNode(copied)
    })
  }

  /** Moves a node to the trash; the path stays reserved for restore(). */
  remove(path: string): Promise<VfsNode> {
    return this.operate(async () => {
      const node = this.resolveNode(path)
      this.requireExisting(node, path)
      this.requireNotRoot(node!)
      node!.trashed = true
      node!.updatedAt = now()
      await this.persist()
      this.emitFileEvent('file.deleted', node!, path)
      return cloneNode(node!)
    })
  }

  restore(nodeId: string): Promise<VfsNode> {
    return this.operate(async () => {
      const node = this.nodes.get(nodeId)
      this.requireExisting(node, `node ${nodeId}`)
      if (!node!.trashed) return cloneNode(node!)
      if (node!.parentId !== null) {
        const parent = this.nodes.get(node!.parentId)
        if (parent && !parent.trashed) {
          this.requireFreeName(parent.id, node!.name, node!.id)
        }
      }
      node!.trashed = false
      node!.updatedAt = now()
      await this.persist()
      this.emitFileEvent('file.updated', node!, this.pathOfId(node!.id) ?? node!.name)
      return cloneNode(node!)
    })
  }

  /** Permanently deletes a trashed node and everything inside it. */
  purge(nodeId: string): Promise<void> {
    return this.operate(async () => {
      const node = this.nodes.get(nodeId)
      if (!node || !node.trashed) {
        throw new VfsError('not-found', `No trashed node ${nodeId}`)
      }
      this.deleteSubtree(node)
      await this.persist()
    })
  }

  emptyTrash(): Promise<void> {
    return this.operate(async () => {
      const trashed = [...this.nodes.values()].filter((node) => node.trashed)
      for (const node of trashed) this.deleteSubtree(node)
      await this.persist()
    })
  }

  private deleteSubtree(node: VfsNode): void {
    const path = this.pathOfId(node.id) ?? node.name
    for (const id of this.collectSubtreeIds(node.id)) this.nodes.delete(id)
    // Broadcast so open views drop the purged entry immediately.
    this.emitFileEvent('file.deleted', node, path)
  }

  search(rootPath: string, query: string): Promise<VfsSearchResult[]> {
    return this.operate(async () => {
      const root = this.requireDirectory(rootPath)
      const needle = query.trim().toLowerCase()
      if (needle === '') return []
      const results: VfsSearchResult[] = []
      for (const id of this.collectSubtreeIds(root.id)) {
        const node = this.nodes.get(id)
        if (!node || node.trashed) continue
        if (node.id === root.id) continue
        if (node.name.toLowerCase().includes(needle)) {
          results.push({ node: cloneNode(node), path: this.pathOfId(node.id) ?? '' })
        }
      }
      return results
    })
  }

  /** Rebuilds the absolute path of a node ('/' for the root). */
  pathOfId(nodeId: string): string | null {
    const node = this.nodes.get(nodeId)
    if (!node) return null
    if (node.parentId === null) return '/'
    const segments: string[] = []
    let cursor: VfsNode | undefined = node
    while (cursor && cursor.parentId !== null) {
      segments.unshift(cursor.name)
      cursor = this.nodes.get(cursor.parentId)
    }
    return `/${segments.join('/')}`
  }

  // ---- internals ----------------------------------------------------------

  private async bootstrap(): Promise<void> {
    const loaded = await this.options.adapter.load()
    if (loaded.length === 0) {
      const root = this.createNode({
        parentId: null,
        name: '',
        type: 'directory',
        content: '',
      })
      root.id = ROOT_ID
      this.nodes.set(ROOT_ID, root)
      for (const name of DEFAULT_DIRECTORIES) {
        this.createNode({ parentId: ROOT_ID, name, type: 'directory', content: '' })
      }
      await this.persist()
      return
    }
    for (const node of loaded) this.nodes.set(node.id, node)
  }

  /** Serializes every public operation behind the boot promise. */
  private async operate<T>(operation: () => Promise<T>): Promise<T> {
    await this.boot
    return operation()
  }

  private createNode(input: {
    parentId: string | null
    name: string
    type: 'directory' | 'file'
    content: string
  }): VfsNode {
    const id = this.newId()
    const timestamp = now()
    const node: VfsNode = {
      id,
      parentId: input.parentId,
      name: input.name,
      type: input.type,
      content: input.type === 'file' ? input.content : '',
      size: input.type === 'file' ? byteSize(input.content) : 0,
      trashed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.nodes.set(node.id, node)
    return node
  }

  private newId(): string {
    return this.options.generateId ? this.options.generateId() : crypto.randomUUID()
  }

  private async persist(): Promise<void> {
    await this.options.adapter.save([...this.nodes.values()])
  }

  private emitFileEvent(
    event: 'file.created' | 'file.updated' | 'file.deleted',
    node: VfsNode,
    path: string,
  ): void {
    const bus = this.options.bus ?? systemBus
    bus.emit(event, { fileId: node.id, path })
  }

  private resolveNode(path: string, includeTrashed = false): VfsNode | null {
    const segments = splitPath(path)
    let current = this.nodes.get(ROOT_ID)
    if (!current) throw new VfsError('not-found', 'File system is not initialized')
    for (const segment of segments) {
      if (current.type !== 'directory') return null
      const child = this.childByName(current.id, segment)
      if (!child || (child.trashed && !includeTrashed)) return null
      current = child
    }
    return current ?? null
  }

  private childrenOf(parentId: string): VfsNode[] {
    const children: VfsNode[] = []
    for (const node of this.nodes.values()) {
      if (node.parentId === parentId) children.push(node)
    }
    return children
  }

  private childByName(parentId: string, name: string): VfsNode | undefined {
    return this.childrenOf(parentId).find((node) => node.name === name)
  }

  private requireDirectory(path: string): VfsNode {
    const node = this.resolveNode(path)
    this.requireExisting(node, path)
    if (node!.type !== 'directory') {
      throw new VfsError('not-a-directory', `"${path}" is not a directory`)
    }
    return node!
  }

  private requireExisting(node: VfsNode | null | undefined, path: string): void {
    if (!node) throw new VfsError('not-found', `No such file or directory: "${path}"`)
  }

  private requireNotRoot(node: VfsNode): void {
    // Root itself and every top-level entry (the system directories, PRD
    // §11.1) are protected in v0.1.
    if (node.parentId === null || node.parentId === ROOT_ID) {
      throw new VfsError('root-protected', `"${node.name || '/'}" is protected`)
    }
  }

  private requireFreeName(parentId: string, name: string, exceptId?: string): void {
    const clash = this.childrenOf(parentId).some(
      (node) => node.name === name && !node.trashed && node.id !== exceptId,
    )
    if (clash) {
      throw new VfsError('already-exists', `"${name}" already exists in this directory`)
    }
  }

  private leafName(path: string): string {
    const segments = splitPath(path)
    if (segments.length === 0) {
      throw new VfsError('root-protected', 'The root directory cannot be modified')
    }
    return segments[segments.length - 1]!
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    let cursor = this.nodes.get(candidateId)
    while (cursor && cursor.parentId !== null) {
      if (cursor.parentId === ancestorId) return true
      cursor = this.nodes.get(cursor.parentId)
    }
    return false
  }

  private copySubtree(source: VfsNode, destParentId: string): VfsNode {
    const copy = this.createNode({
      parentId: destParentId,
      name: source.name,
      type: source.type,
      content: source.content,
    })
    if (source.type === 'directory') {
      for (const child of this.childrenOf(source.id)) {
        if (child.trashed) continue
        this.copySubtree(child, copy.id)
      }
    }
    return copy
  }

  private collectSubtreeIds(rootId: string): string[] {
    const ids: string[] = []
    const stack = [rootId]
    while (stack.length > 0) {
      const id = stack.pop()!
      ids.push(id)
      for (const child of this.childrenOf(id)) stack.push(child.id)
    }
    return ids
  }
}

function cloneNode(node: VfsNode): VfsNode {
  return { ...node }
}

function now(): string {
  return new Date().toISOString()
}

function byteSize(content: string): number {
  return new TextEncoder().encode(content).length
}

/** Creates the default VFS: IndexedDB when available, memory otherwise (§31). */
export function createVfs(options?: Partial<VfsOptions>): Vfs {
  return new Vfs({
    adapter: options?.adapter ?? new MemoryAdapter(),
    ...options,
  })
}

export { normalizePath, splitPath, joinPath, basename, dirname } from './paths'
export { MemoryAdapter } from './adapter'
export { IdbAdapter, hasIndexedDb } from './idb-adapter'
export { ROOT_ID, VfsError } from './types'
