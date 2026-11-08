// deploy-lib.test.mjs — node --test 直跑（npm run test:deploy）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  assertHealthyEnvShape,
  changedPaths,
  extractAssetNames,
  keyIdFromPin,
  loadEnvProduction,
  missingBundleMarkers,
  pickPreviousRelease,
  rollbackScript,
  runtimeRestoreScript,
  runtimeSyncScript,
  sortReleases,
  tarFileArgs,
} from './deploy-lib.mjs'

// 真实生产 pin（keyId 082ff6625c72e40b）作为测试向量——keyId 口径漂移会被这里拦住。
const PROD_PIN = 'c48lL/vODieWM/d/zNolkSBpa/AbAbTnUgbRtfal2SE='

test('keyIdFromPin matches the production keyId (ADR 18 口径)', () => {
  assert.equal(keyIdFromPin(PROD_PIN), '082ff6625c72e40b')
})

test('loadEnvProduction parses a valid env file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-'))
  const file = path.join(dir, '.env.production')
  writeFileSync(file, '# comment\nVITE_AUTH_BACKEND=1\nVITE_STORE_CATALOG_PUBLIC_KEY=abc=\n')
  const env = loadEnvProduction(file)
  assert.equal(env.VITE_AUTH_BACKEND, '1')
  assert.equal(env.VITE_STORE_CATALOG_PUBLIC_KEY, 'abc=')
  rmSync(dir, { recursive: true, force: true })
})

test('loadEnvProduction fails fast on missing file with guidance', () => {
  assert.throws(
    () => loadEnvProduction('/no/such/.env.production'),
    /缺少[\s\S]*VITE_AUTH_BACKEND=/,
  )
})

test('loadEnvProduction reports every missing required key', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-'))
  const file = path.join(dir, '.env.production')
  writeFileSync(file, 'UNRELATED=1\n')
  assert.throws(
    () => loadEnvProduction(file),
    /缺少必填键：VITE_AUTH_BACKEND, VITE_STORE_CATALOG_PUBLIC_KEY/,
  )
  rmSync(dir, { recursive: true, force: true })
})

test('assertHealthyEnvShape accepts pin with padding and rejects short keys', () => {
  assert.equal(assertHealthyEnvShape({ VITE_STORE_CATALOG_PUBLIC_KEY: PROD_PIN }), true)
  assert.throws(
    () => assertHealthyEnvShape({ VITE_STORE_CATALOG_PUBLIC_KEY: 'short' }),
    /不像 Ed25519 raw 公钥/,
  )
})

test('missingBundleMarkers lists every absent marker', () => {
  const bundle = 'has-glass-popover and ag-dock-gap'
  assert.deepEqual(missingBundleMarkers(bundle, ['glass-popover', 'ag-dock-gap']), [])
  assert.deepEqual(missingBundleMarkers(bundle, ['glass-popover', 'missing-one']), ['missing-one'])
})

test('extractAssetNames reads bundle and css from index.html', () => {
  const html =
    '<script type="module" crossorigin src="/assets/index-O0VyL329.js"></script>' +
    '<link rel="stylesheet" crossorigin href="/assets/index-zmcm6SfU.css">'
  assert.deepEqual(extractAssetNames(html), { js: 'index-O0VyL329.js', css: 'index-zmcm6SfU.css' })
  assert.throws(() => extractAssetNames('<html></html>'), /构建产物异常/)
})

test('sortReleases and pickPreviousRelease pick the adjacent predecessor', () => {
  const names = ['20261002-1200', '20261001-0900', '20261003-0800']
  assert.deepEqual(sortReleases(names), ['20261001-0900', '20261002-1200', '20261003-0800'])
  assert.equal(pickPreviousRelease('20261003-0800', names), '20261002-1200')
  assert.equal(pickPreviousRelease('20261001-0900', names), null)
  assert.equal(pickPreviousRelease('no-such', names), null)
})

test('changedPaths reports adds, removes and edits symmetrically', () => {
  const prev = { 'a.ts': '1', 'b.ts': '2', 'gone.ts': '3' }
  const next = { 'a.ts': '1', 'b.ts': '9', 'new.ts': '4' }
  assert.deepEqual(changedPaths(prev, next), ['b.ts', 'gone.ts', 'new.ts'])
})

test('tarFileArgs keeps the data exclude in front (坑 64 铁律)', () => {
  const args = tarFileArgs()
  assert.equal(args[0], '--exclude=server/data')
  assert.ok(args.includes('dist') && args.includes('package-lock.json'))
})

test('no Vite-convention env file at repo root carries VITE_ vars（2026-10-02 E2E 污染事故防回归）', () => {
  // .env.production / .env.local 等约定名会被 vite build 自动加载：只要根部
  // 出现这类文件且含 VITE_ 前缀变量，E2E 的「干净构建」前提即被打破
  // （远程模式混入 → 全数挂掉）。部署专用 env 必须用 .env.deploy 这类
  // Vite 不识别的命名。
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..',
  )
  for (const name of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    '.env.production.local',
  ]) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    assert.ok(
      !/^VITE_/m.test(text),
      `${name} 含 VITE_ 变量会被 vite build 泄进客户端 bundle——改用 .env.deploy`,
    )
  }
})

test('runtimeSyncScript backs up src/server before deleting them', () => {
  const release = '20261104120000'
  const backup = `/opt/agehaos/.deploy-backup/${release}`
  const script = runtimeSyncScript('/opt/agehaos', release)
  const mkdirAt = script.indexOf(`mkdir -p ${backup}/server`)
  const srcBackupAt = script.indexOf(`cp -a src ${backup}/`)
  const serverBackupAt = script.indexOf(`cp -a server/src server/test ${backup}/server/`)
  const rmAt = script.indexOf('rm -rf src server/src server/test')

  assert.ok(mkdirAt >= 0, '必须创建备份目录')
  assert.ok(srcBackupAt > mkdirAt, 'src 备份晚于建目录')
  assert.ok(serverBackupAt > srcBackupAt, 'server/src + server/test 备份晚于 src 备份')
  assert.ok(rmAt > serverBackupAt, 'rm 必须晚于全部备份（半完成态由恢复脚本兜底）')
  assert.ok(script.includes(`cp -r releases/${release}/src .`))
})

test('runtimeRestoreScript restores src/server and restarts the backend', () => {
  const release = '20261104120000'
  const backup = `/opt/agehaos/.deploy-backup/${release}`
  const script = runtimeRestoreScript('/opt/agehaos', release)

  assert.ok(script.includes('rm -rf src server/src server/test'))
  assert.ok(script.includes(`cp -a ${backup}/src .`))
  assert.ok(script.includes(`cp -a ${backup}/server/src ${backup}/server/test server/`))
  assert.ok(script.includes(`cp -a ${backup}/package.json ${backup}/package-lock.json .`))
  assert.ok(script.includes('systemctl restart agehaos'))
})

test('rollbackScript switches dist and restores the target runtime when present', () => {
  const target = '20261104090000'
  const script = rollbackScript('/opt/agehaos', target)

  assert.ok(script.includes(`ln -sfn "/opt/agehaos/releases/${target}/dist"`))
  assert.ok(script.includes(`if [ -d releases/${target}/server/src ]`))
  assert.ok(
    script.includes(`cp -r releases/${target}/server/src releases/${target}/server/test server/`),
  )
  assert.ok(script.includes('systemctl restart agehaos'))
  assert.ok(script.includes('--resolve os.ageha.cn:443:127.0.0.1'))
})
