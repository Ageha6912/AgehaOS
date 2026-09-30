import { useState, type FormEvent } from 'react'

export interface PromptDialogProps {
  title: string
  label: string
  initialValue?: string
  confirmLabel: string
  cancelLabel: string
  /** Shown inside the dialog as a validation error. */
  error?: string | null
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title,
  label,
  initialValue = '',
  confirmLabel,
  cancelLabel,
  error = null,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (trimmed === '') return
    onConfirm(trimmed)
  }

  return (
    <div
      role="dialog"
      aria-label={title}
      className="animate-os-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-scrim-strong p-6 backdrop-blur-sm"
    >
      <form
        className="surface-glass animate-os-pop-in w-full max-w-sm rounded-lg border border-border p-4 shadow-window"
        onSubmit={submit}
      >
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <label className="mt-3 block text-sm text-text-muted">
          {label}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text focus:border-primary"
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={value.trim() === ''}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
