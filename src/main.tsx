import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { RemoteAuthClient, setAuthProvider } from '@/core/auth'
import { systemAppLifecycle } from '@/core/runtime'
import { registerBuiltinApps, restoreInstalledApps } from '@/store/app-store'
import { useSessionStore } from '@/store/session-store'
import { systemVfs } from '@/services/vfs'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// Remote auth mode (Milestone 5): any non-empty VITE_AUTH_BACKEND routes auth
// through the backend API on the same origin (dev proxy → :8787). Sessions
// become HttpOnly cookies (PRD §30.4); unset keeps the local provider.
if (import.meta.env.VITE_AUTH_BACKEND) {
  setAuthProvider(new RemoteAuthClient())
  void useSessionStore.getState().reconcile()
}

systemAppLifecycle.start()
registerBuiltinApps()
restoreInstalledApps()
systemVfs.ready().catch((error) => {
  console.error('[AgehaOS] VFS initialization failed', error)
})
// 动态桌面单例：追加在既有装配链之后，不改变启动顺序（设计文档 §3.2）。
systemDynamicDesktop.start()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
