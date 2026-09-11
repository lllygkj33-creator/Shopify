/**
 * 真实后端模式的验收检查（与 verify-ui.mjs 互补）。
 *
 * verify-ui.mjs 跑在**演示模式**下，验证 UI 与校验逻辑；
 * 本脚本跑在 `pnpm dev:real`（连接真实后端）下，验证**数据是真的从库里来的**：
 *  - 「演示数据模式」角标消失
 *  - 统计卡数字与数据库一致
 *  - 栏目历史记录能读到后端那条记录
 *
 * 用法：
 *   pnpm dev:real --port 5178
 *   node scripts/verify-real-backend.mjs http://localhost:5178
 */

import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5178'
const problems = []
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

// ---------- 仪表盘：真实数据 ----------
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=排期仪表盘', { timeout: 15000 })
await page.waitForTimeout(1200)

const facts = await page.evaluate(() => {
  const text = document.body.textContent ?? ''
  const cards = Array.from(document.querySelectorAll('[data-slot="card"]')).slice(0, 4)
    .map((c) => {
      const label = c.querySelector('p')?.textContent?.trim()
      const value = c.querySelector('p.tabular-nums')?.textContent?.trim()
      return `${label}=${value}`
    })
  return {
    cards,
    hasMockBadge: text.includes('演示数据模式'),
    hasTimelineEmptyHint: text.includes('暂无排期'),
  }
})

console.log('---------- 真实后端模式的仪表盘 ----------')
console.log('统计卡          :', facts.cards.join('  '))
console.log('演示模式角标    :', facts.hasMockBadge ? '❌ 仍在显示（说明还在用 mock）' : '✓ 已消失（真实数据）')
console.log('侧边栏连接状态  :', await page.locator('[data-sidebar="footer"]').textContent())

if (facts.hasMockBadge) problems.push('切到真实后端后仍在显示「演示数据模式」角标')
if (!facts.cards.some((c) => c === '待发布=1')) {
  problems.push(`统计卡应显示真实的「待发布=1」，实际：${facts.cards.join(' ')}`)
}

// ---------- Custom 栏目的历史记录 ----------
await page.goto(`${BASE}/channels/custom`, { waitUntil: 'networkidle' })
await page.waitForSelector('text=上传与发布', { timeout: 15000 })
await page.locator('button[role="tab"]', { hasText: '历史记录' }).click()
await page.waitForTimeout(1200)

const historyText = await page.locator('body').textContent()
const hasRow = historyText?.includes('E2E 测试页')
const hasStatus = historyText?.includes('待发布')
console.log('\n---------- Custom 栏目历史记录 ----------')
console.log('出现记录        :', hasRow ? '✓' : '❌')
console.log('状态标签        :', hasStatus ? '✓ 待发布' : '❌')
if (!hasRow) problems.push('历史记录没有从后端读到那条记录')

await page.screenshot({ path: 'screenshots/real-backend-history.png', fullPage: true })
await page.close()
await browser.close()

console.log('\n================ 汇总 ================')
if (problems.length === 0) {
  console.log('真实后端模式全部通过。')
  process.exit(0)
}
console.log(`发现 ${problems.length} 个问题：`)
for (const p of problems) console.log(' -', p)
process.exit(1)
