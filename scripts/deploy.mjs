#!/usr/bin/env node
// deploy.mjs — AgehaOS 一键部署（评审 2026-10-02 P1-3：替代手工 tar 流程）。
//
// 用法：
//   npm run deploy                          # 构建 + 上传 + 原子切换 + 六点核验
//   npm run deploy -- --marker glass-popover [--marker ag-dock-gap]
//   npm run deploy -- --env-file .env.deploy.local   # 默认 .env.deploy
//   npm run deploy:rollback                 # 回滚到上一个 release 并核验
//
// 服务器布局：/opt/agehaos/releases/<时间戳>/ 为版本化产物；/opt/agehaos/dist
// 为指向当前 release/dist 的符号链接（Caddy 零改动）；后端运行时仍在
// /opt/agehaos 根（node_modules + server/data 不动）。
//
// ⚠️ env 文件命名铁律：必须用 .env.deploy 这类 Vite 不加载的名字——
// .env.production/.env.local 等约定名会被 vite build 自动读取，VITE_ 前缀
// 变量会泄进客户端 bundle（2026-10-02 事故：E2E 干净构建被污染 19/19 全挂）。

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  assertHealthyEnvShape,
  changedPaths,
  extractAssetNames,
  keyIdFromPin,
  loadEnvProduction,
  missingBundleMarkers,
  pickPreviousRelease,
  tarFileArgs,
} from './deploy-lib.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const SSH_HOST = 'ageha-hk'
const REMOTE = '/opt/agehaos'
const CADDYFILE = '/etc/caddy-tsuki/Caddyfile'
const KEEP_RELEASES = 3

// main 守卫：作为模块被导入（如测试扫描）时不执行部署逻辑；纯函数都在 deploy-lib.mjs。
function main() {
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const hasFlag = (name) => args.includes(name)

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', cwd: ROOT, ...opts })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** SSH 统一 ConnectTimeout=15 + 3 次重试（环境网络抖动，坑：TUN 代理偶发超时）。 */
function ssh(script, { input = null } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync('ssh', ['-o', 'ConnectTimeout=15', SSH_HOST, script], {
      encoding: 'utf8',
      input,
    })
    if (r.status === 0) return { code: 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
    const connectFail = /Connection timed out|Connection refused|Could not resolve/i.test(r.stderr ?? '')
    console.error(`ssh 第 ${attempt} 次失败${connectFail ? '（连接超时）' : ''}：${(r.stderr ?? '').trim().slice(0, 200)}`)
    if (!connectFail || attempt === 3) return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
  }
}

function fail(message) {
  console.error(`\n[deploy] 失败：${message}`)
  process.exit(1)
}

const log = (m) => console.log(`[deploy] ${m}`)

// ── 回滚模式 ────────────────────────────────────────────────────────────────
if (hasFlag('--rollback')) {
  const probe = ssh('readlink /opt/agehaos/dist && ls -1 /opt/agehaos/releases/')
  if (probe.code !== 0) fail('无法读取服务器 release 列表')
  const lines = probe.stdout.trim().split('\n')
  // readlink 输出形如 /opt/agehaos/releases/<时间戳>/dist——取倒数第二段。
  const current = lines[0]?.trim().split('/').filter(Boolean).slice(-2, -1)[0] ?? ''
  const releases = lines.slice(1).filter((n) => n && n !== 'legacy')
  const target = pickPreviousRelease(current, releases)
  if (target === null) fail(`没有可回滚的更早 release（当前 ${current}）`)
  log(`回滚 ${current} → ${target}`)
  const rollback = ssh(
    `set -e; ln -sfn "${REMOTE}/releases/${target}/dist" "${REMOTE}/.dist-switch" && mv -Tf "${REMOTE}/.dist-switch" "${REMOTE}/dist"` +
      ` && curl -s -o /dev/null -w "%{http_code}" --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/`,
  )
  const httpOk = rollback.stdout.trim().endsWith('200')
  if (rollback.code !== 0 || !httpOk) fail(`回滚后核验未过（HTTP ${rollback.stdout.trim()}）`)
  log(`回滚完成，HTTPS 200。当前 release = ${target}`)
  process.exit(0)
}

// ── 部署模式 ────────────────────────────────────────────────────────────────
const envFile = flag('--env-file') ?? '.env.deploy'
const markers = args.includes('--marker') ? args.filter((a, i) => args[i - 1] === '--marker') : []

let env
try {
  env = loadEnvProduction(path.join(ROOT, envFile))
  assertHealthyEnvShape(env)
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
const expectedKeyId = keyIdFromPin(env.VITE_STORE_CATALOG_PUBLIC_KEY)
log(`pin keyId = ${expectedKeyId}；特征标记 = [${markers.join(', ') || '无'}]`)

// 1. 清洁构建（先删 dist，杜绝旧 bundle 累积）。
log('清洁构建（rm dist && npm run build，带 pin）…')
rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true })
const build = sh('npm', ['run', 'build'], {
  shell: true, // Windows 上 npm 是 npm.cmd，node spawn 需经 shell 解析（world.run 同款坑）
  env: { ...process.env, VITE_AUTH_BACKEND: env.VITE_AUTH_BACKEND, VITE_STORE_CATALOG_PUBLIC_KEY: env.VITE_STORE_CATALOG_PUBLIC_KEY },
})
if (build.code !== 0) fail(`构建失败：\n${(build.stdout + build.stderr).slice(-1500)}`)

// 2. 上传前本地断言：pin + 特征标记必须在 bundle 内（手抄错 pin 在这里被拦）。
const indexHtml = readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8')
const assets = extractAssetNames(indexHtml)
const bundleJs = readFileSync(path.join(ROOT, 'dist', 'assets', assets.js), 'utf8')
const localMissing = missingBundleMarkers(bundleJs, [env.VITE_STORE_CATALOG_PUBLIC_KEY, ...markers])
if (localMissing.length > 0) fail(`bundle 缺少标记，已在上传前拦截：${localMissing.join(', ')}`)
log(`本地断言过：${assets.js} / ${assets.css}`)

// 3. 变更检测基线：远端 lock 与 server/src 逐文件清单（路径:md5 行）。
// 两侧用同构的逐文件比对——聚合哈希对排序/分隔符敏感，曾恒误报变更。
log('读取服务器变更基线…')
const baseline = ssh(
  `md5sum ${REMOTE}/package-lock.json 2>/dev/null | cut -d" " -f1; ` +
    `cd ${REMOTE}/server && find src -type f 2>/dev/null | sort | while read -r f; do echo "$f:$(md5sum "$f" | cut -d" " -f1)"; done`,
)
if (baseline.code !== 0) fail('无法读取服务器基线（SSH 不通？）')
const baselineLines = baseline.stdout.trim().split('\n')
const prevLockHash = baselineLines[0]?.trim() ?? ''
const prevServerFiles = {}
for (const line of baselineLines.slice(1)) {
  const at = line.lastIndexOf(':')
  if (at > 0) prevServerFiles[line.slice(0, at)] = line.slice(at + 1)
}

const localLockHash = createHash('md5').update(readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex')
const localServerFiles = {}
const serverSrcDir = path.join(ROOT, 'server', 'src')
if (existsSync(serverSrcDir)) {
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const rel = (prefix + entry.name).split(path.sep).join('/')
      if (entry.isDirectory()) walk(full, rel + '/')
      else localServerFiles[rel] = createHash('md5').update(readFileSync(full)).digest('hex')
    }
  }
  // 与服务端 find src 同构：键带 src/ 前缀。
  walk(serverSrcDir, 'src/')
}
const lockChanged = localLockHash !== prevLockHash
const serverChangedFiles = changedPaths(prevServerFiles, localServerFiles)
const serverChanged = serverChangedFiles.length > 0
log(
  `变更检测：package-lock ${lockChanged ? '有变化 → 将远端完整 npm install' : '无变化'}；` +
    `src/server ${serverChanged ? `有变化(${serverChangedFiles.slice(0, 3).join(', ')}${serverChangedFiles.length > 3 ? ' 等' : ''}) → 将重启 agehaos` : '无变化'}`,
)

// 4. 打包上传到 releases/<时间戳>/（exclude 前置，坑 64）。
const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)
const release = stamp
log(`上传 release ${release} …`)
// 相对路径打包：Windows GNU tar 会把 `E:\...` 的盘符冒号解析成远程主机名。
const pack = sh('tar', ['-czf', `.tmp/deploy-${release}.tgz`, ...tarFileArgs()])
if (pack.code !== 0) fail(`tar 打包失败：${pack.stderr.slice(-500)}`)
const upload = ssh(
  `set -e; mkdir -p ${REMOTE}/releases/${release} && tar -xzf - -C ${REMOTE}/releases/${release} && ` +
    `mkdir -p ${REMOTE}/releases/${release}/dist && chown -R agehaos:agehaos ${REMOTE}/releases/${release}`,
  { input: readFileSync(path.join(ROOT, '.tmp', `deploy-${release}.tgz`)) },
)
rmSync(path.join(ROOT, '.tmp', `deploy-${release}.tgz`), { force: true })
if (upload.code !== 0) fail(`上传失败：${upload.stderr.slice(-500)}`)

// 5. 依赖与后端运行时同步。⚠️ 铁律（09-27 事故同款地雷）：只替换 server/src 与
//    server/test，绝不 rm 整个 server/ —— server/data（账号+签名私钥）在 server/ 下。
const syncRuntime = ssh(
  `set -e; cd ${REMOTE} && cp releases/${release}/package.json releases/${release}/package-lock.json . && ` +
    `rm -rf src server/src server/test && ` +
    `cp -r releases/${release}/src . && ` +
    `cp -r releases/${release}/server/src releases/${release}/server/test server/ && ` +
    `find releases/${release}/server -maxdepth 1 -type f -exec cp {} server/ \\; && ` +
    `chown -R agehaos:agehaos src server package.json package-lock.json`,
)
if (syncRuntime.code !== 0) fail(`运行时文件同步失败：${syncRuntime.stderr.slice(-500)}`)
if (lockChanged) {
  log('远端完整 npm install（坑 65：严禁 --omit=dev）…')
  const install = ssh(`set -e; cd ${REMOTE} && npm install 2>&1 | tail -3`)
  if (install.code !== 0) fail(`远端 npm install 失败：${install.stderr.slice(-500)}`)
}
if (serverChanged) {
  log('重启 agehaos 并等待监听（tsx 启动约 2s，坑：勿立刻探测）…')
  const restart = ssh(
    `set -e; systemctl restart agehaos; ` +
      `for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:8787/api/auth/session && break; sleep 0.5; done; ` +
      `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/auth/session`,
  )
  if (restart.code !== 0 || !/401|200/.test(restart.stdout.trim())) {
    fail(`后端重启后未就绪（HTTP ${restart.stdout.trim()}）`)
  }
}

// 6. 原子切换 dist 符号链接（首次迁移：真实 dist 目录先收编进 releases）。
const switchCmd =
  `set -e; cd ${REMOTE}; ` +
  `if [ -d dist ] && [ ! -L dist ]; then mkdir -p releases/legacy && mv dist releases/legacy/dist-$(date +%Y%m%d%H%M); fi; ` +
  `ln -sfn ${REMOTE}/releases/${release}/dist ${REMOTE}/.dist-switch && mv -Tf ${REMOTE}/.dist-switch ${REMOTE}/dist`
const doSwitch = ssh(switchCmd)
if (doSwitch.code !== 0) fail(`符号链接切换失败：${doSwitch.stderr.slice(-500)}`)

// 7. 六点核验（全部 --resolve SNI）；失败自动回滚上一 release。
log('六点核验…')
const firstMarker = markers.length > 0 ? markers[0] : null
const verify = ssh(
  `B=${REMOTE}/dist; JS=${assets.js}; CSS=${assets.css}; ` +
    `echo "1:$(curl -s --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/api/store/catalog | head -c 120)"; ` +
    `echo "2:$(grep -cF '${env.VITE_STORE_CATALOG_PUBLIC_KEY}' "$B/assets/$JS" 2>/dev/null || echo 0)"; ` +
    `echo "3:$(grep -c 'os\\.ageha\\.cn\\s*{' ${CADDYFILE} || echo 0)"; ` +
    `echo "4:$(curl -s -o /dev/null -w "%{http_code}" --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/)"; ` +
    `echo "5:$(curl -s --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/ | grep -oF "assets/$JS" | head -1)"; ` +
    `if [ -n '${firstMarker ?? ''}' ]; then echo "6:$(grep -cF '${firstMarker}' "$B/assets/$JS" 2>/dev/null || echo 0)"; ` +
    `else echo "6:$(test -f "$B/assets/$CSS" && echo 1 || echo 0)"; fi`,
)
if (verify.code !== 0) {
  console.error('六点核验 SSH 失败，回滚…')
  sh('node', ['scripts/deploy.mjs', '--rollback'])
  fail('六点核验未完成，已回滚')
}
const points = Object.fromEntries(verify.stdout.trim().split('\n').map((l) => [l[0], l.slice(2)]))
const catalogKeyId = /"keyId":"([0-9a-f]+)"/.exec(points['1'] ?? '')?.[1] ?? ''
const checks = [
  ['① catalog keyId = pin', catalogKeyId === expectedKeyId],
  ['② pin 在 live bundle', points['2'] !== '0' && points['2'] !== undefined],
  ['③ Caddyfile os 块在', Number(points['3']) >= 1],
  ['④ HTTPS 200', points['4'] === '200'],
  ['⑤ index.html 引新包', (points['5'] ?? '').includes(assets.js)],
  ['⑥ 特征标记在 live bundle', points['6'] !== '0' && points['6'] !== undefined],
]
let allOk = true
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`)
  allOk = allOk && ok
}
if (!allOk) {
  log('核验未全过，自动回滚…')
  sh('node', ['scripts/deploy.mjs', '--rollback'])
  fail('六点核验未全过，已回滚到上一 release')
}

// ③ 的 no-cache 细项（坑 70）：直接验行为（响应头），比 grep Caddyfile 文本可靠。
const noCache = ssh(`curl -sI --resolve os.ageha.cn:443:127.0.0.1 https://os.ageha.cn/ | grep -ci no-cache || true`)
if (Number(noCache.stdout.trim() || '0') < 1) console.warn('  ⚠ 首页响应缺 Cache-Control: no-cache（坑 70），请人工核对')
const prune = ssh(
  `cd ${REMOTE}/releases && ls -1 | grep -v legacy | sort | head -n -${KEEP_RELEASES} | ` +
    `while read -r r; do [ "$r" != "${release}" ] && rm -rf "$r" && echo "pruned $r"; done; true`,
)
log(`清理旧 release：${prune.stdout.trim() || '无'}`)

log(`部署完成：release ${release}（bundle ${assets.js}）已上线并通过六点核验。`)
}

// main 守卫（模块导入无副作用；纯函数在 deploy-lib.mjs）。
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) main()
