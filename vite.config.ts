/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Content-Security-Policy for production builds only (PRD §30.2).
 * The dev server needs inline scripts and websockets for HMR, so the
 * header is injected into the built index.html via this plugin instead
 * of a static <meta> tag. Deployment reverse proxies should send the
 * same policy as a real header (see docs/SECURITY.md).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'agehaos:csp',
    apply: 'build',
    transformIndexHtml(html) {
      // 档 ③（子域浏览）：browse 源需列入 frame-src，否则窗口内跨源 iframe
      // 被自身 CSP 挡死。缺省判断与 src/apps/browser/browser-nav.ts 的
      // resolveBrowseOrigin 保持同步（两行逻辑，勿漂移）。
      const explicit = process.env.VITE_BROWSE_ORIGIN
      const browseOrigin =
        explicit !== undefined && explicit !== ''
          ? explicit
          : process.env.VITE_AUTH_BACKEND
            ? 'https://browse.ageha.cn'
            : ''
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        `frame-src 'self'${browseOrigin === '' ? '' : ` ${browseOrigin}`}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Local dev auth backend (npm run dev:server on :8787). Harmless when
      // the backend is down: nothing calls /api in local-auth mode. xfwd
      // sends X-Forwarded-Host so the backend's CSRF origin check (with
      // trustProxy) sees the browser-facing origin, like a real reverse proxy.
      '/api': {
        target: 'http://localhost:8787',
        xfwd: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // fork 数上限（2026-10-08 门禁实测）：15GB/12 核的 Windows 门禁机上，
    // 默认 ≈12 个 jsdom fork 会把提交内存逼到系统极限（实测整链跑挂
    // FATAL ERROR: Zone Allocation failed / VirtualAlloc failed），紧随其后的
    // server 套件在内存枯竭下回环 mock fetch 假失败（ai-upstream 假红，坑见
    // server/vitest.config.ts 注释）。上限 4 个 fork 实测全套件 132s，远在
    // 门禁 test 900s 预算内；CI（4 核）不受影响。
    maxWorkers: 4,
  },
})
