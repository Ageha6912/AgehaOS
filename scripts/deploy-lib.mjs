// deploy-lib.mjs — 部署脚本的纯函数层（可被 node --test 直接单测）。
// 编排层在 deploy.mjs；约定见 HANDOFF.md 的部署入口一节。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** 解析 .env.production（KEY=VALUE 行，# 注释）；缺失必填键时抛出带指引的错误。 */
export function loadEnvProduction(envFile, requiredKeys = ['VITE_AUTH_BACKEND', 'VITE_STORE_CATALOG_PUBLIC_KEY']) {
  let text
  try {
    text = readFileSync(envFile, 'utf8')
  } catch {
    throw new Error(
      `缺少 ${envFile}。请创建该文件（已在 .gitignore 覆盖，永不提交），内容至少包含：\n` +
        requiredKeys.map((k) => `${k}=...`).join('\n'),
    )
  }
  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  const missing = requiredKeys.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(`${envFile} 缺少必填键：${missing.join(', ')}`)
  }
  return env
}

/** ADR 18 keyId 口径：sha256(raw 公钥 32 字节) 的前 16 个 hex 字符。 */
export function keyIdFromPin(pin) {
  const raw = Buffer.from(pin, 'base64')
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

/** pin 形状校验：Ed25519 raw 公钥 = 32 字节 base64（44 字符含一个尾部 =）。 */
export function assertHealthyEnvShape(env) {
  const pin = env.VITE_STORE_CATALOG_PUBLIC_KEY ?? ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(pin) || Buffer.from(pin, 'base64').length !== 32) {
    throw new Error(
      `VITE_STORE_CATALOG_PUBLIC_KEY 不像 Ed25519 raw 公钥（应为 32 字节 base64，44 字符）——` +
        '照抄了截断/改写过的 pin 会构建出验签必挂的包（评审 P1-3 手抄错误条目）。',
    )
  }
  return true
}

/** 断言 bundle 内容包含全部特征标记（pin 在内）；返回缺失清单，空数组 = 通过。 */
export function missingBundleMarkers(bundleJs, markers) {
  return markers.filter((m) => !bundleJs.includes(m))
}

/** 从构建产物 index.html 提取引用的 bundle/css 文件名（相对 assets/）。 */
export function extractAssetNames(indexHtml) {
  const js = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(indexHtml)?.[1] ?? null
  const css = /assets\/(index-[A-Za-z0-9_-]+\.css)/.exec(indexHtml)?.[1] ?? null
  if (js === null || css === null) {
    throw new Error('dist/index.html 未引用预期的 index-*.js / index-*.css，构建产物异常')
  }
  return { js, css }
}

/** 发布目录名（时间戳）按字典序即时间序；返回旧→新排序，可挑出回滚目标。 */
export function sortReleases(names) {
  return [...names].sort()
}

/** 给定当前指向的 release 与全部 release 名，返回回滚目标（时间序上紧邻的上一个）。 */
export function pickPreviousRelease(current, names) {
  const sorted = sortReleases(names)
  const idx = sorted.indexOf(current)
  if (idx <= 0) return null
  return sorted[idx - 1]
}

/** Caddyfile 是否仍含 os.ageha.cn 站点块且首页带 no-cache（坑 70 核验口径）。 */
export function caddyOsBlockHealthy(caddyfileText) {
  const hasBlock = /^[\s\S]*?os\.ageha\.cn\s*\{/m.test(caddyfileText)
  const osBlock = /os\.ageha\.cn\s*\{[\s\S]*?(?=\n\s*[\w.*-]+\s*\{|\s*$)/.exec(caddyfileText)?.[0] ?? ''
  return hasBlock && osBlock.includes('no-cache')
}

/** 把目录清单 {相对路径: sha256} 的差集算出来；返回有差异的路径列表。 */
export function changedPaths(prev, next) {
  const paths = new Set([...Object.keys(prev), ...Object.keys(next)])
  return [...paths].filter((p) => prev[p] !== next[p]).sort()
}

/** 供编排层拼 tar 文件清单：exclude 必须前置（坑 64）。 */
export function tarFileArgs() {
  return ['--exclude=server/data', 'dist', 'src', 'server', 'public', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json']
}

export const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
