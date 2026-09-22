export type FileNodeType = 'directory' | 'file'

export interface VfsNode {
  id: string
  parentId: string | null
  name: string
  type: FileNodeType
  /** Text content; directories always carry an empty string. */
  content: string
  /** UTF-8 byte length of the content (0 for directories). */
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
