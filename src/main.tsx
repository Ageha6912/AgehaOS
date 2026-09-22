import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { systemAppLifecycle } from '@/core/runtime'
import { registerBuiltinApps } from '@/store/app-store'
import { systemVfs } from '@/services/vfs'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

systemAppLifecycle.start()
registerBuiltinApps()
systemVfs.ready().catch((error) => {
  console.error('[AgehaOS] VFS initialization failed', error)
})

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
