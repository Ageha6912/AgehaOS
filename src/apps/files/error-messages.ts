import { VfsError } from '@/core/filesystem'
import type { MessageKey } from '@/core/i18n'

/** Maps a VfsError code to a user-safe message key (PRD §39). */
export function vfsErrorMessageKey(error: unknown): MessageKey {
  if (error instanceof VfsError) {
    switch (error.code) {
      case 'not-found':
        return 'files.error.notFound'
      case 'already-exists':
        return 'files.error.alreadyExists'
      case 'invalid-name':
        return 'files.error.invalidName'
      case 'root-protected':
        return 'files.error.rootProtected'
      case 'cycle':
        return 'files.error.cycle'
      default:
        return 'files.error.generic'
    }
  }
  return 'files.error.generic'
}
