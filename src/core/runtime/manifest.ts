import { isKnownPermission } from '@/core/permissions'
import type { Permission } from '@/core/permissions'

export interface WindowManifestConfig {
  width?: number
  height?: number
  resizable?: boolean
}

export interface AppManifest {
  id: string
  name: string
  version: string
  entry: string
  icon?: string
  /** Normalized to an empty array when the manifest declares none. */
  permissions: Permission[]
  window?: WindowManifestConfig
  author?: string
  description?: string
}

export interface ManifestIssue {
  path: string
  message: string
}

export type ManifestParseResult =
  { ok: true; manifest: AppManifest } | { ok: false; errors: ManifestIssue[] }

const APP_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/

const KNOWN_KEYS = new Set([
  'id',
  'name',
  'version',
  'entry',
  'icon',
  'permissions',
  'window',
  'author',
  'description',
])

const WINDOW_KEYS = new Set(['width', 'height', 'resizable'])

/**
 * Validates an untrusted manifest (PRD §9). Collects every issue instead of
 * failing fast, so developers see the full list of problems at once.
 */
export function parseManifest(input: unknown): ManifestParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'Manifest must be a JSON object' }],
    }
  }

  const raw = input as Record<string, unknown>
  const errors: ManifestIssue[] = []

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push({ path: key, message: `Unknown manifest field "${key}"` })
    }
  }

  const id = readString(raw, 'id', errors, { required: true })
  if (id.ok && !APP_ID_PATTERN.test(id.value)) {
    errors.push({
      path: 'id',
      message: 'App id must be reverse-domain namespaced, e.g. "com.ageha.notes"',
    })
  }

  const name = readString(raw, 'name', errors, { required: true })
  if (name.ok && name.value.trim() === '') {
    errors.push({ path: 'name', message: 'App name must not be empty' })
  }

  const version = readString(raw, 'version', errors, { required: true })
  if (version.ok && !VERSION_PATTERN.test(version.value)) {
    errors.push({
      path: 'version',
      message: 'Version must be semver-like "MAJOR.MINOR.PATCH"',
    })
  }

  const entry = readString(raw, 'entry', errors, { required: true })
  if (entry.ok && !entry.value.startsWith('/')) {
    errors.push({ path: 'entry', message: 'Entry must be an absolute path starting with "/"' })
  }

  const icon = readString(raw, 'icon', errors, {})

  const permissions = readPermissions(raw, errors)

  const window = readWindowConfig(raw, errors)

  const author = readString(raw, 'author', errors, {})
  const description = readString(raw, 'description', errors, {})

  if (errors.length > 0 || !id.ok || !name.ok || !version.ok || !entry.ok) {
    return { ok: false, errors }
  }

  const manifest: AppManifest = {
    id: id.value,
    name: name.value,
    version: version.value,
    entry: entry.value,
    permissions,
  }
  if (icon.ok && icon.value !== '') manifest.icon = icon.value
  if (window) manifest.window = window
  if (author.ok && author.value !== '') manifest.author = author.value
  if (description.ok && description.value !== '') {
    manifest.description = description.value
  }

  return { ok: true, manifest: deepFreeze(manifest) }
}

function readString(
  raw: Record<string, unknown>,
  key: string,
  errors: ManifestIssue[],
  options: { required?: boolean },
): { ok: true; value: string } | { ok: false } {
  const value = raw[key]
  if (value === undefined) {
    if (options.required) {
      errors.push({ path: key, message: `Field "${key}" is required` })
    }
    return { ok: false }
  }
  if (typeof value !== 'string') {
    errors.push({ path: key, message: `Field "${key}" must be a string` })
    return { ok: false }
  }
  return { ok: true, value }
}

function readPermissions(raw: Record<string, unknown>, errors: ManifestIssue[]): Permission[] {
  const value = raw.permissions
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push({ path: 'permissions', message: 'Field "permissions" must be an array' })
    return []
  }
  const unique: Permission[] = []
  value.forEach((permission, index) => {
    if (typeof permission !== 'string' || !isKnownPermission(permission)) {
      errors.push({
        path: `permissions[${index}]`,
        message: `Unknown permission "${String(permission)}"`,
      })
      return
    }
    if (!unique.includes(permission)) unique.push(permission)
  })
  return unique
}

function readWindowConfig(
  raw: Record<string, unknown>,
  errors: ManifestIssue[],
): WindowManifestConfig | undefined {
  const value = raw.window
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ path: 'window', message: 'Field "window" must be an object' })
    return undefined
  }

  const rawWindow = value as Record<string, unknown>
  for (const key of Object.keys(rawWindow)) {
    if (!WINDOW_KEYS.has(key)) {
      errors.push({ path: `window.${key}`, message: `Unknown window field "${key}"` })
    }
  }

  const config: WindowManifestConfig = {}
  for (const key of ['width', 'height'] as const) {
    const size = rawWindow[key]
    if (size === undefined) continue
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      errors.push({
        path: `window.${key}`,
        message: `window.${key} must be a positive integer`,
      })
      continue
    }
    config[key] = size
  }
  if (rawWindow.resizable !== undefined) {
    if (typeof rawWindow.resizable !== 'boolean') {
      errors.push({
        path: 'window.resizable',
        message: 'window.resizable must be a boolean',
      })
    } else {
      config.resizable = rawWindow.resizable
    }
  }
  return config
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
