import { VfsError } from './types'

/** Collapses duplicate slashes and strips trailing ones ('/a/' → '/a').
 *  点段（`.`/`..`）一律拒绝（B1 审查：未来 SDK 路径包含性校验不能被
 *  `/Apps/x/../y` 绕过；当前调用方语义下点段本就无合法路径）。 */
export function normalizePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new VfsError('invalid-path', `Path must be absolute: "${path}"`)
  }
  const collapsed = path.replace(/\/{2,}/g, '/')
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : '/'
  if (trimmed.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new VfsError('invalid-path', `Path must not contain "." or ".." segments: "${path}"`)
  }
  return trimmed
}

/** '/' → []; '/Documents/test.txt' → ['Documents', 'test.txt']. */
export function splitPath(path: string): string[] {
  const normalized = normalizePath(path)
  return normalized === '/' ? [] : normalized.slice(1).split('/')
}

export function joinPath(dirPath: string, name: string): string {
  const base = normalizePath(dirPath)
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export function basename(path: string): string {
  const segments = splitPath(path)
  return segments[segments.length - 1] ?? ''
}

export function dirname(path: string): string {
  const segments = splitPath(path)
  return segments.length <= 1 ? '/' : `/${segments.slice(0, -1).join('/')}`
}

/** Validates one path segment (a file or directory name). */
export function validateName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 255) {
    throw new VfsError('invalid-name', 'Name must be 1–255 characters')
  }
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new VfsError('invalid-name', `Name must not contain "/" or "\\" or be "." / "..": "${name}"`)
  }
  if (name !== name.trim()) {
    throw new VfsError('invalid-name', `Name must not start or end with whitespace: "${name}"`)
  }
}
