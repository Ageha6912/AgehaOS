import type { MessageKey } from '@/core/i18n'
import type { Permission } from './constants'

/** Localized display names for each permission (PRD §41). */
export const PERMISSION_LABEL_KEYS: Record<Permission, MessageKey> = {
  'filesystem.read': 'permission.filesystem.read',
  'filesystem.write': 'permission.filesystem.write',
  storage: 'permission.storage',
  notification: 'permission.notification',
  clipboard: 'permission.clipboard',
  window: 'permission.window',
  network: 'permission.network',
}
