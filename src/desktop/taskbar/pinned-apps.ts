/**
 * Dock 常驻瓷贴与启动器 Pinned 区共用的常驻应用清单（Desktop Shell 3.0
 * STEP 8 上收为单一来源）：Dock 瓷贴（§32 修订 8 常驻化）与启动器
 * 「常驻」区（Search → Recent → Pinned → Categories 结构）消费同一份
 * 列表，禁止第二套硬编码。全部为真实已注册应用（拒绝装饰性谎言）；
 * 启动器侧另经 launcher-visibility 羽化呈现过滤（Dock 瓷贴维持原生
 * 深链语义，不做该过滤——见 Taskbar.tsx）。
 */
export const PINNED_APP_IDS = [
  'com.ageha.files',
  'com.ageha.notes',
  'com.ageha.calculator',
  'com.ageha.terminal',
  'com.ageha.store',
  'com.ageha.settings',
] as const
