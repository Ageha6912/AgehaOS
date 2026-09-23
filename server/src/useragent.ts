/** 短设备标签（设备管理用）：从 User-Agent 提取浏览器 + 系统，绝不存整段 UA。 */
export function describeUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//u.test(ua)
    ? 'Edge'
    : /OPR\//u.test(ua)
      ? 'Opera'
      : /Chrome\//u.test(ua)
        ? 'Chrome'
        : /Firefox\//u.test(ua)
          ? 'Firefox'
          : /Safari\//u.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /Windows/u.test(ua)
    ? 'Windows'
    : /Mac OS X/u.test(ua)
      ? 'macOS'
      : /Android/u.test(ua)
        ? 'Android'
        : /iPhone|iPad/u.test(ua)
          ? 'iOS'
          : /Linux/u.test(ua)
            ? 'Linux'
            : 'Unknown OS'
  return `${browser} · ${os}`
}
