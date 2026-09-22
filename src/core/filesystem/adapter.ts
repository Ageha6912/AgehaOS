import type { VfsNode } from './types'

export interface VfsStorageAdapter {
  load(): Promise<VfsNode[]>
  save(nodes: readonly VfsNode[]): Promise<void>
}

/** In-memory adapter: unit-test fallback for browsers without IndexedDB. */
export class MemoryAdapter implements VfsStorageAdapter {
  private nodes = new Map<string, VfsNode>()

  async load(): Promise<VfsNode[]> {
    return [...this.nodes.values()]
  }

  async save(nodes: readonly VfsNode[]): Promise<void> {
    this.nodes = new Map(nodes.map((node) => [node.id, { ...node }]))
  }

  get size(): number {
    return this.nodes.size
  }
}
