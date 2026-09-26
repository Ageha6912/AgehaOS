import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * motion-lab/boot 模块独立测试配置。
 * 产品根配置（vite.config.ts）的 test.include 只收 src/**，演示模块刻意不并入
 * 主套件；本配置把 root 指到模块目录，仅收本目录内的测试。
 * 运行：npx vitest run --config motion-lab/boot/vitest.config.mjs
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('./', import.meta.url)),
    environment: 'node', // 测试内手工创建 JSDOM 实例（见 boot.test.mjs）
    include: ['boot.test.mjs'],
  },
});
