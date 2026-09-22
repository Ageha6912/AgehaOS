import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import { systemBus } from '@/core/events'
import {
  hostHelloMessage,
  isAllowedWebAppEntry,
  parseAppMessage,
  WEB_APP_SANDBOX,
} from '@/core/apps/web-app'
import { handleSdkRequest, parseSdkRequest, SDK_RESULT_TYPE } from '@/core/apps/sdk-bridge'
import { permissionManager } from '@/core/permissions'
import { useWindowStore } from '@/store/window-store'

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
        const response = handleSdkRequest(request, {
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
        })
        event.source?.postMessage({ type: SDK_RESULT_TYPE, ...response }, '*')
      }
    },
    [appId, windowId],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

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
