import { useEffect, useState } from 'react'

import { AppIcon } from '@/apps/app-icon'
import { componentFor } from '@/apps/builtin'
import { launchApp } from '@/apps/launch'
import { useTranslation } from '@/core/i18n'
import { useAppStore } from '@/store/app-store'

/** 桌面固定顺序：常用生产力在前，设置垫底（Windows 惯例）。 */
const DESKTOP_APP_ORDER: readonly string[] = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.terminal',
  'com.ageha.store',
  'com.ageha.calculator',
  'com.ageha.dynamic.panel',
  'com.ageha.settings',
]

/**
 * 桌面图标层：左上角纵向网格，单击选中、双击/回车启动。
 *
 * 内置应用按固定顺序常驻；用户从商店安装的应用（含远程目录发布）排在
 * 其后，卸载即从桌面消失（随 app store 响应式更新）。
 *
 * 容器 pointer-events-none、按钮 auto——空白区域点击穿透到下层，
 * 不会挡住壁纸右键等未来的桌面交互；选中态在任意指针按下于
 * 图标之外时清除（含点在窗口/任务栏上的情况）。
 * 标签用白字 + 深色投影，明暗壁纸与照片壁纸下均可读。
 */
export function DesktopIcons() {
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('[data-desktop-icon]')) return
      setSelected(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const registered = new Map(apps.map((app) => [app.id, app]))
  const pinned = DESKTOP_APP_ORDER.filter((appId) => registered.has(appId)).map(
    (appId) => registered.get(appId) as (typeof apps)[number],
  )
  const installed = apps.filter((app) => !DESKTOP_APP_ORDER.includes(app.id))
  const entries = [...pinned, ...installed]

  const open = (appId: string): void => {
    launchApp(appId)
    setSelected(appId)
  }

  return (
    <nav
      aria-label={t('desktop.iconsLabel')}
      className="pointer-events-none absolute left-2 top-2 z-10 flex max-h-[calc(100%-1rem)] flex-col flex-wrap content-start gap-0.5"
    >
      {entries.map((app) => {
        const meta = componentFor(app.id)
        const name = meta ? t(meta.titleKey) : app.name
        const isSelected = selected === app.id
        return (
          <button
            key={app.id}
            type="button"
            data-desktop-icon
            data-testid={`desktop-icon-${app.id}`}
            aria-label={name}
            aria-pressed={isSelected}
            title={name}
            className="pointer-events-auto flex w-20 flex-col items-center gap-1 rounded-lg px-1 py-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setSelected(app.id)}
            onDoubleClick={() => open(app.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') open(app.id)
            }}
          >
            <AppIcon
              appId={app.id}
              size={40}
              className={isSelected ? 'outline-2 outline-primary' : undefined}
            />
            <span
              className={`max-w-full truncate rounded px-1 text-[11px] leading-4 drop-shadow-[0_1px_2px_rgba(9,16,32,0.85)] ${
                isSelected ? 'bg-primary text-primary-contrast' : 'text-white'
              }`}
            >
              {name}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
