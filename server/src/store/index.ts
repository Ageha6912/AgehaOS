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
      // 显式选 postgres 却没有 DATABASE_URL 时拒绝启动（A2 审查轻微项）：
      // 否则 libpq 静默回退 PGHOST/PGUSER/localhost，可能连错库建表。
      if (options.databaseUrl === null || options.databaseUrl === undefined) {
        throw new Error('DATABASE_URL is required for the postgres store')
      }
      return new PostgresDataStore(new Pool({ connectionString: options.databaseUrl }))
  }
}

export { FileDataStore, MemoryDataStore, PostgresDataStore }
export type { DataStore, SessionRecord, UserRecord } from './types'
export { UsernameTakenError } from './types'
export type { PgPoolLike } from './postgres-store'
