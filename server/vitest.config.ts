import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    // 文件间不并行（2026-10-08 门禁实测）：全套件 11 文件各自构建 Fastify app
    // + 真回环 mock 上游（127.0.0.1 临时端口），并行 worker 在内存吃紧的
    // Windows 机器上会把 mock 的回环 fetch 逼挂（connect/stream 失败 →
    // upstream.ts 归类 ai-upstream → eclosion.test.ts imagine 审计用例假红，
    // 门禁实测 outcome 'generated' → 'ai-upstream' 各一次）。串行跑文件保留
    // 文件隔离（每文件仍独立 fork），全套件远在门禁 900s 预算内。
    fileParallelism: false,
  },
})
