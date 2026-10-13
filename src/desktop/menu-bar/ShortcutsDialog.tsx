import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { altShortcutLabel, ctrlAltShortcutLabel, shortcutLabel } from '@/core/platform'

interface ShortcutRow {
  keys: string
  labelKey: MessageKey
}

/**
 * 键盘快捷键面板（UI 评审 P2-8）：帮助菜单入口，列出 use-global-shortcuts
 * 与弹层契约里真实生效的按键。传送到 body——菜单栏的 backdrop-filter 会
 * 成为 fixed 遮罩的包含块（坑 67）。
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const rows: ShortcutRow[] = [
    { keys: shortcutLabel('K'), labelKey: 'shortcuts.search' },
    { keys: altShortcutLabel('W'), labelKey: 'shortcuts.cycleWindows' },
    { keys: ctrlAltShortcutLabel('←/→'), labelKey: 'shortcuts.switchSpace' },
    { keys: 'Esc', labelKey: 'shortcuts.dismiss' },
    { keys: '← → ↑ ↓', labelKey: 'shortcuts.menuNav' },
    { keys: t('shortcuts.doubleClickKey'), labelKey: 'shortcuts.maximize' },
  ]

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-dialog-title"
      data-testid="shortcuts-dialog"
      className="animate-os-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-scrim-strong p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="surface-glass popover-panel animate-os-pop-in w-full max-w-sm p-5">
        <h2 id="shortcuts-dialog-title" className="text-base font-semibold text-text">
          {t('shortcuts.title')}
        </h2>
        <dl className="mt-3 divide-y divide-border-subtle text-sm">
          {rows.map((row) => (
            <div key={row.labelKey} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-text">{t(row.labelKey)}</dt>
              <dd>
                <kbd className="rounded-md border border-border-subtle bg-surface-soft px-1.5 py-0.5 font-mono text-xs text-text-muted">
                  {row.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-contrast hover:opacity-90"
            onClick={onClose}
          >
            {t('shortcuts.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
