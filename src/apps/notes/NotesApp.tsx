import { useCallback, useEffect, useState } from 'react'

import { PromptDialog } from '@/components/prompt-dialog'
import { systemBus } from '@/core/events'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { joinPath, Vfs } from '@/core/filesystem'
import type { VfsNode } from '@/core/filesystem'
import { vfsErrorMessageKey } from '@/apps/files/error-messages'
import { systemVfs } from '@/services/vfs'

const NOTES_DIR = '/Documents'

export interface NotesAppProps {
  windowId: string
  vfs?: Vfs
}

/**
 * Notes system app (PRD §26): a simple text editor over the VFS. Notes live
 * as text files inside /Documents.
 */
export function NotesApp({ vfs = systemVfs }: NotesAppProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<VfsNode[] | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<MessageKey | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)

  const refresh = useCallback(async () => {
    try {
      const nodes = await vfs.list(NOTES_DIR)
      setFiles(nodes.filter((node) => node.type === 'file'))
      setError(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
      setFiles((current) => current ?? [])
    }
  }, [vfs])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    const offs = (['file.created', 'file.updated', 'file.deleted'] as const).map((name) =>
      systemBus.on(name, () => void refresh()),
    )
    return () => offs.forEach((off) => off())
  }, [refresh])

  const openFile = async (path: string) => {
    try {
      const content = await vfs.readFile(path)
      setSelectedPath(path)
      setDraft(content)
      setSavedContent(content)
      setError(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const save = async () => {
    if (!selectedPath) return
    try {
      await vfs.writeFile(selectedPath, draft)
      setSavedContent(draft)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const createNote = async (name: string) => {
    const path = joinPath(NOTES_DIR, name)
    // writeFile would silently overwrite, so guard explicitly (PRD §39).
    const existing = await vfs.get(path)
    if (existing && !existing.trashed) {
      setDialogError('files.error.alreadyExists')
      return
    }
    try {
      await vfs.writeFile(path, '')
      setDialogOpen(false)
      setDialogError(null)
      await openFile(path)
    } catch (cause) {
      setDialogError(vfsErrorMessageKey(cause))
    }
  }

  const dirty = draft !== savedContent

  return (
    <div className="flex h-full bg-surface text-sm">
      <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between gap-1 px-2 py-2">
          <span className="truncate text-xs text-text-muted">{NOTES_DIR}</span>
          <button
            type="button"
            className="shrink-0 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-raised"
            onClick={() => {
              setDialogError(null)
              setDialogOpen(true)
            }}
          >
            {t('files.newFile')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {files === null ? (
            <p className="p-2 text-text-muted" role="status">
              {t('files.loading')}
            </p>
          ) : files.length === 0 ? (
            <p className="p-2 text-text-muted">{t('notes.listEmpty')}</p>
          ) : (
            <ul>
              {files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    aria-current={
                      selectedPath === joinPath(NOTES_DIR, file.name) ? 'true' : undefined
                    }
                    className={`flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-text hover:bg-surface-raised ${
                      selectedPath === joinPath(NOTES_DIR, file.name) ? 'bg-surface-raised' : ''
                    }`}
                    onClick={() => void openFile(joinPath(NOTES_DIR, file.name))}
                  >
                    <span aria-hidden="true">📄</span>
                    <span className="truncate">{file.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <p role="alert" className="border-b border-border px-3 py-2 text-xs text-danger">
            {t(error)}
          </p>
        )}
        {selectedPath === null ? (
          <div className="flex flex-1 items-center justify-center text-text-muted">
            {t('notes.empty')}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="truncate text-text">{selectedPath}</span>
              {dirty && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-primary"
                  title={t('notes.unsaved')}
                  aria-label={t('notes.unsaved')}
                />
              )}
              <button
                type="button"
                disabled={!dirty}
                className="ml-auto rounded-md bg-primary px-3 py-1 text-xs text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void save()}
              >
                {t('notes.save')}
              </button>
            </div>
            <textarea
              aria-label={t('notes.editor')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-0 flex-1 resize-none bg-surface p-3 text-sm leading-relaxed text-text"
            />
          </>
        )}
      </div>

      {dialogOpen && (
        <PromptDialog
          title={t('files.newFile')}
          label={t('files.dialog.name')}
          confirmLabel={t('files.dialog.confirm')}
          cancelLabel={t('files.dialog.cancel')}
          error={dialogError ? t(dialogError) : null}
          onConfirm={(value) => void createNote(value)}
          onCancel={() => {
            setDialogOpen(false)
            setDialogError(null)
          }}
        />
      )}
    </div>
  )
}
