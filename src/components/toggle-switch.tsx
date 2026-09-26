/**
 * 药丸开关（docs/DESIGN.md §3）：role=switch 的 button + 滑块 knob，
 * 纯 CSS 过渡（left/背景），语义与 testid 由调用方传入——与旧「按钮伪装
 * 开关」保持完全相同的可访问性契约（role/aria-checked/data-testid）。
 */
export function ToggleSwitch({
  checked,
  label,
  testId,
  disabled = false,
  onClick,
}: {
  checked: boolean
  /** 可访问名（aria-label）；同时建议调用方在旁边渲染可见文案。 */
  label: string
  testId?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'border border-border bg-surface-raised'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-[left] ${
          checked ? 'left-[calc(100%-1.125rem)] bg-primary-contrast' : 'left-0.5 bg-text-muted/60'
        }`}
      />
    </button>
  )
}
