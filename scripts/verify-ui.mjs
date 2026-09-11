/**
 * UI 冒烟检查
 *
 * 目的：用真实浏览器打开开发服务器，逐页确认「能渲染、无运行时报错」，
 * 并输出截图供人工/视觉核对。
 *
 * 使用：
 *   pnpm dev            # 另开一个终端
 *   node scripts/verify-ui.mjs [baseUrl]
 *
 * 之所以用 channel: 'chrome'：复用本机已安装的 Google Chrome，
 * 避免额外下载 Playwright 自带的 Chromium。
 */

import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:5177'
const OUT_DIR = 'screenshots'

const PAGES = [
  { name: 'dashboard', path: '/', expect: '排期仪表盘' },
  { name: 'channel-blog', path: '/channels/tech-ai-hub', expect: 'Tech & AI Hub' },
  { name: 'channel-page', path: '/channels/discord', expect: 'Discord' },
  { name: 'settings', path: '/settings', expect: '全局设置' },
]

const problems = []

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
})
await mkdir(OUT_DIR, { recursive: true })

for (const target of PAGES) {
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  try {
    await page.goto(`${BASE}${target.path}`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
    await page.waitForSelector(`text=${target.expect}`, { timeout: 10_000 })
    await page.screenshot({
      path: `${OUT_DIR}/${target.name}.png`,
      fullPage: true,
    })
    console.log(`✓ ${target.path} 渲染成功（含「${target.expect}」）`)
  } catch (error) {
    problems.push(`${target.path}: ${error.message}`)
    console.log(`✗ ${target.path} 失败：${error.message}`)
    await page
      .screenshot({ path: `${OUT_DIR}/${target.name}-FAILED.png` })
      .catch(() => {})
  }

  // React 的 key 警告等属于 error 级 console，需要排除噪音后上报
  const noisy = consoleErrors.filter(
    (text) => !text.includes('favicon') && !text.includes('Download the React DevTools')
  )
  if (noisy.length > 0) {
    problems.push(`${target.path} console errors: ${noisy.join(' | ')}`)
    console.log(`  ⚠ console error: ${noisy.slice(0, 3).join(' | ')}`)
  }
  if (pageErrors.length > 0) {
    problems.push(`${target.path} page errors: ${pageErrors.join(' | ')}`)
    console.log(`  ⚠ page error: ${pageErrors.slice(0, 3).join(' | ')}`)
  }

  await page.close()
}

// 额外：点开时间轴色块，验证详情弹窗与改期控件可用
const page = await context.newPage()
const dialogErrors = []
page.on('pageerror', (error) => dialogErrors.push(error.message))
try {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

  // ---------- DOM 事实核对：把关键结构打出来，比肉眼更可靠 ----------
  const facts = await page.evaluate(() => {
    const text = (el) => (el?.textContent ?? '').trim()

    // 只取 SidebarContent 内的菜单项，排除顶部品牌与底部连接状态
    const navLabels = Array.from(
      document.querySelectorAll(
        '[data-sidebar="content"] [data-sidebar="menu-button"]'
      )
    ).map((el) => text(el))

    const statCards = Array.from(document.querySelectorAll('[data-slot="card"]'))
      .slice(0, 4)
      .map((card) => {
        const label = text(card.querySelector('p'))
        const value = text(card.querySelector('p.tabular-nums'))
        return `${label}=${value}`
      })

    const chips = Array.from(
      document.querySelectorAll('[data-testid="timeline-chip"]')
    )
    const chipInfo = chips.map((chip) => ({
      status: chip.getAttribute('data-status'),
      left: chip.style.left,
      top: chip.style.top,
      color: chip.style.color,
      label: text(chip),
    }))

    return {
      navLabels,
      statCards,
      chipCount: chips.length,
      chipInfo: chipInfo.slice(0, 6),
      rowCount: document.querySelectorAll('[data-testid="timeline-chip"]').length,
      hasTodayMarker: Boolean(
        document.querySelector('.bg-destructive\\/60')
      ),
      bodyOverflowX: document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    }
  })

  console.log('\n---------- DOM 核对 ----------')
  console.log(`侧边栏项（${facts.navLabels.length}）：${facts.navLabels.join(' / ')}`)
  console.log(`统计卡：${facts.statCards.join('  ')}`)
  console.log(`时间轴色块：${facts.chipCount} 个`)
  for (const chip of facts.chipInfo) {
    console.log(
      `  · [${chip.status}] left=${chip.left} top=${chip.top} color=${chip.color} «${chip.label}»`
    )
  }
  console.log(`今天标记线：${facts.hasTodayMarker ? '有' : '无'}`)
  console.log(`页面横向溢出：${facts.bodyOverflowX ? '是（需检查）' : '否'}`)

  if (facts.chipCount === 0) {
    problems.push('时间轴上没有任何色块，排期数据可能没渲染出来')
  }
  if (facts.navLabels.length !== 12) {
    problems.push(
      `侧边栏应有 12 项（仪表盘 + 10 栏目 + 全局设置），实际 ${facts.navLabels.length} 项`
    )
  }

  // ---------- 交互：点开色块 → 详情弹窗 ----------
  const chip = page.locator('[data-testid="timeline-chip"]').first()
  if (await chip.count()) {
    await chip.click()
    await page.waitForSelector('text=排期时间', { timeout: 8000 })
    await page.screenshot({ path: `${OUT_DIR}/schedule-dialog.png` })
    const dialogTitle = await page
      .locator('[role="dialog"] [data-slot="dialog-title"]')
      .first()
      .textContent()
      .catch(() => null)
    console.log(`✓ 排期详情弹窗可打开（标题：${(dialogTitle ?? '').slice(0, 50)}…）`)
  }
} catch (error) {
  problems.push(`排期弹窗: ${error.message}`)
  console.log(`✗ 排期弹窗失败：${error.message}`)
}
if (dialogErrors.length > 0) problems.push(`弹窗 page errors: ${dialogErrors.join(' | ')}`)
await page.close()

// ===========================================================================
// 核心流程端到端：选择本地文件夹 → 解析 → 预览校验 → 发布
// 用项目内自带的 fixtures（复刻 GEO 真实 JSON 结构），不依赖仓库外的文件。
// ===========================================================================
const flow = await context.newPage()
const flowErrors = []
flow.on('pageerror', (error) => flowErrors.push(error.message))
try {
  await flow.goto(`${BASE}/channels/tech-ai-hub`, { waitUntil: 'networkidle' })

  // 传一个目录：Playwright 对 webkitdirectory input 只接受目录路径，
  // 会递归收集其中的文件并带上 webkitRelativePath（与真人选文件夹一致）
  await flow.locator('input[type="file"]').setInputFiles('scripts/fixtures')

  await flow.waitForSelector('text=已导入', { timeout: 10_000 })

  const flowFacts = await flow.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'))
    return {
      fileCount: document.querySelectorAll('[data-slot="badge"]').length,
      rowCount: rows.length,
      rows: rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td'))
        const title = cells[1]?.querySelector('p')?.textContent?.trim() ?? ''
        const target = cells[2]?.textContent?.trim().replace(/\s+/g, ' ') ?? ''
        const check = cells[3]?.textContent?.trim() ?? ''
        return { title, target, check }
      }),
      summary: document.body.textContent?.match(/已导入\s*(\d+)\s*个文件，解析出\s*(\d+)\s*条内容[^（(]*/)?.[0] ?? null,
      publishButton:
        Array.from(document.querySelectorAll('button'))
          .map((b) => b.textContent?.trim())
          .find((t) => t?.startsWith('发布 ')) ?? null,
    }
  })

  console.log('\n---------- 上传与解析核对 ----------')
  console.log(`汇总文案：${flowFacts.summary}`)
  console.log(`候选行数：${flowFacts.rowCount}`)
  for (const row of flowFacts.rows) {
    console.log(`  · «${row.title}» | 目标：${row.target} | 校验：${row.check}`)
  }
  console.log(`发布按钮：${flowFacts.publishButton}`)

  // 断言：2 篇博客 + 1 个页面 = 3 行；且第一行正文无 class 时应回落到栏目默认博客
  if (flowFacts.rowCount !== 3) {
    problems.push(`上传 2 个 JSON 应解析出 3 条内容，实际 ${flowFacts.rowCount} 条`)
  }
  if (!flowFacts.rows.some((r) => r.target.includes('Tech & AI Hub'))) {
    problems.push('无 class 的正文没有回落到栏目默认博客 Tech & AI Hub')
  }
  if (!flowFacts.rows.some((r) => r.target.includes('discord-page'))) {
    problems.push('页面 JSON 没有识别出 template=discord-page')
  }
  if (!flowFacts.rows.some((r) => r.check.includes('错误'))) {
    problems.push('只有 2 个 H2 且无占位符的内容应被判为错误，但没有标红')
  }

  // 点发布，验证结果面板
  const publishButton = flow.locator('button', { hasText: /^发布 \d+ 篇$/ })
  if (await publishButton.count()) {
    await publishButton.first().click()
    await flow.waitForSelector('text=成功', { timeout: 10_000 })
    await flow.screenshot({ path: `${OUT_DIR}/channel-publish-result.png` })
    const resultText = await flow
      .locator('text=/成功 \\d+/')
      .first()
      .textContent()
    console.log(`✓ 发布已提交，结果面板显示：${resultText?.trim()}`)
  } else {
    problems.push('没有找到「发布 N 篇」按钮，无法提交')
  }
} catch (error) {
  problems.push(`上传发布流程: ${error.message}`)
  console.log(`✗ 上传发布流程失败：${error.message}`)
  await flow
    .screenshot({ path: `${OUT_DIR}/channel-flow-FAILED.png` })
    .catch(() => {})
}
if (flowErrors.length > 0) problems.push(`上传流程 page errors: ${flowErrors.join(' | ')}`)
await flow.close()

await browser.close()

console.log('\n================ 汇总 ================')
if (problems.length === 0) {
  console.log('全部通过：页面渲染正常，无运行时报错。')
  console.log(`截图已保存到 ${OUT_DIR}/`)
  process.exit(0)
}
console.log(`发现 ${problems.length} 个问题：`)
for (const problem of problems) console.log(` - ${problem}`)
process.exit(1)
