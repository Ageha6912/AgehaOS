import type { VfsNode } from './types'
import type { VfsStorageAdapter } from './adapter'

const DB_NAME = 'agehaos-vfs'
const DB_VERSION = 1
const STORE_NAME = 'nodes'

export function hasIndexedDb(factory: unknown = globalThis.indexedDB): boolean {
  return typeof factory !== 'undefined' && factory !== null
}

/**
 * IndexedDB adapter (PRD §11.3): the default local store for VFS metadata
 * and text content. Full-state save for v0.1; per-node writes arrive with
 * cloud sync (PRD §43).
 */
export class IdbAdapter implements VfsStorageAdapter {
  private readonly db: Promise<IDBDatabase>

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    if (!hasIndexedDb(factory)) {
      throw new Error('IndexedDB is not available in this environment')
    }
    this.db = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    })
  }

  async load(): Promise<VfsNode[]> {
    const database = await this.db
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as VfsNode[])
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
    })
  }

  async save(nodes: readonly VfsNode[]): Promise<void> {
    const database = await this.db
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      store.clear()
      for (const node of nodes) store.put({ ...node })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'))
    })
  }
}
