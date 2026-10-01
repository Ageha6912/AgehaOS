/**
 * 应用启动深链意图（§32 参考图对齐）：左栏「用户中心/回收站」等入口需要
 * 带「打开即定位」语义启动应用，而 launchApp 的窗口选项不含应用参数——
 * 这里用模块级一次性意图承载（launch 前写入、目标应用挂载时取走即清），
 * 不改动 window-store 数据结构。多实例窗口各自消费一次；未消费时零影响。
 */

export type SettingsSectionIntent = 'account' | 'appearance' | 'dynamic'

let settingsSection: SettingsSectionIntent | null = null
let filesTrash = false

/** 请求下一次 Settings 启动直接落在指定分区。 */
export function requestSettingsSection(section: SettingsSectionIntent): void {
  settingsSection = section
}

/** 目标应用挂载时消费（取走即清；null = 无意图，走默认分区）。 */
export function consumeSettingsSection(): SettingsSectionIntent | null {
  const value = settingsSection
  settingsSection = null
  return value
}

/** 请求下一次 Files 启动直接进入回收站视图。 */
export function requestFilesTrash(): void {
  filesTrash = true
}

/** 目标应用挂载时消费（取走即清）。 */
export function consumeFilesTrash(): boolean {
  const value = filesTrash
  filesTrash = false
  return value
}

/** 测试隔离：清空全部未消费意图。 */
export function resetAppDeepLinks(): void {
  settingsSection = null
  filesTrash = false
}
