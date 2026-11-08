import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation, getLocale } from '@/core/i18n'
import { systemBus } from '@/core/events'
import {
  hostHelloMessage,
  isAllowedWebAppEntry,
  parseAppMessage,
  WEB_APP_SANDBOX,
} from '@/core/apps/web-app'
import { handleSdkRequest, parseSdkRequest, SDK_RESULT_TYPE } from '@/core/apps/sdk-bridge'
import { permissionManager } from '@/core/permissions'
import { useDynamicDesktopStore } from '@/store/dynamic-desktop-store'
import { useNotificationStore } from '@/store/notification-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { sdkFilePort } from '@/services/sdk-file-port'
import { version as appVersion } from '../../package.json'

export interface WebAppFrameProps {
  /** Manifest entry; must pass the same-origin allowlist (defense in depth). */
  entry: string
  appId: string
  windowId: string
  title: string
}

function themeOf(): 'light' | 'dark' {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark'
  }
  return 'light'
}

/**
 * Type B/C Web App 宿主（PRD §8.1、§30.3）：把通过来源 allowlist 的同源静态站点
 * 装进 `sandbox="allow-scripts"`（不透明 origin）的 iframe。
 *
 * - Type B：load 后发 `agehaos:hello` 握手，收到 ready 揭示加载遮罩。
 * - Type C：同一消息通道上承接 SDK 请求（`agehaos:sdk`），逐请求过
 *   Default Deny 权限门禁后执行并回执（`src/core/apps/sdk-bridge.ts`）。
 */
export function WebAppFrame({ entry, appId, windowId, title }: WebAppFrameProps) {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const allowed = isAllowedWebAppEntry(entry)

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // §30.3：消息必须来自这个 iframe 自己的 contentWindow。
      if (event.source !== iframeRef.current?.contentWindow) return

      if (parseAppMessage(event.data)) {
        setLoaded(true)
        return
      }

      const request = parseSdkRequest(event.data)
      if (request) {
        const source = event.source
        void handleSdkRequest(request, {
          appId,
          hasPermission: (permission) => permissionManager.has(appId, permission),
          onPermissionDenied: (permission) => {
            systemBus.emit('permission.denied', { appId, permission })
          },
          storage:
            typeof localStorage === 'undefined'
              ? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
              : localStorage,
          getTheme: themeOf,
          onTitle: (next) => useWindowStore.getState().setTitle(windowId, next),
          notify: (notification) => {
            // SDK 应用通知（PRD §17）：字面文本经桥清洗后进通知中心（toast + 历史）。
            useNotificationStore.getState().push({
              appId,
              title: notification.title,
              body: notification.body,
            })
          },
          fs: sdkFilePort,
          getUser: () => {
            const user = useSessionStore.getState().user
            return user ? { username: user.username, displayName: user.displayName ?? null } : null
          },
          getGrantedPermissions: () => permissionManager.grantedPermissions(appId),
          getSystemInfo: () => ({
            version: appVersion,
            locale: getLocale(),
            tier: useDynamicDesktopStore.getState().tier,
          }),
        }).then((response) => {
          source?.postMessage({ type: SDK_RESULT_TYPE, ...response }, '*')
        })
      }
    },
    [appId, windowId],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // entry 切换（同一实例复用于另一站点）：加载遮罩复位，配合 iframe key
  // 强制重挂——旧文档导航期间的 SDK 回执也不会落到新文档（E3 审查）。
  useEffect(() => {
    setLoaded(false)
  }, [entry])

  const onLoaded = useCallback(() => {
    setLoaded(true)
    // 握手第一步：文档加载完成后再发 hello，应用此时才注册了 listener。
    iframeRef.current?.contentWindow?.postMessage(hostHelloMessage(), '*')
  }, [])

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-text-muted">{t('webapp.blocked')}</p>
      </div>
    )
  }

  return (
    <div className="relative h-full bg-surface">
      <iframe
        key={entry}
        ref={iframeRef}
        src={entry}
        sandbox={WEB_APP_SANDBOX}
        title={title}
        className="h-full w-full border-0"
        onLoad={onLoaded}
      />
      {!loaded && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-surface"
          data-testid="web-app-loading"
        >
          <p className="text-sm text-text-muted">{t('webapp.loading')}</p>
        </div>
      )}
    </div>
  )
}
