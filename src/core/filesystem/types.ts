export type FileNodeType = 'directory' | 'file'

/** 二进制文件的硬上限（DDS Phase C L1 产物口径 ≤8MB；全量快照存储下的实际约束）。 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024

export interface VfsNode {
  id: string
  parentId: string | null
  name: string
  type: FileNodeType
  /** Text content; directories always carry an empty string. */
  content: string
  /**
   * Binary payload（Phase 3 VFS 二进制承载）：与 content 互斥——文件要么是文本
   * （content 有义，bytes 缺省），要么是二进制（bytes 有义，content 恒 ''），
   * size 始终为字节长度。目录两者皆空。经 IndexedDB 结构化克隆原生持久化。
   */
  bytes?: Uint8Array
  /** Byte length of the meaningful payload (0 for directories). */
  size: number
  trashed: boolean
  createdAt: string
  updatedAt: string
}

export const ROOT_ID = 'root'

export type VfsErrorCode =
  | 'not-found'
  | 'not-a-directory'
  | 'is-a-directory'
  | 'already-exists'
  | 'invalid-name'
  | 'invalid-path'
  | 'root-protected'
  | 'cycle'
  | 'is-binary'
  | 'payload-too-large'

export class VfsError extends Error {
  constructor(
    public code: VfsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'VfsError'
  }
}

export interface VfsSearchResult {
  node: VfsNode
  path: string
}
