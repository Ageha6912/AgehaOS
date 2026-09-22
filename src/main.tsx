import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { systemAppLifecycle } from '@/core/runtime'
import { registerBuiltinApps, restoreInstalledApps } from '@/store/app-store'
import { systemVfs } from '@/services/vfs'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

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
