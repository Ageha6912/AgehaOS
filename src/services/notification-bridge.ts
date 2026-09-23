import { systemBus } from '@/core/events'
import { useAppStore } from '@/store/app-store'
import { useNotificationStore } from '@/store/notification-store'

/**
 * 系统事件 → 通知桥（PRD §16）：把少量「用户应当知道」的系统事件转成通知。
 * 只挑高价值事件——崩溃与生成失败；高频事件（file.*、窗口事件）绝不入通知，
 * 避免通知疲劳。
 */

let started = false

/** 幂等启动：重复调用不重复订阅（main.tsx 只会调一次；测试兜底）。 */
export function startNotificationBridge(): void {
  if (started) return
  started = true

  systemBus.on('app.crashed', ({ appId }) => {
    const app = useAppStore.getState().apps.find((candidate) => candidate.id === appId)
    useNotificationStore.getState().push({
      appId: 'system',
      titleKey: 'notification.title.appCrashed',
      bodyKey: 'notification.body.appCrashed',
      bodyParams: { app: app?.name ?? appId },
      priority: 'critical',
    })
  })

  systemBus.on('desktop.generation.failed', () => {
    useNotificationStore.getState().push({
      appId: 'system',
      titleKey: 'notification.title.wallpaperFailed',
      bodyKey: 'notification.body.wallpaperFailed',
    })
  })
}
