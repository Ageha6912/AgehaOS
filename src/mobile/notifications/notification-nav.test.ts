import { describe, expect, it } from 'vitest'

import { notificationNavTarget } from './notification-nav'

/**
 * M4-2 通知点击跳转裁决纯函数（判定抽纯函数照手势家族纪律）：
 * - 无 targetAppId / 空串 → null（纯展示整条不可点，不伪造）；
 * - targetAppId 在册（可启动）→ 返回目标；
 * - targetAppId 已注销（L2 跨日 unregisterRuntimeApp 等真实边界）→ null，
 *   不给「点了必落空」的死跳。
 * isLaunchable 由调用方注入，测试用表驱动桩——生产侧传注册表解析
 * （MobileNotificationSheet 的 getAppManifest 门控）。
 */

const isLaunchable = (appId: string): boolean => appId === 'com.ageha.notes'

describe('notificationNavTarget', () => {
  it('无 targetAppId（载荷无 appId 的通知）→ null', () => {
    expect(notificationNavTarget({ targetAppId: undefined }, isLaunchable)).toBeNull()
  })

  it('空串 targetAppId → null（与缺席同判，防御存入脏值）', () => {
    expect(notificationNavTarget({ targetAppId: '' }, isLaunchable)).toBeNull()
  })

  it('targetAppId 在册可启动 → 返回目标 appId', () => {
    expect(notificationNavTarget({ targetAppId: 'com.ageha.notes' }, isLaunchable)).toBe(
      'com.ageha.notes',
    )
  })

  it('targetAppId 已注销（不可启动）→ null（退化为纯展示）', () => {
    expect(notificationNavTarget({ targetAppId: 'com.ageha.eclosion.gone' }, isLaunchable)).toBeNull()
  })
})
