export interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  /** While true the confirm button is disabled (request in flight). */
  busy?: boolean
  /** Shown inside the dialog as an inline error. */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用确认框：纯确认/取消（无输入），与 PromptDialog（输入型）互补。
 * 首个消费者是举报样本上传的显式同意（DDS §8.6 铁律 4/10）。
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="animate-os-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    >
      <div className="surface-glass animate-os-pop-in w-full max-w-sm rounded-lg border border-border p-5 shadow-window">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <p className="mt-2 text-sm text-text-muted">{body}</p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
