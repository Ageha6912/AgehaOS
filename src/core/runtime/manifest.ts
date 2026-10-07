import { isKnownPermission } from '@/core/permissions'
import type { Permission } from '@/core/permissions'

export interface WindowManifestConfig {
  width?: number
  height?: number
  resizable?: boolean
}

/** Mobile Shell（M0-3）下该应用的呈现方向。 */
export type MobileOrientation = 'portrait' | 'landscape' | 'any'

/** Mobile Shell 下该应用的呈现形态；目前唯一合法值是全屏。 */
export type MobilePresentation = 'fullscreen'

export interface MobileManifestConfig {
  supported: boolean
  orientation: MobileOrientation
  presentation: MobilePresentation
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
  /** Optional mobile presentation block (M0-3). Absent = the manifest says
   *  nothing about mobile; the shell then applies its own default policy. */
  mobile?: MobileManifestConfig
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
  'mobile',
  'author',
  'description',
])

const WINDOW_KEYS = new Set(['width', 'height', 'resizable'])

const MOBILE_KEYS = new Set(['supported', 'orientation', 'presentation'])

const MOBILE_ORIENTATIONS = new Set<string>(['portrait', 'landscape', 'any'])

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

  const mobile = readMobileConfig(raw, errors)

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
  if (mobile) manifest.mobile = mobile
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

/**
 * Optional mobile block (M0-3). Absent = ignore (the parsed manifest simply
 * carries no mobile policy). Present = all three fields are required and
 * strictly typed (the declared `MobileManifestConfig` has no optional
 * members, so a partial block would be a lie about the type and is
 * rejected); unknown subfields are reported like everywhere else.
 */
function readMobileConfig(
  raw: Record<string, unknown>,
  errors: ManifestIssue[],
): MobileManifestConfig | undefined {
  const value = raw.mobile
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ path: 'mobile', message: 'Field "mobile" must be an object' })
    return undefined
  }

  const rawMobile = value as Record<string, unknown>
  for (const key of Object.keys(rawMobile)) {
    if (!MOBILE_KEYS.has(key)) {
      errors.push({ path: `mobile.${key}`, message: `Unknown mobile field "${key}"` })
    }
  }

  let valid = true
  const config: Partial<MobileManifestConfig> = {}

  const supported = rawMobile.supported
  if (supported === undefined) {
    errors.push({ path: 'mobile.supported', message: 'Field "mobile.supported" is required' })
    valid = false
  } else if (typeof supported !== 'boolean') {
    errors.push({ path: 'mobile.supported', message: 'mobile.supported must be a boolean' })
    valid = false
  } else {
    config.supported = supported
  }

  const orientation = rawMobile.orientation
  if (orientation === undefined) {
    errors.push({ path: 'mobile.orientation', message: 'Field "mobile.orientation" is required' })
    valid = false
  } else if (typeof orientation !== 'string' || !MOBILE_ORIENTATIONS.has(orientation)) {
    errors.push({
      path: 'mobile.orientation',
      message: 'mobile.orientation must be one of "portrait", "landscape", "any"',
    })
    valid = false
  } else {
    config.orientation = orientation as MobileOrientation
  }

  const presentation = rawMobile.presentation
  if (presentation === undefined) {
    errors.push({ path: 'mobile.presentation', message: 'Field "mobile.presentation" is required' })
    valid = false
  } else if (presentation !== 'fullscreen') {
    errors.push({ path: 'mobile.presentation', message: 'mobile.presentation must be "fullscreen"' })
    valid = false
  } else {
    config.presentation = presentation
  }

  return valid ? (config as MobileManifestConfig) : undefined
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
