/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

/**
 * 浏览器测试用哪个 Chrome。
 *
 * 默认复用系统已装的 Chrome：Playwright 自带的 Chromium 需要额外下载约 150MB，
 * 而国内网络拿不到（微软 CDN 返回 400，npmmirror 只镜像了 linux 构建）。
 *
 * 覆盖方式：
 *   PW_CHANNEL=chromium pnpm test   # 强制用 Playwright 自带的 Chromium
 *   PW_CHANNEL=edge pnpm test       # 用 Edge
 * 未设置时：能找到系统 Chrome 就用它，否则退回 Playwright 默认行为。
 */
function resolveBrowserChannel(): string | undefined {
  if (process.env.PW_CHANNEL !== undefined) {
    return process.env.PW_CHANNEL || undefined
  }

  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          path.join(
            process.env.HOME ?? '',
            'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          ),
        ]
      : []

  return candidates.some((candidate) => fs.existsSync(candidate))
    ? 'chrome'
    : undefined
}

const browserChannel = resolveBrowserChannel()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    silent: 'passed-only',
    unstubEnvs: true,
    browser: {
      enabled: true,
      provider: playwright(
        browserChannel ? { launchOptions: { channel: browserChannel } } : {}
      ),
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/routeTree.gen.ts',
        'src/routes/**',
      ],
    },
  },
})
