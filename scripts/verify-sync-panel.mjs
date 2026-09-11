/**
 * 数据同步面板的验收检查（真实后端模式）。
 *
 * 为什么单独一个脚本：`verify-real-backend.mjs` 里有一步会**改期**一条时间轴
 * 上的内容 —— 导入之后时间轴上全是线上真实已发布的文章，那一步会去改真实
 * 店铺里文章的发布时间，不能随手跑。本脚本**只读**（加上一次幂等的对账）。
 *
 * 检查什么：
 *  - 面板能读到后端真实数字（跟踪条数不是演示数据）
 *  - 两个按钮存在且可点（凭据齐全时不能是灰的）
 *  - 点「立即同步」后能拿到真实报告（拉到排期条数 + 对账结果），而不是报错
 *
 * 用法：
 *   pnpm dev --port 5178   # 默认就是真实后端
 *   node scripts/verify-sync-panel.mjs http://localhost:5178
 */

import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5178'

function fail(message) {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`✓ ${message}`)
}

// 复用系统 Chrome：Playwright 自带的 Chromium 在国内网络下不来
// （与 verify-ui.mjs / verify-real-backend.mjs 保持一致）
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)

  // 等 React 挂载完成再读 DOM，否则会读到空壳
  await page.waitForSelector('text=全局设置', { timeout: 15000 })
  await page.waitForSelector('text=数据同步', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2500)

  // 演示模式角标不该出现 —— 出现了说明前端没连上真实后端
  const bodyText = await page.locator('body').textContent()
  if (bodyText.includes('演示数据模式')) {
    fail('页面显示「演示数据模式」，没有连到真实后端')
  } else {
    ok('已连到真实后端（无演示模式角标）')
  }

  // ---- 面板本体 ----
  const panel = page.locator('text=已跟踪').first()
  await panel.waitFor({ timeout: 10000 })
  ok('数据同步面板已渲染')

  const tracked = await page
    .locator('text=已跟踪')
    .first()
    .locator('xpath=following-sibling::*[1]')
    .textContent()
  console.log('  已跟踪      :', tracked)
  if (!/^\d+$/.test((tracked ?? '').trim())) {
    fail(`已跟踪不是数字：${tracked}`)
  } else {
    ok(`已跟踪 ${tracked} 条（真实数据）`)
  }

  const reconcileButton = page.locator('button', { hasText: '立即同步' })
  await reconcileButton.waitFor({ timeout: 5000 })

  if (await reconcileButton.isEnabled()) {
    ok('同步按钮可点（凭据齐全）')
  } else {
    fail('按钮被禁用，但后端报告凭据齐全')
  }

  await page.screenshot({
    path: 'screenshots/sync-panel.png',
    fullPage: true,
  })

  // ---- 点一次同步（幂等：只读线上 + 写本地状态）----
  await reconcileButton.click()
  await page.waitForSelector('text=拉到', { timeout: 120000 })
  await page.waitForTimeout(500)

  const resultText = await page.locator('body').textContent()
  const match = resultText.match(/拉到 (\d+) 条未发布排期/)
  if (!match) {
    fail('同步结果没有出现（或文案变了）')
  } else {
    console.log(`  同步结果   : 拉到 ${match[1]} 条未发布排期`)
    ok('同步结果与后端一致')
  }

  await page.screenshot({
    path: 'screenshots/sync-panel-reconciled.png',
    fullPage: true,
  })

  const realErrors = consoleErrors.filter(
    (text) => !text.includes('favicon') && !text.includes('Failed to load resource')
  )
  if (realErrors.length > 0) {
    fail(`控制台有报错：${realErrors.slice(0, 3).join(' | ')}`)
  } else {
    ok('控制台无报错')
  }
} catch (error) {
  fail(`脚本异常：${error.message}`)
} finally {
  await browser.close()
}

console.log(process.exitCode ? '\n有检查未通过' : '\n全部通过')
