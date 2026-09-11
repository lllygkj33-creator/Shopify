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

/**
 * 打开页面并等到布局稳定。
 *
 * 为什么不用 `networkidle`：Google Fonts 的请求可能长时间挂起，会把
 * networkidle 拖到超时（实测过）。改用 domcontentloaded 后，要显式等字体就绪 ——
 * 否则字体迟到会引起布局位移，点击会落空
 * （Playwright 报 `<html> intercepts pointer events`）。
 */
async function openPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
}


const BASE = process.argv[2] ?? 'http://localhost:5178'
const problems = []
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

// ---------- 仪表盘：真实数据 ----------
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await openPage(page, `${BASE}/`)
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
await openPage(page, `${BASE}/channels/custom`)
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

// ---------- 改期：走完整 UI 路径，并确认「线上同步结果」被如实告诉用户 ----------
await openPage(page, `${BASE}/`)
await page.waitForSelector('text=排期仪表盘', { timeout: 15000 })

// 注意：默认视图是「未来 7 天」，而测试记录的排期在几个月后 ——
// 时间轴会（按设计）过滤掉窗口外的排期。所以先切到「未来 6 月」。
await page.locator('button[role="tab"]', { hasText: '未来 6 月' }).click()
await page.waitForSelector('[data-testid="timeline-chip"]', { timeout: 15000 })
await page.locator('[data-testid="timeline-chip"]').first().click()
await page.waitForSelector('text=排期时间', { timeout: 10000 })

const picker = page.locator('input[type="datetime-local"]').first()
const moved = '2027-02-20T10:30'
await picker.fill(moved)
await page.locator('button', { hasText: '保存' }).first().click()

// 弹窗会提示线上同步结果：这条记录没有 Shopify GID，
// 所以应出现「本地没有 Shopify 对象 GID，跳过同步」而不是笼统的成功
const toastText = await page
  .locator('[data-sonner-toast]')
  .first()
  .textContent({ timeout: 10000 })
  .catch(() => null)

console.log('\n---------- 改期（UI 全路径）----------')
console.log('提交的新时间 :', moved)
console.log('提示文案     :', toastText?.trim() ?? '(没有出现提示)')

if (!toastText) {
  problems.push('改期后没有出现任何提示')
} else if (!/重新发布|同步/.test(toastText)) {
  // 这条记录没有 Shopify 对象，所以应提示「需重新发布才会生效」；
  // 有对象时则应提示「已同步到 Shopify」——两种都必须说清楚
  problems.push(`改期提示应说明线上情况，实际：${toastText.trim()}`)
}

// 从接口确认本地记录真的改了
const after = await page.evaluate(async () => {
  const response = await fetch('http://127.0.0.1:8000/api/contents')
  const rows = await response.json()
  // 按标题定位：库里可能有多条记录，顺序会随时间变化
  const target = rows.find((row) => row.title === 'E2E 测试页') ?? rows[0]
  return target?.scheduledAt ?? null
})
console.log('接口里的排期 :', after)
if (!String(after).startsWith('2027-02-20')) {
  problems.push(`本地记录未更新，接口返回 ${after}`)
}

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
