import type { TimePhase } from '../types'

/**
 * 种子系统（设计文档 §6.1）：可复现、可回滚。
 *
 * 生成路径禁止裸 `Math.random()`，一切随机源自显式种子：
 *   sessionSeed = SHA-256(userId | 本地日期 | 会话计数)
 *   domainSeed  = SHA-256(sessionSeed | 域名 | 序号 | contextVersion)
 * 同一三元组 (seed, generatorVersion, templateId) 恒定产出同一结果，
 * 历史回滚 = 重放历史三元组（Phase A 位图不落盘，重放即恢复）。
 */

/** 同步 SHA-256（纯 TS，输出小写 hex）。选同步实现保证决策管线为纯函数、可快照断言。 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const padded = padMessage(bytes)
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const K = SHA256_K
  const w = new Uint32Array(64)

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4
      w[i] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
    H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0
    H[7] = (H[7] + h) >>> 0
  }
  let hex = ''
  for (const word of H) hex += word.toString(16).padStart(8, '0')
  return hex
}

function padMessage(bytes: Uint8Array): Uint8Array {
  const bitLenHi = Math.floor(bytes.length / 0x20000000)
  const bitLenLo = (bytes.length << 3) >>> 0
  const totalLen = bytes.length + 1 + 8
  const blocks = Math.ceil(totalLen / 64)
  const padded = new Uint8Array(blocks * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLenHi)
  dv.setUint32(padded.length - 4, bitLenLo)
  return padded
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** mulberry32：确定性 32 位 PRNG（§4.3），返回 [0,1)。 */
export function mulberry32(seed: string): () => number {
  let a = 0
  for (let i = 0; i < seed.length; i++) {
    a = (a + seed.charCodeAt(i) * (i + 1)) >>> 0
  }
  // 混合一次，避免低位未充分扩散。
  a = (a + 0x6d2b79f5) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 本地日期键（YYYY-MM-DD），种子按「同用户同日确定」（§6.1）。 */
export function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function deriveSessionSeed(userId: string, now: Date, sessionCounter: number): string {
  return sha256Hex(`${userId}|${localDateKey(now)}|${sessionCounter}`)
}

export function deriveDomainSeed(
  sessionSeed: string,
  domain: string,
  attempt: number,
  contextVersion: number,
): string {
  return sha256Hex(`${sessionSeed}|${domain}|${attempt}|${contextVersion}`)
}

/** 本地时间四相（§2.1：晨/昼/暮/夜）。 */
export function timePhaseOf(hour: number): TimePhase {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}
