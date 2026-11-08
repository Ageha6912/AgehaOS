// deploy-lib.mjs — 部署脚本的纯函数层（可被 node --test 直接单测）。
// 编排层在 deploy.mjs；约定见 HANDOFF.md 的部署入口一节。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 解析 .env.production（KEY=VALUE 行，# 注释）；缺失必填键时抛出带指引的错误。 */
export function loadEnvProduction(
  envFile,
  requiredKeys = ['VITE_AUTH_BACKEND', 'VITE_STORE_CATALOG_PUBLIC_KEY'],
) {
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

/** 运行时备份目录（按 release 隔离；只含 src / server/src / server/test 与 manifests）。 */
function runtimeBackupDir(remote, release) {
  return `${remote}/.deploy-backup/${release}`
}

/**
 * 运行时同步脚本：**先备份再删除**——`rm -rf src server/src server/test` 之后
 * 任一步失败（缺文件/磁盘满/权限）都会留下不可重启的后端；调用方在非 0 时
 * 必须跑 runtimeRestoreScript。
 */
export function runtimeSyncScript(remote, release) {
  const backup = runtimeBackupDir(remote, release)
  return (
    `set -e; cd ${remote} && mkdir -p ${backup}/server && ` +
    `cp -a src ${backup}/ && ` +
    `cp -a server/src server/test ${backup}/server/ && ` +
    `cp -a package.json package-lock.json ${backup}/ && ` +
    `cp releases/${release}/package.json releases/${release}/package-lock.json . && ` +
    `rm -rf src server/src server/test && ` +
    `cp -r releases/${release}/src . && ` +
    `cp -r releases/${release}/server/src releases/${release}/server/test server/ && ` +
    `find releases/${release}/server -maxdepth 1 -type f -exec cp {} server/ \\; && ` +
    `chown -R agehaos:agehaos src server package.json package-lock.json`
  )
}

/** 同步失败后的恢复脚本：回滚运行时文件并重启后端（备份缺失时 set -e 直接失败）。 */
export function runtimeRestoreScript(remote, release) {
  const backup = runtimeBackupDir(remote, release)
  return (
    `set -e; cd ${remote} && ` +
    `rm -rf src server/src server/test && ` +
    `cp -a ${backup}/src . && ` +
    `cp -a ${backup}/server/src ${backup}/server/test server/ && ` +
    `cp -a ${backup}/package.json ${backup}/package-lock.json . && ` +
    `chown -R agehaos:agehaos src server package.json package-lock.json && ` +
    `systemctl restart agehaos`
  )
}

/**
 * 回滚脚本：切 dist 符号链接，并在目标 release 带运行时快照时一并恢复
 * server/src（旧版回滚工具只切前端，修不了「后端可运行但不可重启」）。
 */
export function rollbackScript(remote, target) {
  return (
    `set -e; cd ${remote} && ` +
    `ln -sfn "${remote}/releases/${target}/dist" "${remote}/.dist-switch" && mv -Tf "${remote}/.dist-switch" "${remote}/dist" && ` +
    `if [ -d releases/${target}/server/src ]; then ` +
    `rm -rf src server/src server/test && ` +
    `cp -r releases/${target}/src . && ` +
    `cp -r releases/${target}/server/src releases/${target}/server/test server/ && ` +
    `find releases/${target}/server -maxdepth 1 -type f -exec cp {} server/ \\; && ` +
    `cp releases/${target}/package.json releases/${target}/package-lock.json . && ` +
    `chown -R agehaos:agehaos src server package.json package-lock.json && ` +
    `systemctl restart agehaos; ` +
    `fi && ` +
    `curl -s -o /dev/null -w "%{http_code}" --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/`
  )
}

/** 把目录清单 {相对路径: sha256} 的差集算出来；返回有差异的路径列表。 */
export function changedPaths(prev, next) {
  const paths = new Set([...Object.keys(prev), ...Object.keys(next)])
  return [...paths].filter((p) => prev[p] !== next[p]).sort()
}

/** 供编排层拼 tar 文件清单：exclude 必须前置（坑 64）。 */
export function tarFileArgs() {
  return [
    '--exclude=server/data',
    'dist',
    'src',
    'server',
    'public',
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
  ]
}
