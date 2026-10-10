import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DownloadSimple,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Gear,
  Image as ImageIcon,
  MagnifyingGlass,
  Monitor,
  MusicNote,
  SquaresFour,
  Trash,
  UploadSimple,
  VideoCamera,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'

import { PromptDialog } from '@/components/prompt-dialog'
import { systemBus } from '@/core/events'
import { formatMessage, useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { joinPath, splitPath, Vfs, MAX_FILE_BYTES } from '@/core/filesystem'
import type { VfsNode } from '@/core/filesystem'

import { vfsErrorMessageKey } from './error-messages'
import { useNarrowContainer } from '@/apps/use-narrow-container'

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
const QUICK_ACCESS_ROOTS: Array<{ name: string; icon: Icon }> = [
  { name: 'Desktop', icon: Monitor },
  { name: 'Documents', icon: FileText },
  { name: 'Downloads', icon: DownloadSimple },
  { name: 'Pictures', icon: ImageIcon },
  { name: 'Videos', icon: VideoCamera },
  { name: 'Music', icon: MusicNote },
  { name: 'Apps', icon: SquaresFour },
  { name: 'System', icon: Gear },
]

const SYSTEM_FOLDER_KEYS: Record<string, MessageKey> = {
  Desktop: 'files.folder.desktop',
  Documents: 'files.folder.documents',
  Downloads: 'files.folder.downloads',
  Pictures: 'files.folder.pictures',
  Videos: 'files.folder.videos',
  Music: 'files.folder.music',
  Apps: 'files.folder.apps',
  System: 'files.folder.system',
}

/** 根级系统目录显示本地化名；真实路径仍是英文（VFS/SDK 契约不动）。 */
function folderLabel(path: string, t: (key: MessageKey) => string): string | null {
  const segments = splitPath(path)
  if (segments.length !== 1) return null
  const key = SYSTEM_FOLDER_KEYS[segments[0] ?? '']
  return key ? t(key) : null
}

export interface FileManagerProps {
  vfs: Vfs
  windowId: string
  /** §32 深链：Dock「回收站」启动时直接进入回收站视图。 */
  initialTrash?: boolean
}

export function FileManager({ vfs, windowId, initialTrash = false }: FileManagerProps) {
  const { t } = useTranslation()
  // 窄容器分支（M2-5）：按根元素内容盒宽（<560px）折叠布局与触屏语义，
  // 与设备判定（device-store）无关——桌面窄窗口同样进入窄分支，移动宽视口
  // （平板横屏 ≥560px）保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  const [path, setPath] = useState('/')
  const [trashMode, setTrashMode] = useState(initialTrash)
  const [query, setQuery] = useState('')
  /** `null` while the first listing for the current view is in flight. */
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dialogError, setDialogError] = useState<MessageKey | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  /**
   * 上传入口（Phase 3 二进制承载的 UI 面）：本机文件 → writeFileBytes 落入
   * 当前目录。同名先行拒绝（writeFileBytes 是创建或覆盖语义，坑 33）；超限
   * 在读取前拦截，避免无谓的内存复制。
   */
  const uploadFile = useCallback(
    async (file: File) => {
      setError(null)
      try {
        if (file.size > MAX_FILE_BYTES) {
          setError('files.error.tooLarge')
          return
        }
        const target = joinPath(path, file.name)
        if ((await vfs.get(target)) !== null) {
          setError('files.error.alreadyExists')
          return
        }
        await vfs.writeFileBytes(target, new Uint8Array(await file.arrayBuffer()))
      } catch (cause) {
        setError(vfsErrorMessageKey(cause))
      }
    },
    [path, vfs],
  )

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

  const quickAccess = QUICK_ACCESS_ROOTS.map(({ name, icon }) => ({
    name,
    icon,
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
  const searching = query.trim() !== '' && !trashMode
  const statusCount = entries
    ? formatMessage(searching ? t('files.searchCount') : t('files.itemCount'), {
        count: String(entries.length),
      })
    : ''

  return (
    <div ref={rootRef} className="surface-panel flex h-full text-sm">
      {/* 宽容器（≥560px）：固定侧栏原样渲染（桌面 DOM/样式与改前等价）；
          窄容器整块不渲染，目录切换由主列顶部的 chip 行接管。 */}
      {!narrow && (
        <aside className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 p-2">
        <p className="px-2 py-1 text-xs text-text-muted">{t('files.quickAccess')}</p>
        <ul>
          {quickAccess.map((item) => {
            const active = !trashMode && path === item.path
            return (
              <li key={item.path}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-text hover:bg-surface-raised'
                  }`}
                  onClick={() => navigate(item.path)}
                  title={item.path}
                >
                  <item.icon aria-hidden="true" size={14} className={active ? 'text-primary' : 'text-text-muted'} />
                  {folderLabel(item.path, t) ?? item.name}
                </button>
              </li>
            )
          })}
          <li className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              aria-current={trashMode ? 'true' : undefined}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                trashMode
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-text hover:bg-surface-raised'
              }`}
              onClick={openTrash}
            >
              <Trash aria-hidden="true" size={14} className={trashMode ? 'text-primary' : 'text-text-muted'} />
              {t('files.trash.title')}
            </button>
          </li>
        </ul>
      </aside>
      )}

      {/* 主列 = 容器查询上下文（container-type: inline-size）：列宽由 flex
          决定、与内容无关， containment 无布局副作用；工具栏行按容器宽度
          分支（@max-[640px]），桌面宽容器布局零变化。 */}
      <div className="@container flex min-w-0 flex-1 flex-col">
        {/* 窄容器（根内容盒 <560px）：固定侧栏收起为顶部目录切换 chip 行
            （M2-5）——8 个快速访问目录 + 回收站，标签与侧栏同源
            （SYSTEM_FOLDER_KEYS / files.trash.title，i18n 双语）。
            行本身是横向滚动面：照 M2-4 契约打 data-no-edge-back
            （use-edge-back 整体豁免 + index.css 对该面及后代重放 pan-x），
            chip 命中区 min-h-[44px]（§35.3）。宽容器整块不渲染。 */}
        {narrow && (
          <nav
            data-no-edge-back
            data-testid="files-dir-switcher"
            aria-label={t('files.quickAccess')}
            className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-1.5"
          >
            {quickAccess.map((item) => {
              const active = !trashMode && path === item.path
              return (
                <button
                  key={item.path}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  title={item.path}
                  className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs ${
                    active
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border text-text'
                  }`}
                  onClick={() => navigate(item.path)}
                >
                  <item.icon
                    aria-hidden="true"
                    size={14}
                    className={active ? 'text-primary' : 'text-text-muted'}
                  />
                  {folderLabel(item.path, t) ?? item.name}
                </button>
              )
            })}
            <button
              type="button"
              aria-current={trashMode ? 'true' : undefined}
              className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs ${
                trashMode
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-text'
              }`}
              onClick={openTrash}
            >
              <Trash aria-hidden="true" size={14} className={trashMode ? 'text-primary' : 'text-text-muted'} />
              {t('files.trash.title')}
            </button>
          </nav>
        )}

        {/* 窄容器（移动全屏视图 / 小窗口）：面包屑收缩 + 操作簇溢出改为
            本行横向滚动（overflow-x-auto）并标记 data-no-edge-back——
            移动边缘返回手势对该面豁免（hook 跳过 + index.css 重放
            pan-x），触屏可横滚到被裁剪的操作簇（M2-4 QA：360px 视口下
            操作簇 min-content ~454px 全部在视口外）。宽容器（桌面）：
            无 overflow 声明、行为与改前完全一致。 */}
        <div
          data-no-edge-back
          data-testid="files-toolbar"
          className={`flex ${narrow ? 'min-h-14' : 'h-10'} shrink-0 items-center gap-2 border-b border-border px-3 @max-[640px]:overflow-x-auto`}
        >
          {trashMode ? (
            <span className="flex items-center gap-2 font-medium text-text">
              <Trash aria-hidden="true" size={14} className="text-text-muted" />
              {t('files.trash.title')}
            </span>
          ) : (
            <nav
              aria-label="breadcrumb"
              className="flex min-w-0 items-center gap-0.5 font-mono text-xs"
            >
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-text-muted hover:bg-surface-raised hover:text-text ${
                  narrow ? 'flex min-h-[44px] items-center' : ''
                }`}
                onClick={() => navigate('/')}
                title="/"
              >
                /
              </button>
              {breadcrumbSegments.map((segment, index) => {
                const target = `/${breadcrumbSegments.slice(0, index + 1).join('/')}`
                const last = index === breadcrumbSegments.length - 1
                return (
                  <button
                    key={target}
                    type="button"
                    className={`max-w-40 truncate rounded px-1.5 py-0.5 ${
                      narrow ? 'flex min-h-[44px] items-center ' : ''
                    }${
                      last
                        ? 'font-medium text-text'
                        : 'text-text-muted hover:bg-surface-raised hover:text-text'
                    }`}
                    onClick={() => navigate(target)}
                    title={target}
                  >
                    {(index === 0 ? folderLabel(target, t) : null) ?? segment}
                  </button>
                )
              })}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {trashMode ? (
              <>
                <ToolbarButton narrow={narrow} label={t('files.restore')} disabled={!selected} onClick={restoreSelected} />
                <ToolbarButton narrow={narrow} label={t('files.purge')} disabled={!selected} onClick={purgeSelected} danger />
              </>
            ) : (
              <>
                <ToolbarButton
                  narrow={narrow}
                  label={t('files.newFile')}
                  icon={<FilePlus aria-hidden="true" size={14} />}
                  primary
                  onClick={() => {
                    setDialogError(null)
                    setDialog({ kind: 'newFile' })
                  }}
                />
                <ToolbarButton
                  narrow={narrow}
                  label={t('files.upload')}
                  icon={<UploadSimple aria-hidden="true" size={14} />}
                  onClick={() => uploadInputRef.current?.click()}
                />
                <input
                  ref={uploadInputRef}
                  type="file"
                  aria-hidden="true"
                  tabIndex={-1}
                  data-testid="file-upload-input"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // 允许连续重选同一文件。
                    event.target.value = ''
                    if (file) void uploadFile(file)
                  }}
                />
                <ToolbarButton
                  narrow={narrow}
                  label={t('files.newFolder')}
                  icon={<FolderPlus aria-hidden="true" size={14} />}
                  onClick={() => {
                    setDialogError(null)
                    setDialog({ kind: 'newFolder' })
                  }}
                />
                <ToolbarButton
                  narrow={narrow}
                  label={t('files.rename')}
                  disabled={!selected}
                  onClick={() => {
                    setDialogError(null)
                    if (selected) setDialog({ kind: 'rename', entry: selected })
                  }}
                />
                <ToolbarButton
                  narrow={narrow}
                  label={t('files.delete')}
                  disabled={!selected || selected.node.parentId === null}
                  onClick={deleteSelected}
                  danger
                />
              </>
            )}
            <div className="relative">
              <MagnifyingGlass
                aria-hidden="true"
                size={12}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="search"
                aria-label={t('files.search.placeholder')}
                placeholder={t('files.search.placeholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={`${narrow ? 'h-11' : 'h-7'} w-40 rounded-md border border-border bg-surface-raised pr-2 pl-6 text-xs text-text placeholder:text-text-muted focus:border-primary`}
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-window-id={windowId}>
          {loading ? (
            <p className="flex items-center gap-2 p-4 text-xs text-text-muted" role="status">
              <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              {t('files.loading')}
            </p>
          ) : error ? (
            <p className="p-4 text-sm text-danger" role="alert">
              {t(error)}
            </p>
          ) : entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              {trashMode ? (
                <Trash aria-hidden="true" size={36} className="text-text-muted/40" />
              ) : (
                <FolderOpen aria-hidden="true" size={36} className="text-text-muted/40" />
              )}
              <p className="text-sm text-text">{trashMode ? t('files.trash.empty') : t('files.empty')}</p>
              <p className="max-w-60 text-xs text-text-muted">
                {trashMode ? t('files.trash.emptyHint') : t('files.emptyHint')}
              </p>
            </div>
          ) : (
            <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {entries.map((entry) => (
                <li key={entry.node.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === entry.node.id}
                    className={`flex w-full flex-col items-center gap-1.5 rounded-md border p-2.5 text-center ${
                      selectedId === entry.node.id
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent hover:border-border hover:bg-surface-raised'
                    }`}
                    onClick={() => {
                      if (!narrow) {
                        // 宽容器（桌面）：单击选中、双击打开——与改前一致。
                        select(entry)
                        return
                      }
                      // 窄容器触屏语义（M2-5）：首击选中——接通工具栏重命名/
                      // 删除/还原/彻底删除；已选中再击 = 打开（进目录 / 文件
                      // 预览）。不依赖触屏上派发不可靠的 dblclick。整格命中
                      // 区（图标 28 + 双行文本 + p-2.5）≥44×44（§35.3）。
                      if (selectedId === entry.node.id) void openEntry(entry)
                      else select(entry)
                    }}
                    onDoubleClick={() => void openEntry(entry)}
                  >
                    {entry.node.type === 'directory' ? (
                      <FolderOpen aria-hidden="true" size={28} weight="fill" className="text-primary/80" />
                    ) : (
                      <FileText aria-hidden="true" size={28} weight="fill" className="text-text-muted/70" />
                    )}
                    <span className="line-clamp-2 break-all text-xs text-text">
                      {(entry.node.type === 'directory' ? folderLabel(entry.path, t) : null) ?? entry.node.name}
                    </span>
                    {searching && (
                      <span className="break-all font-mono text-[11px] text-text-muted">{entry.path}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border px-3 font-mono text-[11px] text-text-muted">
          <span className="truncate">{trashMode ? t('files.trash.title') : path}</span>
          {statusCount !== '' && <span className="shrink-0 tabular-nums">{statusCount}</span>}
        </footer>
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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-6"
        >
          <div className="flex max-h-[80%] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-window">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="truncate font-mono text-xs text-text">{preview.path}</h2>
              <button
                type="button"
                className={`rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-raised hover:text-text ${
                  narrow ? 'min-h-[44px]' : ''
                }`}
                onClick={() => setPreview(null)}
              >
                {t('files.preview.close')}
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-surface-raised p-4 font-mono text-xs text-text">
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
  primary = false,
  danger = false,
  icon = null,
  narrow = false,
  onClick,
}: {
  label: string
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  icon?: React.ReactNode
  /** 窄容器（M2-5）：命中区抬到 ≥44px（§35.3），其余视觉档不变。 */
  narrow?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex ${narrow ? 'min-h-[44px]' : 'h-7'} items-center gap-1.5 rounded-md px-2.5 text-xs ${
        primary
          ? 'border border-transparent bg-primary text-primary-contrast hover:opacity-90'
          : danger
            ? 'border border-transparent text-danger hover:bg-danger/10'
            : 'border border-border text-text hover:bg-surface-raised'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
      {label}
    </button>
  )
}

function dialogTitle(dialog: NonNullable<DialogState>, t: (key: MessageKey) => string): string {
  if (dialog.kind === 'newFolder') return t('files.newFolder')
  if (dialog.kind === 'newFile') return t('files.newFile')
  return t('files.rename')
}
