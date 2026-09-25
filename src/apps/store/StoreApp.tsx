import { useEffect, useState, type ReactNode } from 'react'

import { CheckCircle, Clock, PaintBrush, Trash, Download } from '@phosphor-icons/react'

import { useTranslation } from '@/core/i18n'
import { PermissionConsentDialog } from '@/components/permission-consent-dialog'
import { fetchSignedCatalog } from '@/core/apps/remote-catalog'
import { permissionManager } from '@/core/permissions'
import type { AppManifest } from '@/core/runtime/manifest'
import { launchApp } from '@/apps/launch'
import { installApp, uninstallApp, useAppStore } from '@/store/app-store'
import { STORE_CATALOG } from './catalog'

/**
 * App Store（PRD §26 P1 骨架 + §47 远端目录前置切片）：内置打包目录 + 签名远程
 * 目录（Ed25519 验签，失败整包忽略）。浏览 → 权限确认（Default Deny，§10.2）
 * → installApp 注册 → 持久化，重装系统后自动恢复。卸载同步遗忘权限（§10.3）。
 */

const SAMPLE_ICONS: Record<string, ReactNode> = {
  'com.ageha.samples.clock': <Clock size={20} weight="regular" />,
  'com.ageha.samples.sketch': <PaintBrush size={20} weight="regular" />,
}

interface StoreEntry {
  manifest: AppManifest
  remote: boolean
}

const BUILTIN_ENTRIES: StoreEntry[] = STORE_CATALOG.map((entry) => ({
  manifest: entry.manifest as AppManifest,
  remote: false,
}))

export function StoreApp() {
  const { t } = useTranslation()
  const apps = useAppStore((s) => s.apps)
  const [consenting, setConsenting] = useState<number | null>(null)
  const [remote, setRemote] = useState<{ status: 'loading' | 'ok' | 'invalid'; apps: AppManifest[] }>({
    status: 'loading',
    apps: [],
  })

  useEffect(() => {
    let cancelled = false
    void fetchSignedCatalog({
      pinnedPublicKeyBase64:
        (import.meta.env.VITE_STORE_CATALOG_PUBLIC_KEY as string | undefined)?.trim() || null,
    }).then((result) => {
      if (cancelled) return
      if (result.ok) setRemote({ status: 'ok', apps: result.apps })
      else setRemote({ status: 'invalid', apps: [] })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const entries: StoreEntry[] = [
    ...BUILTIN_ENTRIES,
    ...remote.apps.map((manifest) => ({ manifest, remote: true as const })),
  ]
  const installedIds = new Set(apps.map((app) => app.id))

  const install = (index: number) => {
    const entry = entries[index]
    if (!entry) return
    const result = installApp(entry.manifest)
    if (result.ok) {
      // 授权范围 = 用户在对话框确认的权限（consent → grant，§10.2/§10.3）。
      permissionManager.grantAll(result.manifest.id, result.manifest.permissions)
    }
    setConsenting(null)
  }

  return (
    <div className="flex h-full flex-col bg-surface text-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-text">{t('app.store.title')}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{t('store.hint')}</p>
        {remote.status === 'invalid' && (
          <p className="mt-1 text-xs text-warning" data-testid="store-remote-invalid">
            {t('store.remoteInvalid')}
          </p>
        )}
      </div>

      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {entries.map((entry, index) => {
          const installed = installedIds.has(entry.manifest.id)
          const installedApp = apps.find((app) => app.id === entry.manifest.id)
          return (
            <li
              key={entry.manifest.id}
              className="rounded-lg border border-border bg-surface-raised/50 p-3"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 text-text-muted">
                  {SAMPLE_ICONS[entry.manifest.id] ?? <Download size={20} weight="regular" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-text">
                    {entry.manifest.name}
                    <span className="rounded border border-border px-1 text-[10px] text-text-muted">
                      {t('store.webApp')}
                    </span>
                    {entry.remote && (
                      <span
                        className="rounded border border-primary/50 px-1 text-[10px] text-primary"
                        data-testid="store-remote-badge"
                      >
                        {t('store.remoteBadge')}
                      </span>
                    )}
                    {installed && (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle size={12} weight="fill" />
                        {t('store.installed')}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    v{installedApp?.version ?? entry.manifest.version} · {entry.manifest.author}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">{entry.manifest.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {installed ? (
                    <>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text hover:bg-surface-raised"
                        onClick={() => launchApp(entry.manifest.id)}
                      >
                        {t('store.open')}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t('store.uninstall')} ${entry.manifest.name}`}
                        title={t('store.uninstall')}
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-raised hover:text-danger"
                        onClick={() => uninstallApp(entry.manifest.id)}
                      >
                        <Trash size={13} weight="regular" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-contrast hover:opacity-90"
                      onClick={() => setConsenting(index)}
                    >
                      {t('store.install')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {consenting !== null && entries[consenting] && (
        <PermissionConsentDialog
          appName={entries[consenting].manifest.name}
          permissions={entries[consenting].manifest.permissions}
          onAllow={() => install(consenting)}
          onDeny={() => setConsenting(null)}
        />
      )}
    </div>
  )
}
