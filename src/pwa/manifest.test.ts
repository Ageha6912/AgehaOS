import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PWA manifest 契约（M0-5）：public/manifest.webmanifest 是安装面板与
 * standalone 启动的唯一声明源——字段残缺会让浏览器拒绝安装或落错启动观感。
 * manifest 与 index.html 都是静态资产，走 node fs 直读（同
 * eclosion-runner.test.ts 的口径：vitest jsdom 里 import.meta.url 非 file:
 * 协议，文件读取走 process.cwd() 相对路径，套件从仓库根运行）；
 * 「served 200 + 可解析」的网络侧断言在 e2e/pwa.spec.ts。
 *
 * 图标另做两级校验：文件真实存在于 public/，且声明的 sizes 与 PNG IHDR
 * 实际尺寸一致（manifest 声明错尺寸会让安装横幅选错档甚至拒装）。
 */

const MANIFEST = JSON.parse(
  readFileSync(resolve('public/manifest.webmanifest'), 'utf8'),
) as {
  id?: unknown
  start_url?: unknown
  name?: unknown
  short_name?: unknown
  display?: unknown
  lang?: unknown
  background_color?: unknown
  theme_color?: unknown
  icons?: unknown
}

const INDEX_HTML = readFileSync(resolve('index.html'), 'utf8')

/** 品牌名与 index.html <title> 同源（类型层无共享常量，字面量双处钉死）。 */
const BRAND_NAME = 'AgehaOS'

interface IconEntry {
  src: string
  sizes: string
  type: string
  purpose: string
}

function expectIconEntry(raw: unknown): IconEntry {
  expect(raw, 'icon entry is an object').toEqual(
    expect.objectContaining({ src: expect.any(String), sizes: expect.any(String) }),
  )
  return raw as IconEntry
}

/** 读 PNG IHDR（第 16–24 字节）拿真实像素尺寸，校验 manifest sizes 声明诚实。 */
function pngDimensions(publicPath: string): { width: number; height: number } {
  const bytes = readFileSync(resolve('public', publicPath.replace(/^\//, '')))
  const isPng = bytes.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n'
  expect(isPng, `${publicPath} is a PNG`).toBe(true)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('PWA manifest（public/manifest.webmanifest）', () => {
  it('必备字段完备且取值正确', () => {
    expect(MANIFEST.id).toBe('/')
    expect(MANIFEST.start_url).toBe('/')
    expect(MANIFEST.name).toBe(BRAND_NAME)
    expect(MANIFEST.short_name).toBe(BRAND_NAME)
    expect(MANIFEST.display).toBe('standalone')
    expect(MANIFEST.lang).toBe('zh-CN')
  })

  it('theme_color 与 index.html 的 meta theme-color 同值；background_color 为合法 hex', () => {
    const htmlThemeColor = INDEX_HTML.match(
      /<meta name="theme-color" content="([^"]+)" \/>/,
    )?.[1]
    expect(htmlThemeColor, 'index.html declares a theme-color').toBeTruthy()
    expect(MANIFEST.theme_color).toBe(htmlThemeColor)

    expect(MANIFEST.background_color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('icons 覆盖 192/512 两档，purpose 均 any，指向的文件真实存在且尺寸相符', () => {
    const icons = (MANIFEST.icons as unknown[] | undefined)?.map(expectIconEntry)
    expect(Array.isArray(icons)).toBe(true)

    for (const size of ['192x192', '512x512']) {
      const entry = icons?.find((icon) => icon.sizes === size)
      expect(entry, `manifest declares a ${size} icon`).toBeTruthy()

      expect(entry!.src).toMatch(/^\//)
      expect(entry!.type).toBe('image/png')
      expect(entry!.purpose).toBe('any')

      const fsPath = resolve('public', entry!.src.replace(/^\//, ''))
      expect(existsSync(fsPath), `${entry!.src} exists under public/`).toBe(true)

      const [width, height] = size.split('x').map(Number)
      expect(pngDimensions(entry!.src)).toEqual({ width, height })
    }
  })

  it('index.html 完成安装面接线：manifest link + viewport-fit=cover + iOS standalone meta', () => {
    expect(INDEX_HTML).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(INDEX_HTML.match(/<meta name="viewport" content="([^"]+)" \/>/)?.[1]).toContain(
      'viewport-fit=cover',
    )
    expect(INDEX_HTML).toContain(
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
    )
    expect(INDEX_HTML).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    )
  })
})
