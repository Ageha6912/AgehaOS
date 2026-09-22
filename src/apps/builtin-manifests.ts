/**
 * Built-in system app manifests (PRD §26), kept as plain data so the store
 * can register them at boot. Entries are validated by parseManifest at
 * registration time — this file stays the single source of truth for what
 * ships with v0.1.
 *
 * Permissions follow the canonical §10.1 names.
 */
export const BUILTIN_APP_MANIFESTS: readonly unknown[] = [
  {
    id: 'com.ageha.notes',
    name: 'Notes',
    version: '0.1.0',
    entry: '/apps/notes/index.html',
    permissions: ['storage'],
    window: { width: 720, height: 480 },
  },
  {
    id: 'com.ageha.files',
    name: 'Files',
    version: '0.1.0',
    entry: '/apps/files/index.html',
    permissions: ['filesystem.read', 'filesystem.write', 'storage'],
    window: { width: 880, height: 560 },
  },
  {
    id: 'com.ageha.settings',
    name: 'Settings',
    version: '0.1.0',
    entry: '/apps/settings/index.html',
    permissions: [],
    window: { width: 840, height: 560 },
  },
]
