import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * 浏览器代理的目标 URL 策略（SSRF 防护）：只放行「公网 http/https、默认端口、
 * 无内嵌凭据」的地址。域名目标在请求前做 DNS 解析，任一解析结果落在私网/
 * 保留段即整条拒绝（防 DNS 指向内网）；重定向每一跳都重新过闸。
 */

export class BrowsePolicyError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'BrowsePolicyError'
    this.status = status
    this.code = code
  }
}

/** 只允许默认端口与 80/443：把 SSRF 面收窄到 Web 面。 */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/** 198.18.0.0/15 基准测试段：TUN 代理（Clash 系）fake-IP 默认池所在段。 */
export function isBenchmarkIPv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (octets.some((value) => Number.isNaN(value) || value > 255)) return false
  return octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return true
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (octets.some((value) => Number.isNaN(value) || value > 255)) return true
  const [a, b] = octets as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true // 本机/私网/「this network」
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 169 && b === 254) return true // link-local / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 192 && b === 0) return true // 192.0.0/24 + TEST-NET-1
  if (isBenchmarkIPv4(ip)) return true // 198.18.0.0/15 基准测试网段
  if (a >= 224) return true // 组播/保留/广播
  return false
}

export function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase()
  if (addr === '::' || addr === '::1') return true
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 ULA
  if (/^fe[89ab]/.test(addr)) return true // fe80::/10 link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr)
  if (mapped?.[1] !== undefined) return isPrivateIPv4(mapped[1])
  return false
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

/** 主机名解析出口（测试注入）。返回该域名的全部地址。 */
export type ResolveHost = (hostname: string) => Promise<string[]>

const defaultResolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)

export interface AssertPublicUrlOptions {
  resolveHost?: ResolveHost
  /** 测试接缝：放行端口集（prod 恒为默认 + 80/443）。 */
  allowedPorts?: ReadonlySet<string>
  /**
   * 本地开发开关（AGEHA_BROWSE_TRUST_FAKE_IP=1，生产恒关）：放行 198.18.0.0/15
   * 基准段——TUN 代理（Clash 系）用该段做 fake-IP，本机全域名解析都会落在
   * 这里，不放行则本地开发时一切目标皆 403。回环/私网/元数据地址照拒。
   */
  allowBenchmarkRange?: boolean
}

/**
 * 过闸：合法则返回解析后的 URL，否则抛 BrowsePolicyError（status/code 直接
 * 可映射为 error page）。IP 字面量不上 DNS；域名必须解析且全部地址为公网。
 */
export async function assertPublicUrl(
  raw: string,
  options: AssertPublicUrlOptions = {},
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BrowsePolicyError(400, 'invalid-url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BrowsePolicyError(400, 'scheme-not-allowed')
  }
  if (url.username !== '' || url.password !== '') {
    throw new BrowsePolicyError(400, 'credentials-not-allowed')
  }
  if (!(options.allowedPorts ?? ALLOWED_PORTS).has(url.port)) {
    throw new BrowsePolicyError(403, 'port-not-allowed')
  }
  const host =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
  const allowBenchmark = options.allowBenchmarkRange === true
  const blockedAddress = (address: string): boolean =>
    allowBenchmark
      ? isPrivateAddress(address) && !isBenchmarkIPv4(address)
      : isPrivateAddress(address)
  if (isIP(host) !== 0) {
    if (blockedAddress(host)) throw new BrowsePolicyError(403, 'private-address')
    return url
  }
  const resolveHost = options.resolveHost ?? defaultResolveHost
  let addresses: string[]
  try {
    addresses = await resolveHost(host)
  } catch {
    throw new BrowsePolicyError(502, 'dns-failed')
  }
  if (addresses.length === 0) throw new BrowsePolicyError(502, 'dns-failed')
  if (addresses.some((address) => blockedAddress(address))) {
    throw new BrowsePolicyError(403, 'private-address')
  }
  return url
}
