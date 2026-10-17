import { useState, type ReactNode } from 'react'

import { version as appVersion } from '../../../package.json'

import { consumeSettingsSection } from '@/apps/app-deep-link'
import { appDisplayName } from '@/apps/launch'
import { useNarrowContainer } from '@/apps/use-narrow-container'

import { BrandLogo } from '@/components/brand-logo'
import { ToggleSwitch } from '@/components/toggle-switch'
import { useMotionPrefsStore, type MotionPrefKey } from '@/store/motion-prefs-store'
import { useSoundPrefsStore } from '@/store/sound-prefs-store'
import { ArrowsClockwise, CaretLeft, GlobeHemisphereWest, Butterfly, ListChecks, LockSimple, Palette, ShieldCheck, Sparkle, UserCircle } from '@phosphor-icons/react'

import { useTranslation, useLocaleStore } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { PERMISSION_LABEL_KEYS, permissionManager } from '@/core/permissions'
import type { ThemePreference, FontSize } from '@/store/settings-store'
import { useSettingsStore } from '@/store/settings-store'
import { useAppStore } from '@/store/app-store'
import { useSessionStore } from '@/store/session-store'
import { DynamicDesktopSection } from './DynamicDesktopSection'
import { EclosionSection } from './EclosionSection'
import { AccountSection } from './AccountSection'
import { CatalogSection } from './CatalogSection'
import { SampleReviewSection } from './SampleReviewSection'
import { SyncSection } from './SyncSection'

type SectionId =
  | 'account'
  | 'sync'
  | 'appearance'
  | 'dynamic'
  | 'eclosion'
  | 'catalog'
  | 'review'
  | 'language'
  | 'permissions'
  | 'about'

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

/**
 * Settings system app。
 *
 * 窄容器适配（M2-6，同 M2-5 Files 方案：按应用根内容盒宽 <560px 分支，
 * 禁止视口 media query）：宽容器保持「分区侧栏 + 分区内容」双栏原样（桌面
 * DOM 与改前等价）；窄容器去双栏，改「分区列表↔分区详情」纵向单列切换
 * ——列表面为纵向单列的分区入口（非 Files 的横向 chip 行：9 个分区名横滚
 * 不如纵列可达，分区是低频一级导航），点入即单列展示该分区，详情面左上
 * 返回键回列表。**刻意不把全部分区纵向堆叠成一面**：多个分区挂载即带副
 * 作用（EclosionSection 挂载即拉额度快照、AccountSection 远程模式拉会话
 * 列表、admin 分区拉目录/复审数据），堆叠会为用户未访问的分区触发这些
 * 行为——「一次只挂载当前分区」的语义与桌面完全一致。§32 深链命中时窄
 * 容器首面直接落在该分区详情面（「本次启动直接落在账户分区」语义不变）。
 * 其内 PermissionsSection 直调 permissionManager 的既有反例保持原样——
 * 不修复、不扩散（M2-6 切片裁决）。
 */
export function SettingsApp() {
  const { t } = useTranslation()
  // 窄容器分支（M2-6）：按根元素内容盒宽（<560px）折叠布局，与设备判定
  // （device-store）无关——桌面窄窗口同样进入窄分支，移动宽视口（平板横屏
  // ≥560px）保持宽布局。
  const { ref: rootRef, narrow } = useNarrowContainer()
  // §32 深链：左栏「用户中心」请求本次启动直接落在账户分区（取走即清，
  // 单次消费；M2-6 起命中与否同时决定窄容器首面是否直接进分区详情）。
  const [initialSection] = useState<SectionId | null>(() => consumeSettingsSection())
  const [section, setSection] = useState<SectionId>(initialSection ?? 'appearance')
  // 窄容器单面切换状态：仅 narrow 时被消费；宽容器恒渲染双栏不读它。
  const [pane, setPane] = useState<'sections' | 'section'>(
    initialSection === null ? 'sections' : 'section',
  )
  // ADR 20：目录管理仅对 admin 角色可见（远程模式才有 admin）。
  const isAdmin = useSessionStore((s) => s.user?.role === 'admin')

  const sections: Array<{ id: SectionId; labelKey: MessageKey; icon: ReactNode }> = [
    { id: 'account', labelKey: 'settings.account', icon: <UserCircle size={14} weight="regular" /> },
    { id: 'sync', labelKey: 'settings.sync.section', icon: <ArrowsClockwise size={14} weight="regular" /> },
    { id: 'appearance', labelKey: 'settings.appearance', icon: <Palette size={14} weight="regular" /> },
    { id: 'dynamic', labelKey: 'dynamicDesktop.section', icon: <Sparkle size={14} weight="regular" /> },
    { id: 'eclosion', labelKey: 'settings.eclosion.section', icon: <Butterfly size={14} weight="regular" /> },
    ...(isAdmin
      ? [
          { id: 'catalog' as const, labelKey: 'settings.catalog' as MessageKey, icon: <ShieldCheck size={14} weight="regular" /> },
          { id: 'review' as const, labelKey: 'settings.review' as MessageKey, icon: <ListChecks size={14} weight="regular" /> },
        ]
      : []),
    { id: 'language', labelKey: 'settings.language', icon: <GlobeHemisphereWest size={14} weight="regular" /> },
    { id: 'permissions', labelKey: 'settings.permissions', icon: <LockSimple size={14} weight="regular" /> },
    { id: 'about', labelKey: 'settings.about', icon: <BrandLogo size={14} /> },
  ]

  // 分区内容（宽窄同源）：一次只挂载当前分区（含 admin 门控），桌面与
  // 窄容器共用同一份映射，行为零分叉。
  const sectionContent = (
    <>
      {section === 'account' && <AccountSection />}
      {section === 'sync' && <SyncSection />}
      {section === 'appearance' && <AppearanceSection narrow={narrow} />}
      {section === 'dynamic' && <DynamicDesktopSection />}
      {section === 'eclosion' && <EclosionSection />}
      {section === 'catalog' && isAdmin && <CatalogSection />}
      {section === 'review' && isAdmin && <SampleReviewSection />}
      {section === 'language' && <LanguageSection narrow={narrow} />}
      {section === 'permissions' && <PermissionsSection />}
      {section === 'about' && <AboutSection />}
    </>
  )

  // 窄容器详情面标题 = 当前分区本地化名（列表面条目与宽容器侧栏同源）。
  const activeSection = sections.find((item) => item.id === section)

  return (
    <div ref={rootRef} className="surface-panel flex h-full text-sm">
      {narrow ? (
        pane === 'sections' ? (
          <nav
            data-testid="settings-section-nav"
            aria-label={t('settings.sectionsNav')}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
          >
            <ul>
              {sections.map((item) => {
                const active = section === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={`flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-text hover:bg-surface-raised'
                      }`}
                      onClick={() => {
                        setSection(item.id)
                        setPane('section')
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={active ? 'text-primary' : 'text-text-muted'}
                      >
                        {item.icon}
                      </span>
                      {t(item.labelKey)}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : (
          <div data-testid="settings-section-pane" className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border px-2">
              {/* 窄容器（M2-6）：回分区列表的返回键，命中区 44×44（§35.3）。 */}
              <button
                type="button"
                data-testid="settings-back-to-sections"
                aria-label={t('settings.backToSections')}
                className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text hover:bg-surface-raised"
                onClick={() => setPane('sections')}
              >
                <CaretLeft aria-hidden="true" size={18} weight="bold" />
              </button>
              <span className="min-w-0 truncate text-sm font-semibold text-text">
                {activeSection ? t(activeSection.labelKey) : ''}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{sectionContent}</div>
          </div>
        )
      ) : (
        <>
          <aside className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 p-2">
            <ul>
              {sections.map((item) => {
                const active = section === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-text hover:bg-surface-raised'
                      }`}
                      onClick={() => setSection(item.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={active ? 'text-primary' : 'text-text-muted'}
                      >
                        {item.icon}
                      </span>
                      {t(item.labelKey)}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">{sectionContent}</div>
        </>
      )}
    </div>
  )
}

function OptionRow({
  label,
  options,
  currentValue,
  narrow = false,
  onSelect,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  currentValue: string
  /** 窄容器（M2-6）：命中区抬到 ≥44px（§35.3），其余视觉档不变。 */
  narrow?: boolean
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
              className={`${narrow ? 'min-h-[44px]' : 'h-8'} rounded-md border px-3 text-xs ${
                currentValue === option.value
                  ? 'border-primary bg-primary/10 font-medium text-text'
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

/** 动效实验室开关组（§32.5 修订 10；spatialMotion = 2026-10-10 空间化裁决
 * 3）：设备本地偏好，默认全开。 */
const MOTION_TOGGLES: Array<{
  key: MotionPrefKey
  labelKey: MessageKey
  testId: string
  /** 可选说明行（label 下方 muted 小字）：glow / spatialMotion 各一句。 */
  hintKey?: MessageKey
}> = [
  {
    key: 'glow',
    labelKey: 'settings.motionGlow',
    testId: 'motion-glow-toggle',
    hintKey: 'settings.motionGlowHint',
  },
  { key: 'aurora', labelKey: 'settings.motionAurora', testId: 'motion-aurora-toggle' },
  {
    key: 'windowTilt',
    labelKey: 'settings.motionWindowTilt',
    testId: 'motion-window-tilt-toggle',
  },
  { key: 'dockSheen', labelKey: 'settings.motionDockSheen', testId: 'motion-dock-sheen-toggle' },
  {
    key: 'themeGlow',
    labelKey: 'settings.motionThemeGlow',
    testId: 'motion-theme-glow-toggle',
  },
  {
    key: 'spatialMotion',
    labelKey: 'settings.motionSpatial',
    testId: 'motion-spatial-toggle',
    hintKey: 'settings.motionSpatialHint',
  },
]

function AppearanceSection({ narrow = false }: { narrow?: boolean }) {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const setFontSize = useSettingsStore((s) => s.setFontSize)
  const motion = useMotionPrefsStore()
  const setPref = useMotionPrefsStore((s) => s.setPref)
  const soundsEnabled = useSoundPrefsStore((s) => s.enabled)
  const setSoundsEnabled = useSoundPrefsStore((s) => s.setEnabled)

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
        narrow={narrow}
        onSelect={(value) => setTheme(value as ThemePreference)}
      />
      <OptionRow
        label={t('settings.fontSize')}
        options={FONT_SIZE_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
        currentValue={fontSize}
        narrow={narrow}
        onSelect={(value) => setFontSize(value as FontSize)}
      />
      <p className="pb-1 pt-2 text-xs text-text-muted">{t('settings.motionGroupHint')}</p>
      {MOTION_TOGGLES.map(({ key, labelKey, testId, hintKey }) => (
        <div key={key} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block text-sm text-text">{t(labelKey)}</span>
            {hintKey && (
              <span className="mt-0.5 block text-xs text-text-muted">{t(hintKey)}</span>
            )}
          </span>
          <ToggleSwitch
            checked={motion[key]}
            label={t(labelKey)}
            testId={testId}
            onClick={() => setPref(key, !motion[key])}
          />
        </div>
      ))}
      {/* 系统音效（sound-prefs-store，motion-prefs 同款设备本地范式）。 */}
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="min-w-0">
          <span className="block text-sm text-text">{t('settings.sounds')}</span>
          <span className="mt-0.5 block text-xs text-text-muted">{t('settings.soundsHint')}</span>
        </span>
        <ToggleSwitch
          checked={soundsEnabled}
          label={t('settings.sounds')}
          testId="sounds-toggle"
          onClick={() => setSoundsEnabled(!soundsEnabled)}
        />
      </div>
    </section>
  )
}

function LanguageSection({ narrow = false }: { narrow?: boolean }) {
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
        narrow={narrow}
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
              <p className="text-text">{appDisplayName(app.id)}</p>
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
        <BrandLogo size={40} />
        <div>
          <p className="font-medium text-text">AgehaOS</p>
          <p className="font-mono text-[11px] text-text-muted">
            {t('settings.aboutVersion')} {appVersion} · {t('settings.aboutDescription')}
          </p>
        </div>
      </div>
    </section>
  )
}
