import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import { RemoteAuthClient, setAuthProvider } from '@/core/auth'
import { systemAppLifecycle } from '@/core/runtime'
import { registerBuiltinApps, restoreInstalledApps } from '@/store/app-store'
// 设备快照 store（M0-2 Shell Selection）：App ready 分支依 shell 选择
// Mobile/Desktop；订阅（resize/orientationchange/matchMedia）在此启动。
import { initDeviceStore } from '@/store/device-store'
import { useSessionStore } from '@/store/session-store'
import { systemVfs } from '@/services/vfs'
import { systemDynamicDesktop } from '@/services/dynamic-desktop'
import { systemEclosion } from '@/services/eclosion'
import { startNotificationBridge } from '@/services/notification-bridge'
import { startSettingsSync } from '@/services/settings-sync'
import { startFileSync } from '@/services/file-sync'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// Remote auth mode (Milestone 5): any non-empty VITE_AUTH_BACKEND routes auth
// through the backend API on the same origin (dev proxy → :8787). Sessions
// become HttpOnly cookies (PRD §30.4); unset keeps the local provider.
if (import.meta.env.VITE_AUTH_BACKEND) {
  setAuthProvider(new RemoteAuthClient())
  void useSessionStore.getState().reconcile()
  startSettingsSync()
  // 云文件同步（PRD §35 Phase 3 文本切片）：与配置同步共用账户开关。
  startFileSync()
}

systemAppLifecycle.start()
registerBuiltinApps()
restoreInstalledApps()
systemVfs.ready().catch((error) => {
  console.error('[AgehaOS] VFS initialization failed', error)
})
// 动态桌面单例：追加在既有装配链之后，不改变启动顺序（设计文档 §3.2）。
systemDynamicDesktop.start()
// 系统事件 → 通知桥（PRD §16）：崩溃与生成失败转通知。
startNotificationBridge()
// 羽化编排器单例（AI-GENERATED-APPS-DESIGN §3.2）：装配链尾追加——登录联动、
// 额度拉取、空闲预取；任何 AI 环节失败都静默降级到原生兜底，不阻塞桌面。
systemEclosion.start()
// 设备快照 store（M0-2 Shell Selection）：装配链尾追加（仅客户端——main.tsx
// 本就只在浏览器运行，store 内部另有 window 缺失守卫）；以当前环境重测刷新
// 初始快照并挂 resize/orientationchange/matchMedia 订阅。
initDeviceStore()

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
