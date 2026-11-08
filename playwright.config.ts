import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests (PRD §34.3) run against the production build served by
 * `vite preview`, so every run verifies the real artifact.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // worker 上限（M2-4 起钉住）：默认 workers ≈ 核数一半（本机 12 核 = 6 个
  // 并行 Chromium），叠加 desktop-stress（20 窗口）等重规格时在 15GB 内存
  // 的 Windows 门禁机上间歇击穿——实测 flake 三型：page.reload 报
  // ERR_INSUFFICIENT_RESOURCES、页面 60s 加载不出（goto 超时）、浏览器进程
  // 直接崩（Target page/context closed）。本机常驻用户 Chrome（~2-3GB），
  // 门禁真实预算只有 ~4GB 空闲——2 个并发 Chromium（~1.2GB）稳进预算。
  // 与 77a2686（vitest worker 上限）同一病灶同一手法：显式封顶换确定性
  // （全套 ~4-5min，仍远低于门禁预算）。
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    // 新用户默认主题为浅色（docs/DESIGN.md）；钉住色彩仿真保证 'system' 解析
    // 与视觉断言的确定性。
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    // 本机也 false（C2 审查）：复用旧 preview 会让 test:e2e 先 build 的
    // 新产物不被服务，E2E 实际验的是上一次构建。
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
