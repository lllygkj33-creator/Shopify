/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig } from 'vite'

/**
 * 纯逻辑单元测试专用配置。
 *
 * 模板自带的 vite.config.ts 把 vitest 固定在 **browser 模式**，需要下载
 * Playwright 的 Chromium 才能跑。但 lib/ 下的解析器与时区换算是纯函数，
 * 用 node 环境跑既快又没有浏览器依赖：
 *
 *   pnpm exec vitest run --config vitest.node.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.node.test.ts'],
    silent: 'passed-only',
  },
})
