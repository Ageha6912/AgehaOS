/**
 * 宿主平台探测（框架无关）：只用于快捷键提示文案——Ctrl+K 与 ⌘K 在
 * use-global-shortcuts 中同时生效，提示按平台显示惯用写法。
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** 主修饰键 + 键名提示：Apple 平台 `⌘K`，其余 `Ctrl+K`。 */
export function shortcutLabel(key: string, apple: boolean = isApplePlatform()): string {
  return apple ? `⌘${key}` : `Ctrl+${key}`
}

/** Alt/Option 修饰键提示：Apple 平台 `⌥W`，其余 `Alt+W`。 */
export function altShortcutLabel(key: string, apple: boolean = isApplePlatform()): string {
  return apple ? `⌥${key}` : `Alt+${key}`
}

/** 重做的平台惯例：Apple `⇧⌘Z`，其余 `Ctrl+Y`。 */
export function redoShortcutLabel(apple: boolean = isApplePlatform()): string {
  return apple ? '⇧⌘Z' : 'Ctrl+Y'
}
