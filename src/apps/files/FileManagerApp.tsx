import type { AppHostProps } from '@/apps/placeholder-app'
import { systemVfs } from '@/services/vfs'

import { FileManager } from './FileManager'

/** Real Files system app (PRD §26) bound to the process-wide VFS. */
export function FileManagerApp({ windowId }: AppHostProps) {
  return <FileManager vfs={systemVfs} windowId={windowId} />
}
