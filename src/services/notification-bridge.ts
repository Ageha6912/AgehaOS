import { systemBus } from '@/core/events'
import { getLocale, translate } from '@/core/i18n'
import { eclosionAppKind, findEclosionSpecByAppId } from '@/core/eclosion/spec'
import { useAppStore } from '@/store/app-store'
import { useEclosionStore } from '@/store/eclosion-store'
import { useNotificationStore } from '@/store/notification-store'

/**
 * 系统事件 → 通知桥（PRD §16）：把少量「用户应当知道」的系统事件转成通知。
 * 只挑高价值事件——崩溃与生成失败；高频事件（file.*、窗口事件）绝不入通知，
 * 避免通知疲劳。
 *
 * 羽化（AI-GENERATED-APPS-DESIGN §3.2）：只桥接 eclosion.app.failed（重试后
 * 仍失败、已回落原生才发）与「今日世界已就绪」（每个 worldDate 至多一条，
 * 去重态在 eclosion-store；生成进度/首次失败不进通知）。
 *
 * M4-2 通知点击跳转：事件载荷携带 appId 的（app.crashed / eclosion.app.failed）
 * 把它存为通知项的 targetAppId——移动通知中心据此渲染可点击跳转样式；
 * desktop.generation.failed / eclosion.world.ready 载荷无 appId，通知保持
 * 纯展示整条不可点（不伪造）。permission.denied 载荷虽带 appId，但本桥
 * 不消费该事件（无对应通知），无可跳转项。
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
      targetAppId: appId,
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

  // 羽化应用终态失败（重试后仍失败）：应用名优先取规格标题键（三件套
  // manifest.name 是非本地化回落，仅兜底）。L1 已回落原生（「已回落经典版」）；
  // L2/L3 没有原生真身，宿主呈错误卡（措辞不带「回落」）。
  systemBus.on('eclosion.app.failed', ({ appId }) => {
    const spec = findEclosionSpecByAppId(appId)
    const registered = useAppStore.getState().apps.find((candidate) => candidate.id === appId)
    const app = spec ? translate(getLocale(), spec.titleKey) : (registered?.name ?? appId)
    const basic = eclosionAppKind(appId) === 'basic'
    useNotificationStore.getState().push({
      appId: 'system',
      targetAppId: appId,
      titleKey: 'notification.title.eclosionAppFailed',
      bodyKey: basic
        ? 'notification.body.eclosionAppFailed'
        : 'notification.body.eclosionAppFailedNoFallback',
      bodyParams: { app },
    })
  })

  // 今日世界就绪（§3.2 通知中心）：每 worldDate 至多一条（跨日/个人重生成
  // 的重播事件不重复打扰；去重态由 eclosion-store 持有，登出清空）。
  systemBus.on('eclosion.world.ready', ({ worldDate }) => {
    if (useEclosionStore.getState().notifiedWorldDate === worldDate) return
    useEclosionStore.getState().markWorldNotified(worldDate)
    useNotificationStore.getState().push({
      appId: 'system',
      titleKey: 'notification.title.worldReady',
      bodyKey: 'notification.body.worldReady',
    })
  })
}
