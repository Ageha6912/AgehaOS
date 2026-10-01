import { useState } from 'react'

import type { AppHostProps } from '@/apps/placeholder-app'
import { consumeFilesTrash } from '@/apps/app-deep-link'
import { systemVfs } from '@/services/vfs'

import { FileManager } from './FileManager'

/** Real Files system app (PRD §26) bound to the process-wide VFS. */
export function FileManagerApp({ windowId }: AppHostProps) {
  // §32 深链：Dock「回收站」请求本次启动直接进入回收站视图（取走即清）。
  const [initialTrash] = useState(() => consumeFilesTrash())
  return <FileManager vfs={systemVfs} windowId={windowId} initialTrash={initialTrash} />
}
