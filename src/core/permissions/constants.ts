/** MVP permission set (PRD §10.1). The enforcement engine (PRD §10) lands in a later step. */
export const MVP_PERMISSIONS = [
  'filesystem.read',
  'filesystem.write',
  'storage',
  'notification',
  'clipboard',
  'window',
  'network',
] as const

export type Permission = (typeof MVP_PERMISSIONS)[number]

export function isKnownPermission(value: string): value is Permission {
  return (MVP_PERMISSIONS as readonly string[]).includes(value)
}
