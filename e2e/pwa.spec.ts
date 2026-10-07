import { expect, test } from '@playwright/test'

/**
 * M0-5 PWA：manifest 与 index.html 安装面接线在真实构建产物（vite preview）
 * 上的网络侧验证。移动 context（手机口径同 mobile-shell.spec.ts）发起请求，
 * 断言三类契约：
 * ① /manifest.webmanifest 返回 200 且 JSON 可解析——name/short_name/display/
 *    start_url 完备，icons 覆盖 192/512 两档（purpose any），且每个 icon src
 *    实际可被同源取回（文件存在性由 src/pwa/manifest.test.ts 钉死，这里钉
 *    「served 可达」）；
 * ② /（index.html）含 viewport-fit=cover（M0-4 safe-area 前提，构建产物不回退）
 *    与 manifest link、iOS standalone meta。
 * 结构契约（字段字面量、icons 尺寸与真实像素一致）由 src/pwa/manifest.test.ts
 * 负责，本文件不重复复算。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

test.describe('mobile context（360×800 iPhone UA）', () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })

  test('/manifest.webmanifest 返回 200 且 JSON 可解析：name/display/icons 完备', async ({
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest')
    expect(response.status()).toBe(200)

    const manifest = (await response.json()) as {
      name?: string
      short_name?: string
      display?: string
      start_url?: string
      icons?: { src?: string; sizes?: string; purpose?: string }[]
    }

    expect(manifest.name).toBe('AgehaOS')
    expect(manifest.short_name).toBe('AgehaOS')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')

    const icons = manifest.icons ?? []
    for (const size of ['192x192', '512x512']) {
      const entry = icons.find((icon) => icon.sizes === size)
      expect(entry, `manifest served with a ${size} icon`).toBeTruthy()
      expect(entry!.purpose).toBe('any')

      // icon 资产同源可达：安装横幅取图不能 404。
      const iconResponse = await request.get(entry!.src!)
      expect(iconResponse.status(), `${entry!.src} is served`).toBe(200)
    }
  })

  test('index.html 含 viewport-fit=cover 与 PWA 接线（manifest link + iOS meta）', async ({
    request,
  }) => {
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    const html = await response.text()

    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('black-translucent')
  })
})
