import { useCallback, useEffect, useRef, useState } from 'react'

import { CaretLeft, FilePlus, FileText, NoteBlank } from '@phosphor-icons/react'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { PromptDialog } from '@/components/prompt-dialog'
import { systemBus } from '@/core/events'
import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { joinPath, Vfs } from '@/core/filesystem'
import type { VfsNode } from '@/core/filesystem'
import { vfsErrorMessageKey } from '@/apps/files/error-messages'
import { useNarrowContainer } from '@/apps/use-narrow-container'
import { systemVfs } from '@/services/vfs'

const NOTES_DIR = '/Documents'

export interface NotesAppProps {
  windowId: string
  vfs?: Vfs
}

/**
 * Notes system app (PRD §26): a simple text editor over the VFS. Notes live
 * as text files inside /Documents.
 *
 * 窄容器适配（M2-6，同 M2-5 Files 方案：按应用根内容盒宽 <560px 分支，
 * 禁止视口 media query）：宽容器保持「列表栏 + 编辑器」双栏原样（桌面 DOM
 * 与改前等价）；窄容器（移动全屏视图 / 小窗口）二选一切换——**选
 * 「列表↔编辑器」单面切换而非上下堆叠**：编辑器 textarea 需要尽量高的纵向
 * 空间，堆叠会把列表与编辑器各压进半屏；单面切换让两个面各占满幅，选中
 * （列表项点击 / 新建成功）即进编辑器面，编辑器面左上返回键回列表面。
 * 选中/新建/保存的底层流程（openFile / createNote / save 与 VFS 交互）宽窄
 * 完全同一条代码路径，窄分支只追加「切面」这一个 UI 动作。
 */
export function NotesApp({ vfs = systemVfs }: NotesAppProps) {
  const { t } = useTranslation()
  // 窄容器分支（M2-6）：与设备判定（device-store）无关——桌面窄窗口同样
  // 进入窄分支，移动宽视口（平板横屏 ≥560px）保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  const [files, setFiles] = useState<VfsNode[] | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogError, setDialogError] = useState<MessageKey | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  // 有未保存草稿时切换笔记的确认目标（null = 无待确认切换）。
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null)
  // 窄容器单面切换状态：仅 narrow 时被消费；宽容器恒渲染双栏不读它。
  const [pane, setPane] = useState<'list' | 'editor'>('list')
  // 异步落点归属（D2 审查）：保存/刷新的 await 返回时必须知道「当前选中的
  // 还是不是发起时的笔记」，否则晚到的结果会把另一条笔记误标 dirty。
  const selectedPathRef = useRef<string | null>(null)
  const draftRef = useRef('')
  const savedContentRef = useRef('')
  draftRef.current = draft
  savedContentRef.current = savedContent
  useEffect(() => {
    selectedPathRef.current = selectedPath
  }, [selectedPath])

  const refresh = useCallback(async () => {
    try {
      const nodes = await vfs.list(NOTES_DIR)
      const next = nodes.filter((node) => node.type === 'file')
      setFiles(next)
      setError(null)
      // 外部变更对齐（D2 审查）：选中的笔记被外部删除 → 退出编辑器（否则
      // 再保存会用 writeFile 把已删文件复活）；被外部改写 → 草稿干净时跟随
      // 内容，有未保存修改时只更新磁盘基线（保存与否由用户决定）。
      const path = selectedPathRef.current
      if (path === null) return
      const exists = next.some((node) => joinPath(NOTES_DIR, node.name) === path)
      if (!exists) {
        selectedPathRef.current = null
        setSelectedPath(null)
        setDraft('')
        setSavedContent('')
        setError('files.error.notFound')
        return
      }
      try {
        const latest = await vfs.readFile(path)
        if (selectedPathRef.current !== path) return
        if (draftRef.current === savedContentRef.current) {
          setDraft(latest)
          setSavedContent(latest)
        } else {
          setSavedContent(latest)
        }
      } catch {
        /* 读取竞态：下一次文件事件再对齐 */
      }
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
      // 窄容器（M2-6）：选中即进编辑器面；宽容器双栏在场，pane 无消费者，
      // 不翻动（保持桌面渲染路径零变化）。
      if (narrow) setPane('editor')
    } catch (cause) {
      setError(vfsErrorMessageKey(cause))
    }
  }

  const save = async () => {
    if (!selectedPath) return
    const path = selectedPath
    const content = draft
    try {
      await vfs.writeFile(path, content)
      // 写盘期间用户可能已切到另一条笔记：旧内容不得记到新笔记的
      // savedContent 上（会把 B 误标 dirty——D2 审查）。
      if (selectedPathRef.current === path) setSavedContent(content)
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

  /** 列表点击入口：脏草稿先确认，避免 openFile 直接覆盖丢失。 */
  const requestOpen = (path: string) => {
    if (path === selectedPath) {
      // 窄容器从列表面点回当前笔记：直接回到编辑器面（草稿原样保留）。
      if (narrow) setPane('editor')
      return
    }
    if (dirty) {
      setPendingOpenPath(path)
      return
    }
    void openFile(path)
  }

  // ---- 共享 JSX 片段（宽窄同源，窄分支只追加命中区/结构差异）------------

  const newNoteButton = (
    <button
      type="button"
      className={`flex ${narrow ? 'min-h-[44px]' : 'h-7'} shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs text-primary-contrast hover:opacity-90`}
      onClick={() => {
        setDialogError(null)
        setDialogOpen(true)
      }}
    >
      <FilePlus aria-hidden="true" size={14} />
      {t('files.newFile')}
    </button>
  )

  const listHeader = (
    <div
      className={`flex ${narrow ? 'min-h-14' : 'h-10'} shrink-0 items-center justify-between gap-1 border-b border-border px-2`}
    >
      <span className="truncate font-mono text-[11px] text-text-muted">{NOTES_DIR}</span>
      {newNoteButton}
    </div>
  )

  const listBody = (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {files === null ? (
        <p className="flex items-center gap-2 p-2 text-xs text-text-muted" role="status">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          {t('files.loading')}
        </p>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
          <NoteBlank aria-hidden="true" size={28} className="text-text-muted/40" />
          <p className="text-xs text-text-muted">{t('notes.listEmpty')}</p>
          <p className="text-xs text-text-muted">{t('notes.listEmptyHint')}</p>
        </div>
      ) : (
        <ul>
          {files.map((file) => {
            const active = selectedPath === joinPath(NOTES_DIR, file.name)
            return (
              <li key={file.id}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className={`flex ${narrow ? 'min-h-[44px] ' : ''}w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left text-xs ${
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-text hover:bg-surface-raised'
                  }`}
                  onClick={() => requestOpen(joinPath(NOTES_DIR, file.name))}
                >
                  <FileText
                    aria-hidden="true"
                    size={14}
                    className={active ? 'text-primary' : 'text-text-muted'}
                  />
                  <span className="truncate">{file.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const errorBanner = error ? (
    <p role="alert" className="border-b border-border px-3 py-2 text-xs text-danger">
      {t(error)}
    </p>
  ) : null

  const editorHeader = (
    <div
      className={`flex ${narrow ? 'min-h-14' : 'h-10'} shrink-0 items-center gap-2 border-b border-border px-3`}
    >
      {/* 窄容器（M2-6）：回列表面的返回键，命中区 44×44（§35.3）；宽容器
          双栏在场不渲染。 */}
      {narrow && (
        <button
          type="button"
          data-testid="notes-back-to-list"
          aria-label={t('notes.backToList')}
          className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text hover:bg-surface-raised"
          onClick={() => setPane('list')}
        >
          <CaretLeft aria-hidden="true" size={18} weight="bold" />
        </button>
      )}
      <span className="truncate font-mono text-xs text-text">{selectedPath}</span>
      {dirty && (
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-primary"
          title={t('notes.unsaved')}
          aria-label={t('notes.unsaved')}
        />
      )}
      <button
        type="button"
        data-testid="notes-save"
        disabled={!dirty}
        className={`ml-auto flex ${narrow ? 'min-h-[44px]' : 'h-7'} items-center rounded-md bg-primary px-2.5 text-xs text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40`}
        onClick={() => void save()}
      >
        {t('notes.save')}
      </button>
    </div>
  )

  const editorBody = (
    <>
      {editorHeader}
      <textarea
        aria-label={t('notes.editor')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="m-2 min-h-0 flex-1 resize-none rounded-md bg-surface-raised/60 p-3 text-sm leading-relaxed text-text"
      />
    </>
  )

  // 窄容器编辑器面仅在真正选中笔记后出现（openFile 成功才翻 pane）。
  const showEditorPane = narrow && pane === 'editor' && selectedPath !== null

  return (
    <div ref={rootRef} className="surface-panel flex h-full text-sm">
      {narrow ? (
        <>
          {errorBanner}
          {showEditorPane ? (
            <div data-testid="notes-editor-pane" className="flex min-h-0 flex-1 flex-col">
              {editorBody}
            </div>
          ) : (
            <div data-testid="notes-list-pane" className="flex min-h-0 flex-1 flex-col">
              {listHeader}
              {listBody}
            </div>
          )}
        </>
      ) : (
        <>
          <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-surface/60">
            {listHeader}
            {listBody}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {errorBanner}
            {selectedPath === null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
                <NoteBlank aria-hidden="true" size={36} className="text-text-muted/40" />
                <p className="text-sm text-text">{t('notes.empty')}</p>
                <p className="max-w-60 text-xs text-text-muted">{t('notes.emptyHint')}</p>
              </div>
            ) : (
              editorBody
            )}
          </div>
        </>
      )}

      {pendingOpenPath !== null && (
        <ConfirmDialog
          title={t('notes.switchConfirmTitle')}
          body={t('notes.switchConfirmBody')}
          confirmLabel={t('notes.switchConfirmAction')}
          cancelLabel={t('notes.switchConfirmCancel')}
          onCancel={() => setPendingOpenPath(null)}
          onConfirm={() => {
            const path = pendingOpenPath
            setPendingOpenPath(null)
            void openFile(path)
          }}
        />
      )}

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
