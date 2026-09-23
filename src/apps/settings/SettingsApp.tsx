import { useState, type ReactNode } from 'react'

import { GlobeHemisphereWest, LockSimple, Palette, Sparkle, UserCircle } from '@phosphor-icons/react'

import { useTranslation, useLocaleStore } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { PERMISSION_LABEL_KEYS, permissionManager } from '@/core/permissions'
import type { ThemePreference, FontSize } from '@/store/settings-store'
import { useSettingsStore } from '@/store/settings-store'
import { useAppStore } from '@/store/app-store'
import { DynamicDesktopSection } from './DynamicDesktopSection'
import { AccountSection } from './AccountSection'

type SectionId = 'account' | 'appearance' | 'dynamic' | 'language' | 'permissions' | 'about'

const SECTIONS: Array<{ id: SectionId; labelKey: MessageKey; icon: ReactNode }> = [
  { id: 'account', labelKey: 'settings.account', icon: <UserCircle size={14} weight="regular" /> },
  { id: 'appearance', labelKey: 'settings.appearance', icon: <Palette size={14} weight="regular" /> },
  { id: 'dynamic', labelKey: 'dynamicDesktop.section', icon: <Sparkle size={14} weight="regular" /> },
  { id: 'language', labelKey: 'settings.language', icon: <GlobeHemisphereWest size={14} weight="regular" /> },
  { id: 'permissions', labelKey: 'settings.permissions', icon: <LockSimple size={14} weight="regular" /> },
  { id: 'about', labelKey: 'settings.about', icon: '🦋' },
]

const THEME_OPTIONS: Array<{ value: ThemePreference; labelKey: MessageKey }> = [
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
  { value: 'system', labelKey: 'theme.system' },
]

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; labelKey: MessageKey }> = [
  { value: 'small', labelKey: 'fontSize.small' },
  { value: 'medium', labelKey: 'fontSize.medium' },
  { value: 'large', labelKey: 'fontSize.large' },
]

const LOCALE_OPTIONS: Array<{ value: 'zh-CN' | 'en'; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

export function SettingsApp() {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>('appearance')

  return (
    <div className="flex h-full bg-surface text-sm">
      <aside className="w-40 shrink-0 overflow-y-auto border-r border-border bg-surface p-2">
        <ul>
          {SECTIONS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-text hover:bg-surface-raised ${
                  section === item.id ? 'bg-surface-raised' : ''
                }`}
                onClick={() => setSection(item.id)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {t(item.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {section === 'account' && <AccountSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'dynamic' && <DynamicDesktopSection />}
        {section === 'language' && <LanguageSection />}
        {section === 'permissions' && <PermissionsSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  )
}

function OptionRow({
  label,
  options,
  currentValue,
  onSelect,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  currentValue: string
  onSelect: (value: string) => void
}) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-xs text-text-muted">{label}</p>
      <div className="flex gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={currentValue === option.value}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              currentValue === option.value
                ? 'border-primary/60 bg-primary/10 text-text'
                : 'border-border text-text-muted hover:bg-surface-raised hover:text-text'
            }`}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function AppearanceSection() {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const setFontSize = useSettingsStore((s) => s.setFontSize)

  return (
    <section aria-label={t('settings.appearance')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.appearance')}</h2>
      <OptionRow
        label={t('settings.theme')}
        options={THEME_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        currentValue={theme}
        onSelect={(value) => setTheme(value as ThemePreference)}
      />
      <OptionRow
        label={t('settings.fontSize')}
        options={FONT_SIZE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        currentValue={fontSize}
        onSelect={(value) => setFontSize(value as FontSize)}
      />
    </section>
  )
}

function LanguageSection() {
  const { t } = useTranslation()
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useSettingsStore((s) => s.setLocale)

  return (
    <section aria-label={t('settings.language')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.language')}</h2>
      <OptionRow
        label={t('settings.language')}
        options={LOCALE_OPTIONS}
        currentValue={locale}
        onSelect={(value) => setLocale(value as 'zh-CN' | 'en')}
      />
    </section>
  )
}

function PermissionsSection() {
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)

  return (
    <section aria-label={t('settings.permissions')}>
      <h2 className="mb-1 text-base font-semibold text-text">{t('settings.permissions')}</h2>
      <p className="mb-4 text-xs text-text-muted">{t('settings.permissionsHint')}</p>
      <ul className="space-y-2">
        {apps.map((app) => {
          const granted = permissionManager.grantedPermissions(app.id)
          return (
            <li key={app.id} className="rounded-md border border-border bg-surface-raised/50 p-3">
              <p className="text-text">{app.name}</p>
              <p className="mt-1 text-xs text-text-muted">
                {granted.length === 0
                  ? t('settings.noPermissions')
                  : granted.map((permission) => t(PERMISSION_LABEL_KEYS[permission])).join('、')}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AboutSection() {
  const { t } = useTranslation()

  return (
    <section aria-label={t('settings.about')}>
      <h2 className="mb-4 text-base font-semibold text-text">{t('settings.about')}</h2>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-3xl">
          🦋
        </span>
        <div>
          <p className="font-medium text-text">AgehaOS</p>
          <p className="text-xs text-text-muted">
            {t('settings.aboutVersion')} 0.1.0 · {t('settings.aboutDescription')}
          </p>
        </div>
      </div>
    </section>
  )
}
