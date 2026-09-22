import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from '@/core/i18n'
import {
  hostHelloMessage,
  isAllowedWebAppEntry,
  parseAppMessage,
  WEB_APP_SANDBOX,
} from '@/core/apps/web-app'

export interface WebAppFrameProps {
  /** Manifest entry; must pass the same-origin allowlist (defense in depth). */
  entry: string
  title: string
}

/**
 * Type B Web App 宿主（PRD §8.1、§30.3）：把通过来源 allowlist 的同源静态站点
 * 装进 `sandbox="allow-scripts"`（不透明 origin）的 iframe；load 后发送握手消息，
 * 只接受来自该 iframe 自身（event.source 严格相等）且通过 schema 校验的回包。
 */
export function WebAppFrame({ entry, title }: WebAppFrameProps) {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const allowed = isAllowedWebAppEntry(entry)

  const handleMessage = useCallback((event: MessageEvent) => {
    // §30.3：消息必须来自这个 iframe 自己的 contentWindow。
    if (event.source !== iframeRef.current?.contentWindow) return
    // 应用主动握手也算就绪（load 事件之前的加速路径）。
    if (parseAppMessage(event.data)) setLoaded(true)
  }, [])

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
