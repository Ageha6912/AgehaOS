import type { NotificationItem } from '@/store/notification-store'

/**
 * 通知点击跳转裁决（M4-2，判定抽纯函数照手势家族纪律）：通知项带
 * targetAppId（桥从 app.crashed / eclosion.app.failed 载荷存入的跳转目标，
 * notification-store.ts 字段注释）且目标应用在册可启动（getAppManifest 非
 * null——launchApp 的同一解析面）才算可跳转；否则返回 null，行渲染为纯展
 * 示整条不可点（不伪造）。
 *
 * 注册表门控兜住真实边界：L2 今日应用跨日/登出会被 unregisterRuntimeApp
 * 注销（services/eclosion.ts），历史通知里的目标可能已不可启动——此时按
 * 「没有的能力不做按钮」退化为纯展示，点击不产生死跳（AppHost launchApp
 * null 回 Home 的静默失败不该由用户踩出来）。
 */

export function notificationNavTarget(
  item: Pick<NotificationItem, 'targetAppId'>,
  /** 目标可启动判定（调用方注入 = 纯函数可单测；生产传注册表解析）。 */
  isLaunchable: (appId: string) => boolean,
): string | null {
  const target = item.targetAppId
  if (target === undefined || target === '') return null
  return isLaunchable(target) ? target : null
}
