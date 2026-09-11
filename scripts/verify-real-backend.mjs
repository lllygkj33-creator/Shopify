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
 *   pnpm dev --port 5178   # 默认就是真实后端
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

// 统计卡与后端自己的口径对齐。
//
// 原来这里硬编码「待发布=1」—— 那是临时测试库里唯一一条记录的数字。
// 库里现在装的是线上真实排期（实测 172 条），硬编码必然过期。
// 改成拿后端的 stats 来比：这样断言的是「界面显示的和库里一致」，
// 而不是「库里恰好只有 1 条」。
const apiStats = await page.evaluate(async () => {
  const response = await fetch('http://127.0.0.1:8000/api/contents/stats')
  return await response.json()
})
const expectedCards = [
  `待发布=${apiStats.scheduledCount}`,
  `已发布=${apiStats.publishedCount}`,
  `发布失败=${apiStats.failedCount}`,
  `草稿=${apiStats.draftCount}`,
]
for (const expected of expectedCards) {
  if (!facts.cards.includes(expected)) {
    problems.push(`统计卡与接口不一致，应出现「${expected}」，实际：${facts.cards.join(' ')}`)
  }
}
console.log('接口 stats      :', JSON.stringify(apiStats))

// ---------- Custom 栏目的历史记录 ----------
await openPage(page, `${BASE}/channels/custom`)
await page.waitForSelector('text=上传与发布', { timeout: 15000 })
await page.locator('button[role="tab"]', { hasText: '历史记录' }).click()
await page.waitForTimeout(1200)

const historyText = await page.locator('body').textContent()

// 用接口的真实数据决定「应该看到什么」，而不是找某条写死的记录
// （原来找的「E2E 测试页」只存在于已删除的临时测试库里）
const customRows = await page.evaluate(async () => {
  const response = await fetch(
    'http://127.0.0.1:8000/api/contents?channel_id=custom'
  )
  return await response.json()
})
const hasStatus = historyText?.includes('待发布') || historyText?.includes('已发布')

console.log('\n---------- Custom 栏目历史记录 ----------')
console.log('接口返回条数    :', customRows.length)
console.log('界面出现状态标签:', hasStatus ? '✓' : '❌')

if (customRows.length === 0) {
  console.log('（库里这个栏目没有记录，界面显示空态即为正确）')
  if (!/还没有|暂无|没有/.test(historyText ?? '')) {
    problems.push('Custom 栏目接口返回 0 条，界面却没有显示空态文案')
  }
} else if (!(historyText ?? '').includes(customRows[0].title)) {
  problems.push(
    `历史记录没有显示接口返回的第一条「${customRows[0].title}」`
  )
}

await page.screenshot({ path: 'screenshots/real-backend-history.png', fullPage: true })

// ---------- 排期详情弹窗：走完整 UI 路径 ----------
//
// ⚠️ 默认**只读**。
//
// 这个脚本原来会改一条排期的时间。当时库里只有一条测试记录（"E2E 测试页"），
// 但库里现在装的是**线上真实排期**（实测 172 条）。原来的兜底逻辑
// （找不到测试记录就用 rows[0]）会把生产排期改到 2027 年 —— 那是在改用户的
// 真实店铺，不能随手跑。
//
// 所以：只有在 --mutate 且记录的标题/句柄确实是 E2E 测试样本时才改期，
// 否则打开弹窗确认它渲染正常就关掉。
const MUTATE = process.argv.includes('--mutate')
const TEST_FIXTURE_TITLE = 'E2E 测试页'

await openPage(page, `${BASE}/`)
await page.waitForSelector('text=排期仪表盘', { timeout: 15000 })

// 时间轴现在**按时间格聚合**：一格一个块，块上写条数，悬停/点击展开清单，
// 点清单里的单项才打开排期详情。所以要先点块、再点项。
await page.waitForSelector('[data-testid="timeline-bucket"]', { timeout: 15000 })
const firstBucket = page.locator('[data-testid="timeline-bucket"]').first()
const bucketCount = await firstBucket.getAttribute('data-count')
console.log('\n---------- 时间轴 ----------')
console.log('第一个时间格的条数:', bucketCount)

const bucketItemCount = Number(bucketCount ?? '1')

if (bucketItemCount > 1) {
  // 多条：悬停展开清单，再点单项
  await firstBucket.hover()
  await page.waitForSelector('[data-testid="timeline-chip"]', { timeout: 10000 })
  await page.locator('[data-testid="timeline-chip"]').first().click()
} else {
  // 只有一条：点块直接开详情（不弹清单，否则 320px 的面板会盖住相邻格）
  await firstBucket.click()
}

await page.waitForSelector('text=排期时间', { timeout: 10000 })
console.log('排期详情弹窗 : 已打开')

const picker = page.locator('input[type="datetime-local"]').first()
const moved = '2027-02-20T10:30'

const dialogTitle = await page
  .locator('[role="dialog"] [data-slot="dialog-title"]')
  .first()
  .textContent()
  .catch(() => '')

if (!MUTATE) {
  console.log('改期         : 跳过（只读模式；要真的改期加 --mutate）')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
} else if (!(dialogTitle ?? '').includes(TEST_FIXTURE_TITLE)) {
  problems.push(
    `--mutate 只允许改测试样本「${TEST_FIXTURE_TITLE}」，当前打开的是「${(dialogTitle ?? '').slice(0, 40)}」` +
      ' —— 库里是真实排期，不能改'
  )
  await page.keyboard.press('Escape')
} else {
  await picker.fill(moved)
  await page.locator('button', { hasText: '保存' }).first().click()
}

if (MUTATE) {
  // 弹窗会提示线上同步结果：若记录没有 Shopify GID，
  // 应出现「跳过同步」而不是笼统的成功
  const toastText = await page
    .locator('[data-sonner-toast]')
    .first()
    .textContent({ timeout: 10000 })
    .catch(() => null)

  console.log('提交的新时间 :', moved)
  console.log('提示文案     :', toastText?.trim() ?? '(没有出现提示)')

  if (!toastText) {
    problems.push('改期后没有出现任何提示')
  } else if (!/重新发布|同步/.test(toastText)) {
    problems.push(`改期提示应说明线上情况，实际：${toastText.trim()}`)
  }
}

if (MUTATE) {
  // 从接口确认本地记录真的改了。**按标题精确定位，不做 rows[0] 兜底** ——
  // 兜底会去改到别的真实排期上。
  const after = await page.evaluate(async (title) => {
    const response = await fetch('http://127.0.0.1:8000/api/contents')
    const rows = await response.json()
    const target = rows.find((row) => row.title === title)
    return target?.scheduledAt ?? null
  }, TEST_FIXTURE_TITLE)
  console.log('接口里的排期 :', after)
  if (!String(after).startsWith('2027-02-20')) {
    problems.push(`本地记录未更新，接口返回 ${after}`)
  }
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
