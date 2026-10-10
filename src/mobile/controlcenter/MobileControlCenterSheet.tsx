import { useEffect, useRef, useState } from 'react'

import { SignOut } from '@phosphor-icons/react'

import { useLocaleStore, useTranslation } from '@/core/i18n'
import type { MessageKey } from '@/core/i18n'
import { useMotionPrefsStore } from '@/store/motion-prefs-store'
import { useSessionStore } from '@/store/session-store'
import type { FontSize, ThemePreference } from '@/store/settings-store'
import { useSettingsStore } from '@/store/settings-store'

/**
 * 移动控制中心（M2-3，HANDOFF §4.0-3）：Bottom Sheet 快捷设置面板——主题、
 * 字号、语言、减弱动效、登出，全部改既有 store 即全局生效（消费机制沿用
 * 既有，本组件零新引擎、零伪造开关）：
 * - 主题/字号 = settings-store setTheme/setFontSize（模块内 applyTheme /
 *   applyFontSize 写 documentElement，双 Shell 同源，SettingsApp 同一入口）；
 * - 语言 = settings-store.setLocale → core i18n localeStore（SettingsApp
 *   LanguageSection 同一入口；词典切换驱动全部 useTranslation 重渲染，
 *   含状态栏可访问名）；
 * - 减弱动效 = motion-prefs-store.windowTilt 的反相呈现（「减弱」开 =
 *   windowTilt 关：通知中心/启动器/AppHost 三处既有转场消费位全部直切，
 *   移动侧唯一有实效的动效布尔；glow/dockSheen/themeGlow/aurora 是桌面
 *   指针与画布效果、移动 Shell 无消费位，不摆出来伪造开关）。桌面
 *   Settings 呈现同一布尔的正相档「窗口切换转场」，移动侧按用户语义命名
 *   ——同一 store 布尔，两处呈现共享存储与实效；
 * - 减弱空间动效 = motion-prefs-store.spatialMotion 的反相呈现（2026-10-10
 *   空间化裁决 3/5：控制中心接空间动效开关属状态接线；桌面 Settings 呈现
 *   同一布尔的正相档「空间动效」——窗口深度与悬浮氛围动效总开关，纯桌面
 *   作用域，reduceMotion 同款反相先例）；
 * - 登出 = session-store.logout，与桌面 UserMenu 完全同行为（UserMenu
 *   .tsx:62-65：点按即 logout，无二次确认——先读桌面实现后对齐）；登出后
 *   App.tsx 的 phase 分支（ready + anonymous → login）自然回登录态，
 *   MobileShell 连同本 sheet 一起卸载，无额外跳转逻辑。
 *
 * 关闭路径（MobileLauncher/MobileNotificationSheet 同款切片契约）：backdrop
 * 点击与 Esc（document 捕获阶段）都回调 onClose——开关状态归持有方
 * （MobileStatusBar 入口按钮），关闭回焦入口。
 *
 * 过渡动效（DESIGN.md §35.5）：进出场 200ms 只动 transform/opacity（既有
 * token --ag-motion-base）；prefers-reduced-motion 由全局 0.01ms 塌缩承接
 * （不建第二套开关）；motion-prefs 转场关档走 .mobile-controlcenter-static
 * 直切——用户在本面板里开「减弱动效」时 sheet 当场转直切，所见即所得。
 *
 * 玻璃克制（DESIGN.md §35.1）：Bottom Sheet 是玻璃白名单五处之一——唯一
 * 玻璃层 = surface-glass 基底 + glass-raise（Dock/启动器/通知中心同档）；
 * backdrop 遮罩纯色压暗（零 blur）。触控纪律（§35.3）：选项 chip、动效
 * 开关整行、登出按钮命中区全部 ≥44px（桌面 Settings 的 h-8 chip 密度档
 * §28 不带入移动）。
 */

/** 退场渲染滞后 = 进出场时长；与 index.css 的 --ag-motion-base（200ms）同值。 */
const SHEET_TRANSITION_MS = 200

/** sheet 相位：closed = 不渲染；open = 在场；leaving = 退场帧（播完即卸载）。 */
type SheetPhase = 'closed' | 'open' | 'leaving'

/* 主题/字号选项与桌面 SettingsApp 外观段同一组词典键（单一来源，不另造键）。 */
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

/* 语言选项是语言本名（简体中文/English），双语言下恒定不译（SettingsApp
   LanguageSection 同口径），不入词典。 */
const LOCALE_OPTIONS: Array<{ value: 'zh-CN' | 'en'; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

/**
 * 分组选项行（桌面 SettingsApp OptionRow 的移动档）：chip 命中区 ≥44px
 * （min-h-[44px]），选中态 aria-pressed + primary 细边，视觉与桌面 OptionRow
 * 同一语言。
 */
function OptionGroup({
  label,
  testId,
  options,
  currentValue,
  onSelect,
}: {
  label: string
  testId: string
  options: Array<{ value: string; label: string }>
  currentValue: string
  onSelect: (value: string) => void
}) {
  return (
    <div>
      <p className="pb-1.5 text-xs text-text-muted">{label}</p>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {options.map((option) => {
          const active = currentValue === option.value
          return (
            <button
              key={option.value}
              type="button"
              data-testid={testId}
              data-value={option.value}
              aria-pressed={active}
              onClick={() => onSelect(option.value)}
              className={`min-h-[44px] flex-1 rounded-xl border px-2 text-sm transition-opacity active:opacity-80 ${
                active
                  ? 'border-primary bg-primary/10 font-medium text-text'
                  : 'border-border text-text-muted'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MobileControlCenterSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setFontSize = useSettingsStore((s) => s.setFontSize)
  const setLocalePref = useSettingsStore((s) => s.setLocale)
  const locale = useLocaleStore((s) => s.locale)
  const windowTilt = useMotionPrefsStore((s) => s.windowTilt)
  const spatialMotion = useMotionPrefsStore((s) => s.spatialMotion)
  const setPref = useMotionPrefsStore((s) => s.setPref)
  const logout = useSessionStore((s) => s.logout)

  // 「减弱动效」= windowTilt 反相呈现：开 = 转场直切（见模块注释）。
  const motionReduced = !windowTilt
  // 「减弱空间动效」= spatialMotion 反相呈现（reduceMotion 同款先例）。
  const spatialReduced = !spatialMotion

  // ── 开关状态机：与 MobileLauncher/MobileNotificationSheet 同款（open→false
  //    不经 null 空档，退场帧与原树同一 commit 接续；渲染期校正，重开即时
  //    恢复入场）。 ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<SheetPhase>(open ? 'open' : 'closed')
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('leaving')

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('closed'), SHEET_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // ── Esc 关闭：document 捕获阶段（切片契约同款，不参与桌面 popover-store
  //    互斥）；onClose 走 ref 免监听重挂；只在 open 相位监听。 ─────────────
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (phase !== 'open') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  if (phase === 'closed') return null

  const signOut = (): void => {
    // 桌面 UserMenu 同序：先收面板再 logout（无二次确认，行为对齐）；
    // 登出后 App.tsx phase 分支自然回登录态，本 sheet 随 MobileShell 卸载。
    onClose()
    void logout()
  }

  return (
    <div
      data-testid="mobile-control-center"
      data-state={phase}
      aria-hidden={phase === 'leaving' ? true : undefined}
      className={`mobile-controlcenter fixed inset-0 z-20 ${
        phase === 'leaving' ? 'pointer-events-none' : ''
      } ${windowTilt ? '' : 'mobile-controlcenter-static'}`}
    >
      {/* backdrop：纯色压暗遮罩（零 blur，非玻璃面），点击关闭。 */}
      <div
        data-testid="mobile-control-center-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="mobile-controlcenter-backdrop absolute inset-0"
      />
      {/* sheet：玻璃白名单五处之一的 Bottom Sheet 位（§35.1）——surface-glass
          基底 + glass-raise（Dock/通知中心同档 blur 20px），顶部发丝边；锚底
          升出，上限 80% 视口给 Home 留呼吸。 */}
      <div
        data-testid="mobile-control-center-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.controlcenter.open')}
        className="mobile-controlcenter-sheet surface-glass glass-raise absolute inset-x-0 bottom-0 flex max-h-[80%] flex-col rounded-t-2xl border-t"
        style={{ borderColor: 'var(--ag-border-subtle)' }}
      >
        {/* 抓手条：纯装饰（aria-hidden），Bottom Sheet 的形态语言。 */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
          style={{ backgroundColor: 'var(--ag-border-strong)' }}
        />
        <div className="flex shrink-0 items-center px-4 pb-1 pt-2">
          <p className="text-sm font-semibold text-text">
            {t('mobile.controlcenter.open')}
          </p>
        </div>
        {/* 内容滚动容器：overscroll-contain 防滚动链传给壳根（与
            .mobile-content-scroll 同口径）。 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-5 pt-1">
          <OptionGroup
            label={t('settings.theme')}
            testId="mobile-control-theme-option"
            options={THEME_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            currentValue={theme}
            onSelect={(value) => setTheme(value as ThemePreference)}
          />
          <OptionGroup
            label={t('settings.fontSize')}
            testId="mobile-control-fontsize-option"
            options={FONT_SIZE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            currentValue={fontSize}
            onSelect={(value) => setFontSize(value as FontSize)}
          />
          <OptionGroup
            label={t('settings.language')}
            testId="mobile-control-locale-option"
            options={LOCALE_OPTIONS}
            currentValue={locale}
            onSelect={(value) => setLocalePref(value as 'zh-CN' | 'en')}
          />
          {/* 减弱动效：整行 = switch（role/aria-checked 与桌面 ToggleSwitch
              同一可访问性契约），命中区 ≥44px；药丸只是行内装饰位。 */}
          <button
            type="button"
            role="switch"
            data-testid="mobile-control-motion-switch"
            aria-checked={motionReduced}
            onClick={() => setPref('windowTilt', motionReduced)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-1 text-left transition-opacity active:opacity-80"
          >
            <span className="text-sm text-text">
              {t('mobile.controlcenter.reduceMotion')}
            </span>
            <span
              aria-hidden="true"
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                motionReduced ? 'bg-primary' : 'border border-border bg-surface-raised'
              }`}
            >
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-[left] ${
                  motionReduced
                    ? 'left-[calc(100%-1.125rem)] bg-primary-contrast'
                    : 'left-0.5 bg-text-muted/60'
                }`}
              />
            </span>
          </button>
          {/* 减弱空间动效：spatialMotion 反相呈现（reduceMotion 同款整行
              switch 契约，aria-checked 语义与本行文案一致）；桌面 Settings
              呈现同一布尔的正相档「空间动效」，两处共享存储与实效。 */}
          <button
            type="button"
            role="switch"
            data-testid="mobile-control-spatial-motion-switch"
            aria-checked={spatialReduced}
            onClick={() => setPref('spatialMotion', spatialReduced)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-1 text-left transition-opacity active:opacity-80"
          >
            <span className="text-sm text-text">
              {t('mobile.controlcenter.reduceSpatialMotion')}
            </span>
            <span
              aria-hidden="true"
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                spatialReduced ? 'bg-primary' : 'border border-border bg-surface-raised'
              }`}
            >
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-[left] ${
                  spatialReduced
                    ? 'left-[calc(100%-1.125rem)] bg-primary-contrast'
                    : 'left-0.5 bg-text-muted/60'
                }`}
              />
            </span>
          </button>
          {/* 登出：整宽 44px 按钮，无二次确认（桌面 UserMenu 同行为）；收面板
              + logout 两步，登出后 App.tsx phase 分支接管回登录态。 */}
          <div className="border-t border-border pt-2">
            <button
              type="button"
              data-testid="mobile-control-logout"
              onClick={signOut}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-text transition-opacity active:opacity-80"
            >
              <SignOut size={16} weight="regular" aria-hidden="true" />
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
