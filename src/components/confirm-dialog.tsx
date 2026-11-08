import { DialogShell } from './dialog-shell'

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
 *
 * 弹层壳归 DialogShell（portal 到 body + aria-modal + 焦点陷阱 + Esc/遮罩
 * 关闭，E3 审查修复）。**busy 只禁用确认**：请求在途时取消/Esc 仍可退出，
 * 避免网络悬挂把整个窗口锁死。
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
    <DialogShell title={title} testId="confirm-dialog" onClose={onCancel}>
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
            data-autofocus
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
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
    </DialogShell>
  )
}
