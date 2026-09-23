import { Pool } from 'pg'

import { FileDataStore } from './file-store'
import { MemoryDataStore } from './memory-store'
import { PostgresDataStore } from './postgres-store'
import type { StoreKind } from '../config'
import type { DataStore } from './types'

export interface CreateStoreOptions {
  store: StoreKind
  dataDir: string
  databaseUrl: string | null
}

export function createStore(options: CreateStoreOptions): DataStore {
  switch (options.store) {
    case 'memory':
      return new MemoryDataStore()
    case 'file':
      return new FileDataStore(`${options.dataDir}/agehaos-auth.json`)
    case 'postgres':
      return new PostgresDataStore(
        new Pool({ connectionString: options.databaseUrl ?? undefined }),
      )
  }
}

export { FileDataStore, MemoryDataStore, PostgresDataStore }
export type { DataStore, SessionRecord, UserRecord } from './types'
export { UsernameTakenError } from './types'
export type { PgPoolLike } from './postgres-store'
