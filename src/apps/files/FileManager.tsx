import { useCallback, useEffect, useState } from 'react'

import { PromptDialog } from '@/components/prompt-dialog'
import { systemBus } from '@/core/events'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { joinPath, splitPath, Vfs } from '@/core/filesystem'
import type { VfsNode } from '@/core/filesystem'

import { vfsErrorMessageKey } from './error-messages'

interface FileEntry {
  node: VfsNode
  path: string
}

type DialogState =
  { kind: 'newFolder' } | { kind: 'newFile' } | { kind: 'rename'; entry: FileEntry } | null

interface PreviewState {
  path: string
  content: string
}

/** Top-level system directories exposed in the sidebar (PRD §11.1, minus Trash). */
const QUICK_ACCESS_ROOTS = [
  'Desktop',
  'Documents',
  'Downloads',
  'Pictures',
  'Videos',
  'Music',
  'Apps',
  'System',
]

export interface FileManagerProps {
  vfs: Vfs
  windowId: string
}

export function FileManager({ vfs, windowId }: FileManagerProps) {
  const { t } = useTranslation()
  const [path, setPath] = useState('/')
  const [trashMode, setTrashMode] = useState(false)
  const [query, setQuery] = useState('')
  /** `null` while the first listing for the current view is in flight. */
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogError, setDialogError] = useState<MessageKey | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const refresh = useCallback(async () => {
    try {
      let next: FileEntry[]
      if (trashMode) {
        const trashed = await vfs.listTrash()
        next = trashed.map((node) => ({ node, path: vfs.pathOfId(node.id) ?? node.name }))
      } else if (query.trim() === '') {
        const nodes = await vfs.list(path)
        next = nodes.map((node) => ({ node, path: joinPath(path, node.name) }))
      } else {
        const results = await vfs.search(path, query)
        next = results.map(({ node, path: resultPath }) => ({ node, path: resultPath }))
      }
      setEntries(next)
      setError(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
      setEntries((current) => current ?? [])
    }
  }, [vfs, path, trashMode, query])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  // Keep views in sync with mutations coming from other windows/apps.
  useEffect(() => {
    const offs = (['file.created', 'file.updated', 'file.deleted'] as const).map((name) =>
      systemBus.on(name, () => void refresh()),
    )
    return () => offs.forEach((off) => off())
  }, [refresh])

  const quickAccess = QUICK_ACCESS_ROOTS.map((name) => ({
    name,
    path: `/${name}`,
  }))

  const select = (entry: FileEntry) => setSelectedId(entry.node.id)

  const openEntry = async (entry: FileEntry) => {
    if (trashMode) return
    if (entry.node.type === 'directory') {
      setQuery('')
      setSelectedId(null)
      setPath(entry.path)
      return
    }
    try {
      const content = await vfs.readFile(entry.path)
      setPreview({ path: entry.path, content })
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const runDialog = async (value: string) => {
    if (!dialog) return
    try {
      if (dialog.kind === 'newFolder') {
        await vfs.createDirectory(joinPath(path, value))
      } else if (dialog.kind === 'newFile') {
        await vfs.writeFile(joinPath(path, value), '')
      } else if (dialog.kind === 'rename') {
        await vfs.rename(dialog.entry.path, value)
      }
      setDialog(null)
      setDialogError(null)
    } catch (cause) {
      setDialogError(vfsErrorMessageKey(cause))
    }
  }

  const deleteSelected = async () => {
    const entry = entries?.find((candidate) => candidate.node.id === selectedId)
    if (!entry || entry.node.parentId === null) return
    try {
      await vfs.remove(entry.path)
      setSelectedId(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const restoreSelected = async () => {
    if (!selectedId) return
    try {
      await vfs.restore(selectedId)
      setSelectedId(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const purgeSelected = async () => {
    if (!selectedId) return
    try {
      await vfs.purge(selectedId)
      setSelectedId(null)
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const navigate = (target: string) => {
    setQuery('')
    setSelectedId(null)
    setTrashMode(false)
    setPath(target)
  }

  const openTrash = () => {
    setQuery('')
    setSelectedId(null)
    setTrashMode(true)
    setPath('/')
  }

  const loading = entries === null
  const selected = entries?.find((entry) => entry.node.id === selectedId) ?? null
  const breadcrumbSegments = splitPath(path)

  return (
    <div className="flex h-full bg-surface text-sm">
      <aside className="w-40 shrink-0 overflow-y-auto border-r border-border bg-surface p-2">
        <p className="px-2 py-1 text-xs text-text-muted">{t('files.quickAccess')}</p>
        <ul>
          {quickAccess.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text hover:bg-surface-raised ${
                  !trashMode && path === item.path ? 'bg-surface-raised' : ''
                }`}
                onClick={() => navigate(item.path)}
              >
                <span aria-hidden="true">📁</span>
                {item.name}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-current={trashMode ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text hover:bg-surface-raised ${
                trashMode ? 'bg-surface-raised' : ''
              }`}
              onClick={openTrash}
            >
              <span aria-hidden="true">🗑️</span>
              {t('files.trash.title')}
            </button>
          </li>
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {trashMode ? (
            <span className="font-medium text-text">{t('files.trash.title')}</span>
          ) : (
            <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                className="rounded px-1 text-text hover:bg-surface-raised"
                onClick={() => navigate('/')}
              >
                /
              </button>
              {breadcrumbSegments.map((segment, index) => {
                const target = `/${breadcrumbSegments.slice(0, index + 1).join('/')}`
                return (
                  <button
                    key={target}
                    type="button"
                    className="truncate rounded px-1 text-text hover:bg-surface-raised"
                    onClick={() => navigate(target)}
                  >
                    {segment}
                  </button>
                )
              })}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {trashMode ? (
              <>
                <ToolbarButton
                  label={t('files.restore')}
                  disabled={!selected}
                  onClick={restoreSelected}
                />
                <ToolbarButton
                  label={t('files.purge')}
                  disabled={!selected}
                  onClick={purgeSelected}
                />
              </>
            ) : (
              <>
                <ToolbarButton
                  label={t('files.newFolder')}
                  onClick={() => {
                    setDialogError(null)
                    setDialog({ kind: 'newFolder' })
                  }}
                />
                <ToolbarButton
                  label={t('files.newFile')}
                  onClick={() => {
                    setDialogError(null)
                    setDialog({ kind: 'newFile' })
                  }}
                />
                <ToolbarButton
                  label={t('files.rename')}
                  disabled={!selected}
                  onClick={() => {
                    setDialogError(null)
                    if (selected) setDialog({ kind: 'rename', entry: selected })
                  }}
                />
                <ToolbarButton
                  label={t('files.delete')}
                  disabled={!selected || selected.node.parentId === null}
                  onClick={deleteSelected}
                />
              </>
            )}
            <input
              type="search"
              aria-label={t('files.search.placeholder')}
              placeholder={t('files.search.placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-36 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text placeholder:text-text-muted focus:border-primary"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-window-id={windowId}>
          {loading ? (
            <p className="p-4 text-text-muted" role="status">
              {t('files.loading')}
            </p>
          ) : error ? (
            <p className="p-4 text-danger" role="alert">
              {t(error)}
            </p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-text-muted">
              {trashMode ? t('files.trash.empty') : t('files.empty')}
            </p>
          ) : (
            <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {entries.map((entry) => (
                <li key={entry.node.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === entry.node.id}
                    className={`flex w-full flex-col items-center gap-1 rounded-md border p-2 text-center ${
                      selectedId === entry.node.id
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-transparent hover:border-border hover:bg-surface-raised'
                    }`}
                    onClick={() => select(entry)}
                    onDoubleClick={() => void openEntry(entry)}
                  >
                    <span aria-hidden="true" className="text-2xl">
                      {entry.node.type === 'directory' ? '📁' : '📄'}
                    </span>
                    <span className="line-clamp-2 break-all text-xs text-text">
                      {entry.node.name}
                    </span>
                    {query.trim() !== '' && !trashMode && (
                      <span className="break-all text-[10px] text-text-muted">{entry.path}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {dialog && (
        <PromptDialog
          title={dialogTitle(dialog, t)}
          label={t('files.dialog.name')}
          initialValue={dialog.kind === 'rename' ? dialog.entry.node.name : ''}
          confirmLabel={t('files.dialog.confirm')}
          cancelLabel={t('files.dialog.cancel')}
          error={dialogError ? t(dialogError) : null}
          onConfirm={(value) => void runDialog(value)}
          onCancel={() => {
            setDialog(null)
            setDialogError(null)
          }}
        />
      )}

      {preview && (
        <div
          role="dialog"
          aria-label={t('files.preview.title')}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6"
        >
          <div className="flex max-h-[80%] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-4 shadow-window">
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate text-sm font-semibold text-text">{preview.path}</h2>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:bg-surface-raised hover:text-text"
                onClick={() => setPreview(null)}
              >
                {t('files.preview.close')}
              </button>
            </div>
            <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-raised p-3 text-xs text-text">
              {preview.content === '' ? t('files.empty') : preview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolbarButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function dialogTitle(dialog: NonNullable<DialogState>, t: (key: MessageKey) => string): string {
  if (dialog.kind === 'newFolder') return t('files.newFolder')
  if (dialog.kind === 'newFile') return t('files.newFile')
  return t('files.rename')
}
