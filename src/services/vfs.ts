import { createVfs, IdbAdapter, hasIndexedDb, MemoryAdapter } from '@/core/filesystem'
import type { Vfs } from '@/core/filesystem'

/**
 * Boot-time VFS singleton (PRD §11.3): IndexedDB when the browser provides
 * it, memory fallback otherwise (capability detection, PRD §31). The File
 * Manager app and the future SDK consume this instance.
 */
export const systemVfs: Vfs = createVfs({
  adapter: hasIndexedDb() ? new IdbAdapter() : new MemoryAdapter(),
})
