/**
 * 从官方 SVG 生成 favicon 的 PNG 回退版本。
 *
 * 为什么要这一步：index.html 里除了 SVG 还引了 PNG（老浏览器回退）。
 * 换了 SVG 之后 PNG 也要跟着换，否则两者不一致。
 *
 * 用本机 Chrome 无头渲染，避免引入 sharp / imagemagick 依赖。
 *
 * 用法：node scripts/generate-favicon-png.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const SIZE = 48 // 与模板原来的 PNG 一致
const TARGETS = ['favicon.png', 'favicon_light.png']

const svg = readFileSync('public/images/favicon.svg', 'utf8')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })

await page.setContent(
  `<html><body style="margin:0;background:transparent">
     <div id="box" style="width:${SIZE}px;height:${SIZE}px">${svg.replace(
       /width="[^"]*" height="[^"]*"/,
       `width="${SIZE}" height="${SIZE}"`
     )}</div>
   </body></html>`
)

for (const target of TARGETS) {
  await page.locator('#box').screenshot({
    path: `public/images/${target}`,
    omitBackground: true,
  })
  console.log(`✓ public/images/${target} (${SIZE}×${SIZE})`)
}

await browser.close()
