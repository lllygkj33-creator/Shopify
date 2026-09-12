/**
 * Shopify 内容 JSON 解析器（前端预检版）
 *
 * 职责：把用户选中的本地 JSON 解析成可预览、可校验的候选条目。
 * 与后端解析器保持**同一套规则**，这样用户在 UI 上看到的结果就是
 * 后端将要发布的结果；后端仍是权威，前端只做即时反馈。
 *
 * 两种 schema（PRD §4.3）：
 *  A. 博客文章：JSON **数组**，字段名带空格/中文（`blog title`、`html代码`）
 *  B. 页面：JSON **单对象**，含 `url`(/pages/xxx) + `template`
 *
 * 真实数据里的坑（已核对 GEO 样本）：
 *  1. 字段名必须按原样匹配：`blog title`、`meta title`、`html代码`。
 *  2. 博客归属**不能只靠 class 推断**：tech-ai-hub 的正文是裸 `<article>`。
 *  3. class 命名与文件夹名不一致：`zima-product-comparisons-article`（复数）
 *     对应文件夹 `product-comparison`（单数）。
 *  4. 除 PRD 列出的字段外，还可能有 `title type` / `faq decision` /
 *     `backlink diversity` 等审计字段，需原样透传给后端，不丢弃。
 */
import { CHANNELS, type Channel, type PageSpec } from '@/config/channels'
import { site } from '@/config/site'
import { getLang, t } from '@/i18n'
import { channelLabel } from '@/i18n/channel-label'
import type {
  ParsedCandidate,
  ParsedFile,
  ValidationIssue,
} from '@/types/content'

/** 生成稳定的临时 id（仅前端列表 key 用，不入库） */
function tempId(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return `tmp_${Math.abs(hash).toString(36)}_${seed.length}`
}

// ---------------------------------------------------------------------------
// 字段读取：容忍多种等价键名
// ---------------------------------------------------------------------------

type RawRecord = Record<string, unknown>

function pick(raw: RawRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

function pickRaw(raw: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key]
  }
  return undefined
}

/** 把可能是数组/逗号分隔字符串的字段统一成字符串数组 */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    return list.length ? list : undefined
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const list = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    return list.length ? list : undefined
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 类型识别
// ---------------------------------------------------------------------------

/**
 * blog article 的特征字段（数组 schema）
 *
 * 判据刻意放宽为「非空数组 + 元素是对象」：
 *  - 页面 schema 是**单对象**，所以数组只可能是博客文章，不存在歧义
 *  - 若按「首条必须同时有标题/正文」判断，一个首条损坏的文件会被误判成
 *    「无法识别的 JSON 结构」，反而掩盖了真正的问题。放宽后由逐条校验
 *    报告「缺标题/缺 handle/缺正文」，错误信息更有用。
 */
function looksLikeBlogArticle(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return false
  const first = value[0]
  return typeof first === 'object' && first !== null
}

/** page 的特征字段（单对象 schema） */
function looksLikePage(value: unknown): boolean {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as RawRecord
  const url = pick(record, 'url', 'handle')
  const hasHtml = Boolean(pickRaw(record, 'html', 'html代码', 'body_html'))
  const hasTemplate = Boolean(pick(record, 'template', 'template_suffix'))
  // 页面用 /pages/xxx 路径；单对象且带 template 也认为是页面
  return Boolean((url && url.startsWith('/')) || hasTemplate) || hasHtml
}

/** 判断数组 schema 属于哪个博客栏目 */
function matchBlogChannel(classNames: string[]): Channel | undefined {
  for (const className of classNames) {
    const matched = CHANNELS.find(
      (channel) => channel.htmlClass && className.includes(channel.htmlClass)
    )
    if (matched) return matched
  }
  return undefined
}

/** 判断页面 schema 属于哪个栏目 */
function matchPageChannel(record: RawRecord): Channel | undefined {
  const template = pick(record, 'template', 'template_suffix')
  if (template) {
    // 模板自由的栏目（Custom）不参与按模板匹配，否则会把别人的模板抢走
    const byTemplate = CHANNELS.find(
      (channel) =>
        !channel.pageSpec?.allowAnyTemplate && channel.template === template
    )
    if (byTemplate) return byTemplate
  }
  // 退而求其次：按来源键名（com_source / discord_source ...）
  for (const channel of CHANNELS) {
    const pageSourceKey = channel.pageSpec?.sourceKey
    if (pageSourceKey && record[pageSourceKey] !== undefined) {
      return channel
    }
  }
  return undefined
}

/** 栏目的展示名（按当前语言取 name / nameZh） */
function channelName(channel: Channel): string {
  return channelLabel(channel, getLang())
}

/**
 * 上传时这条内容归哪个栏目。
 *
 * **规则：JSON 自报的栏目和当前上传栏目不一致 → 按当前栏目处理并报错**，
 * 不能静默改栏目。
 *
 * 原来是 `byClass?.id ?? fallbackChannelId`（页面同理），JSON 赢了：
 * 在社区文章页上传一份 Discord 的 JSON，它会悄悄归到 Discord 栏目，
 * 用户在列表里看到的位置、本地记的栏目、内容实际去的线上位置三者不一致，
 * 而且没有任何提示。
 *
 * 返回的 mismatch 由调用方挂成 **error** 级问题 —— error 会禁用该条的勾选框，
 * 拦在发布之前（warning 拦不住）。
 */
function resolveUploadChannel(
  detected: Channel | undefined,
  fallbackChannelId: string | undefined,
  defaultChannelId: string
): { channelId: string; mismatch?: string } {
  const current = CHANNELS.find((channel) => channel.id === fallbackChannelId)

  // Custom 栏目豁免：它存在的意义就是「模板由 JSON 自由指定」，
  // 在那里上传别的栏目的模板是有意为之，不算进错栏目。
  // 后端在该栏目的 allow_any_template 分支同样不做这个检查，两边一致。
  if (current?.pageSpec?.allowAnyTemplate) {
    return { channelId: current.id }
  }

  if (current && detected && detected.id !== current.id) {
    return {
      channelId: current.id,
      mismatch: t('shell.json.channelMismatch', {
        detected: channelName(detected),
        current: channelName(current),
      }),
    }
  }

  // 认不出归属时（detected 为空）沿用原来的自动判断
  return { channelId: detected?.id ?? fallbackChannelId ?? defaultChannelId }
}

/** 把「进错栏目」挂成 error 级问题（error 才会拦住发布） */
function mismatchIssue(mismatch: string | undefined): ValidationIssue[] {
  return mismatch
    ? [
        {
          level: 'error',
          field: t('shell.json.field.channel'),
          message: mismatch,
        },
      ]
    : []
}

/** 从正文里抽出所有 class 名 */
function extractClassNames(html: string): string[] {
  const matches = html.matchAll(/class\s*=\s*["']([^"']+)["']/gi)
  const names: string[] = []
  for (const match of matches) {
    names.push(...match[1].split(/\s+/).filter(Boolean))
  }
  return names
}

/**
 * 解析正文的博客归属。
 * 规则：**先看正文 class，找不到再落回栏目默认 blogName**。
 * 这是对 PRD「由 class 推断」的修正——class 可能是缺失的。
 */
export function resolveBlogName(
  html: string,
  fallbackChannel?: Channel
): { blogName?: string; source: 'class' | 'channel' | 'none' } {
  const classNames = extractClassNames(html)
  const byClass = matchBlogChannel(classNames)
  if (byClass?.blogName) {
    return { blogName: byClass.blogName, source: 'class' }
  }
  if (fallbackChannel?.blogName) {
    return { blogName: fallbackChannel.blogName, source: 'channel' }
  }
  return { source: 'none' }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 发布脚本的硬性规则（放到上传阶段提前拦，避免点了发布才逐条失败）
// ---------------------------------------------------------------------------

/** 文章 handle 必须严格匹配（脚本 normalize_handle 的正则） */
const ARTICLE_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** meta description 与 summary 的长度上限（脚本硬校验） */
const META_TEXT_MAX_LENGTH = 160

/**
 * 页面正文的硬性规则（脚本 `validate_payload()` 逐条对应）：
 *  - 禁用 `<h1>`：H1 由 page.title / Liquid 输出
 *  - 必须至少有一个 `<h2>`
 *  - 每个 `<img>` 必须同时有非空 `alt` 和 `title`
 *  - 每个 `<a>` 必须有非空 `title`
 */
function checkPageHtmlRules(
  html: string,
  h2Min = 0,
  forbidH2 = false
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!html) return issues

  const lower = html.toLowerCase()

  if (lower.includes('<h1')) {
    issues.push({
      level: 'error',
      field: 'html',
      message: t('shell.json.h1Forbidden'),
    })
  }

  const h2Count = (html.match(/<h2\b/gi) ?? []).length
  if (forbidH2 && h2Count > 0) {
    issues.push({
      level: 'error',
      field: 'html',
      message: t('shell.json.h2Forbidden'),
    })
  } else if (h2Count < h2Min) {
    issues.push({
      level: 'error',
      field: 'html',
      message: t('shell.json.h2Min', { min: h2Min, count: h2Count }),
    })
  }

  const images = html.match(/<img\b[^>]*>/gi) ?? []
  images.forEach((tag, index) => {
    if (!/\balt\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.imageAlt', { n: index + 1 }),
      })
    }
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.imageTitle', { n: index + 1 }),
      })
    }
  })

  const anchors = html.match(/<a\b[^>]*>/gi) ?? []
  anchors.forEach((tag, index) => {
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkTitle', { n: index + 1 }),
      })
    }
  })

  return issues
}

/** 按 spec 归一化来源对象（主要是 Discord 的 channel_name 要剥掉 '#'） */
function normalizePageSource(
  raw: unknown,
  spec?: PageSpec
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const source = { ...(raw as Record<string, unknown>) }

  for (const field of spec?.stripHashPrefix ?? []) {
    const value = source[field]
    if (typeof value === 'string') {
      source[field] = value.replace(/^#+/, '').trim()
    }
  }

  return source
}

/**
 * 确定来源 metafield 的键名。
 *
 * - 固定栏目：`spec.sourceKey`
 * - Custom 栏目：JSON 里任一以 `spec.sourceKeySuffix` 结尾的顶层对象
 *   （键名原样使用，所以 `community_source` / `maker_source` / 自定义名都行）
 */
function resolveSourceKeyFor(
  raw: Record<string, unknown>,
  spec?: PageSpec
): string {
  if (spec?.sourceKey) return spec.sourceKey

  const suffix = spec?.sourceKeySuffix
  if (!suffix) return ''

  for (const key of Object.keys(raw)) {
    if (!key.endsWith(suffix)) continue
    const value = raw[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return key
    if (typeof value === 'string' && value.trim()) return key
  }

  return ''
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * 外链规则（所有栏目共用；后端 html_audit.py 是同一套逻辑）。
 *
 * - 所有链接要有非空 `title`
 * - 相对路径 / 站内（shop.example-store.test）/ 自家域名（*.example-store.test）只要求 title
 * - 第三方外链要有 target="_blank" + rel 含 noopener / noreferrer / nofollow
 *
 * 站内与自家域名不强制新标签页，所以不会误伤既有文章。
 */
// 站内域名与前台域名来自站点配置 —— 写死会把部署信息带进仓库
const FIRST_PARTY_SUFFIXES = site.firstPartySuffixes
const SHOP_HOST = site.storefrontDomain

function isFirstPartyHost(host: string): boolean {
  const value = host.toLowerCase().replace(/^\.+|\.+$/g, '')
  return FIRST_PARTY_SUFFIXES.some(
    (suffix) => value === suffix || value.endsWith(`.${suffix}`)
  )
}

function checkExternalLinks(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!html) return issues

  const anchors = html.match(/<a\b[^>]*>/gi) ?? []

  anchors.forEach((tag, index) => {
    const position = index + 1
    const href = getTagAttr(tag, 'href')
    const title = getTagAttr(tag, 'title')

    if (!href) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkHref', { n: position }),
      })
      return
    }
    if (!title) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkTitle', { n: position }),
      })
    }

    // 相对路径 / 页内锚点
    if (href.startsWith('/') || href.startsWith('#')) return
    if (!/^https?:\/\//i.test(href)) return

    let host: string
    try {
      host = new URL(href).hostname.toLowerCase()
    } catch {
      return
    }

    if (host === SHOP_HOST || isFirstPartyHost(host)) return

    const target = (getTagAttr(tag, 'target') ?? '').toLowerCase()
    const rel = new Set(
      (getTagAttr(tag, 'rel') ?? '')
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean)
    )

    if (target !== '_blank') {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkTargetBlank', { n: position }),
      })
    }
    const missing = ['noopener', 'noreferrer'].filter(
      (token) => !rel.has(token)
    )
    if (missing.length > 0) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkRel', {
          n: position,
          tokens: missing.join(t('shell.separator.item')),
        }),
      })
    }
    if (!rel.has('nofollow')) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.linkNofollow', { n: position }),
      })
    }
  })

  return issues
}

/** 取标签上的属性值（单双引号都支持） */
function getTagAttr(tag: string, attr: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i')
  )
  return match ? match[1].trim() : null
}

function isCompleteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 来源对象校验。规则全部来自 spec（各栏目脚本要求不同）：
 *  - Discord 的 url 必须是 Discord 消息链接（正则）
 *  - 社区 / 作者主页链接是前缀匹配
 *  - invite_url 允许为空，但非空就必须是完整链接
 */
function checkPageSource(
  source: Record<string, unknown> | undefined,
  spec: PageSpec
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const field = (name: string) => `${spec.sourceKey}.${name}`

  if (!source) {
    issues.push({
      level: 'error',
      field: spec.sourceKey,
      message: t('shell.json.sourceMissing', { key: spec.sourceKey }),
    })
    return issues
  }

  for (const name of spec.sourceFields ?? []) {
    const value = source[name]
    if (typeof value !== 'string') {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceNotString', { field: field(name) }),
      })
      continue
    }

    const trimmed = value.trim()
    if ((spec.sourceRequiredNonEmpty ?? []).includes(name) && !trimmed) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceEmpty', { field: field(name) }),
      })
      continue
    }
    if (!trimmed) continue

    const prefix = spec.sourceFieldPrefixes?.[name]
    if (prefix && !trimmed.startsWith(prefix)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourcePrefix', { prefix }),
      })
    }

    const pattern = spec.sourceFieldRegexes?.[name]
    if (pattern && !new RegExp(pattern, 'i').test(trimmed)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceRegex', { pattern }),
      })
    }

    if (
      (spec.sourceHttpUrlFields ?? []).includes(name) &&
      !isCompleteHttpUrl(trimmed)
    ) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceHttpUrl'),
      })
      continue
    }

    if ((spec.sourceHostAllowlist ?? []).length > 0) {
      try {
        const host = new URL(trimmed).hostname.toLowerCase()
        const allowed = spec.sourceHostAllowlist ?? []
        if (
          !allowed.some((item) => host === item || host.endsWith(`.${item}`))
        ) {
          issues.push({
            level: 'error',
            field: field(name),
            message: t('shell.json.sourceHost', { hosts: allowed.join(' / ') }),
          })
        }
      } catch {
        // 上面已经报过"必须是完整链接"
      }
    }

    const expected = spec.sourceExactValues?.[name]
    if (expected && trimmed.toLowerCase() !== expected.toLowerCase()) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceExact', { expected, actual: trimmed }),
      })
    }

    if (
      (spec.sourceDigitFields ?? []).includes(name) &&
      !/^\d+$/.test(trimmed)
    ) {
      issues.push({
        level: 'error',
        field: field(name),
        message: t('shell.json.sourceDigits'),
      })
    }
  }

  // 来源 URL 路径必须包含片段（MakerWorld 的 /models/）
  if (spec.sourcePathContains) {
    const url = source['url']
    if (typeof url === 'string' && url.trim()) {
      try {
        if (!new URL(url).pathname.includes(spec.sourcePathContains)) {
          issues.push({
            level: 'error',
            field: field('url'),
            message: t('shell.json.sourceModelPath', {
              segment: spec.sourcePathContains,
            }),
          })
        }
      } catch {
        // 链接格式问题上面已报
      }
    }
  }

  return issues
}

/** 页面 handle：剥掉 /pages/ 前缀后的裸 handle（API 只接受裸 handle） */
function normalizePageHandleBare(value: string): string {
  let handle = value.trim()
  if (!handle) return ''

  if (/^https?:\/\//i.test(handle)) {
    try {
      handle = new URL(handle).pathname
    } catch {
      // 解析失败就按原字符串继续处理
    }
  }

  handle = handle.split('?')[0].split('#')[0]
  handle = handle.replace(/^\/+|\/+$/g, '')
  if (handle.startsWith('pages/')) handle = handle.slice('pages/'.length)

  return handle.replace(/^\/+|\/+$/g, '')
}

/**
 * 正文占位符规则（与 GEO 一致）：
 *  - 若正文已含 `[[related_products_1]]`，无需注入。
 *  - 若要注入，正文必须有 **≥ 4 个 H2**，否则 GEO 会直接抛错中断。
 * 这里提前在 UI 标红，避免发布时才炸。
 */
export function checkRelatedProductsPlaceholder(
  html: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (/\[\[related_products_\d+\]\]/.test(html)) {
    return issues
  }
  const h2Count = (html.match(/<h2\b[^>]*>/gi) ?? []).length
  if (h2Count > 0 && h2Count < 4) {
    issues.push({
      level: 'error',
      field: 'html代码',
      message: t('shell.json.relatedProductsH2', { count: h2Count }),
    })
  } else if (h2Count === 0) {
    issues.push({
      level: 'warning',
      field: 'html代码',
      message: t('shell.json.relatedProductsNoH2'),
    })
  }
  return issues
}

/** 页面 handle 规范化：确保带前导斜杠 */
export function normalizePageHandle(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed
  // 允许用户只填 handle，自动补 /pages/ 前缀
  if (!trimmed.includes('/')) return `/pages/${trimmed}`
  return `/${trimmed}`
}

/** 博客文章 handle 规范化：去掉前导斜杠与 /blogs/... 前缀 */
export function normalizeArticleHandle(url: string): string {
  let handle = url.trim().replace(/^\/+/, '')
  const blogMatch = handle.match(/^blogs\/[^/]+\/(.+)$/)
  if (blogMatch) handle = blogMatch[1]
  const pagesMatch = handle.match(/^pages\/(.+)$/)
  if (pagesMatch) handle = pagesMatch[1]
  return handle.replace(/\/+$/, '')
}

/** 从 handle 推导出对外可访问的 URL（发布成功后展示用） */
export function buildPublicUrl(
  contentType: 'blog_article' | 'page',
  handle: string,
  blogHandle?: string
): string {
  if (contentType === 'page') {
    return normalizePageHandle(handle)
  }
  return `/blogs/${blogHandle ?? 'news'}/${normalizeArticleHandle(handle)}`
}

// ---------------------------------------------------------------------------
// 归一化：博客文章
// ---------------------------------------------------------------------------

function normalizeBlogCandidate(
  raw: RawRecord,
  filePath: string,
  index: number,
  channelId: string,
  channel?: Channel
): ParsedCandidate {
  const issues: ValidationIssue[] = []

  const title = pick(raw, 'blog title', 'title') ?? ''
  const html = pick(raw, 'html代码', 'html', 'body_html') ?? ''
  const rawHandle = pick(raw, 'url', 'handle') ?? ''
  const handle = normalizeArticleHandle(rawHandle)

  const metaTitle = pick(raw, 'meta title', 'meta_title', 'seo title')
  const metaDescription = pick(
    raw,
    'meta description',
    'meta_description',
    'seo description'
  )
  const summary = pick(raw, 'summary', 'excerpt')

  if (!title)
    issues.push({
      level: 'error',
      field: 'blog title',
      message: t('shell.json.missingTitle'),
    })
  if (!handle)
    issues.push({
      level: 'error',
      field: 'url',
      message: t('shell.json.missingHandle'),
    })
  if (!html)
    issues.push({
      level: 'error',
      field: 'html代码',
      message: t('shell.json.missingBody'),
    })

  // 脚本把这 6 个字段全部视为必填（缺一个就整体报错），所以这里是 error
  if (!metaTitle)
    issues.push({
      level: 'error',
      field: 'meta title',
      message: t('shell.json.missingMetaTitle'),
    })
  if (!metaDescription)
    issues.push({
      level: 'error',
      field: 'meta description',
      message: t('shell.json.missingMetaDescription'),
    })
  if (!summary)
    issues.push({
      level: 'error',
      field: 'summary',
      message: t('shell.json.missingSummary'),
    })

  if (metaDescription && metaDescription.length > META_TEXT_MAX_LENGTH) {
    issues.push({
      level: 'error',
      field: 'meta description',
      message: t('shell.json.metaDescriptionTooLong', {
        max: META_TEXT_MAX_LENGTH,
        length: metaDescription.length,
      }),
    })
  }
  if (summary && summary.length > META_TEXT_MAX_LENGTH) {
    issues.push({
      level: 'error',
      field: 'summary',
      message: t('shell.json.summaryTooLong', {
        max: META_TEXT_MAX_LENGTH,
        length: summary.length,
      }),
    })
  }

  // handle 正则与脚本一致：大写、下划线、中文都会被 Shopify 侧拒绝
  if (handle && !ARTICLE_HANDLE_PATTERN.test(handle)) {
    issues.push({
      level: 'error',
      field: 'url',
      message: t('shell.json.handlePattern', { handle }),
    })
  }

  if (rawHandle && rawHandle.startsWith('/')) {
    issues.push({
      level: 'warning',
      field: 'url',
      message: t('shell.json.articleUrlNormalized', { handle }),
    })
  }

  if (html) issues.push(...checkRelatedProductsPlaceholder(html))

  // 外链规则（平台新增：参考博客脚本没有这一段）
  if (html) issues.push(...checkExternalLinks(html))

  const resolved = resolveBlogName(html, channel)
  if (resolved.source === 'none') {
    issues.push({
      level: 'error',
      field: 'html代码',
      message: t('shell.json.blogUnknown'),
    })
  } else if (resolved.source === 'channel') {
    issues.push({
      level: 'warning',
      field: 'html代码',
      message: t('shell.json.blogFallback', { blog: resolved.blogName ?? '' }),
    })
  }
  const author = pick(raw, 'author', '作者')
  if (!author) {
    issues.push({
      level: 'warning',
      field: 'author',
      message: t('shell.json.authorMissing'),
    })
  }

  return {
    tempId: tempId(`${filePath}#${index}#${handle}`),
    channelId,
    contentType: 'blog_article',
    title,
    handle,
    blogName: resolved.blogName,
    bodyHtml: html,
    summary,
    metaTitle,
    metaDescription,
    author,
    reviewer: pick(raw, 'reviewer', '审核'),
    relatedProducts: toStringArray(
      pickRaw(raw, 'related_products', 'related products')
    ),
    tags: toStringArray(pickRaw(raw, 'tags', 'tag')),
    sourceFile: filePath,
    sourceIndex: index,
    // 注意：不再包含「日期文件夹」，排期完全由用户在 UI 指定（PRD §4.4）
    publishKey: `${channelId}|${basename(filePath)}|${index}|${handle}`,
    issues,
    publishable: !issues.some((issue) => issue.level === 'error'),
  }
}

// ---------------------------------------------------------------------------
// 归一化：页面
// ---------------------------------------------------------------------------

function normalizePageCandidate(
  raw: RawRecord,
  filePath: string,
  index: number,
  channelId: string,
  channel?: Channel
): ParsedCandidate {
  const issues: ValidationIssue[] = []

  const spec = channel?.pageSpec
  const expectedTemplate = spec?.template ?? channel?.template

  const title =
    pick(raw, 'title', 'page_title', 'page title', 'blog title') ?? ''
  const html =
    pick(raw, 'html', 'html代码', 'body', 'body_html', 'HTML', 'content') ?? ''
  const rawUrl = pick(raw, 'url', 'handle', 'page_url', 'page url') ?? ''

  // 展示用 /pages/xxx；API 只接受裸 handle，所以两者都要有
  const handle = normalizePageHandle(rawUrl)
  const bareHandle = normalizePageHandleBare(rawUrl)

  const template =
    pick(raw, 'template_suffix', 'template', 'templateSuffix') ??
    expectedTemplate ??
    ''

  const metaTitle =
    pick(raw, 'meta title', 'meta_title', 'seo title', 'seo_title') ?? ''
  // 脚本里 meta description 的首选键名是 'td'（历史遗留），保留以兼容既有 JSON
  const metaDescription =
    pick(
      raw,
      'td',
      'meta description',
      'meta_description',
      'seo description',
      'seo_description'
    ) ?? ''

  // ---- 必填字段（脚本 require_text，全部是硬错误） ----
  if (!title) {
    issues.push({
      level: 'error',
      field: 'title',
      message: t('shell.json.missingPageTitle'),
    })
  }
  if (!bareHandle) {
    issues.push({
      level: 'error',
      field: 'url',
      message: t('shell.json.missingPageUrl'),
    })
  } else if (!ARTICLE_HANDLE_PATTERN.test(bareHandle)) {
    issues.push({
      level: 'error',
      field: 'url',
      message: t('shell.json.pageHandlePattern', { handle: bareHandle }),
    })
  }
  if (!html) {
    issues.push({
      level: 'error',
      field: 'html',
      message: t('shell.json.missingPageBody'),
    })
  }
  if (!metaTitle) {
    issues.push({
      level: 'error',
      field: 'meta title',
      message: t('shell.json.missingMetaTitle'),
    })
  }
  if (!metaDescription) {
    issues.push({
      level: 'error',
      field: 'td / meta description',
      message: t('shell.json.missingMetaDescription'),
    })
  }

  // 注意：这里**刻意不对裸 handle 报警**。
  // 参考脚本的 Expected JSON（VS / MakerWorld）以及真实的社区文件都用裸 handle，
  // 脚本的 normalize_handle 两种写法都接受。给常态加提示只会制造噪音，
  // 让人慢慢无视整个校验列。

  // ---- 模板校验 ----
  // allowAnyTemplate（Custom 文章）：模板由 JSON 自由指定，不做白名单校验
  if (spec?.allowAnyTemplate) {
    if (!template) {
      issues.push({
        level: 'error',
        field: 'template',
        message: t('shell.json.templateRequired'),
      })
    }
  } else if (!template) {
    issues.push({
      level: 'error',
      field: 'template',
      message: expectedTemplate
        ? t('shell.json.templateMissingExpected', {
            template: expectedTemplate,
          })
        : t('shell.json.templateMissingSpec'),
    })
  } else if (expectedTemplate && template !== expectedTemplate) {
    issues.push({
      level: 'error',
      field: 'template',
      message: t('shell.json.templateMismatch', {
        expected: expectedTemplate,
        actual: template,
      }),
    })
  }

  // ---- meta 长度规则按栏目不同 ----
  // Discord 脚本要求 meta_title ≤ 65、meta description 在 120~170；
  // 社区脚本没有这两条规则，所以只在 spec 声明时才检查。
  if (spec?.metaTitleMax && metaTitle.length > spec.metaTitleMax) {
    issues.push({
      level: 'error',
      field: 'meta title',
      message: t('shell.json.metaTitleTooLong', {
        max: spec.metaTitleMax,
        length: metaTitle.length,
      }),
    })
  }
  if (spec?.metaDescriptionMin || spec?.metaDescriptionMax) {
    const length = metaDescription.length
    const tooShort =
      Boolean(spec.metaDescriptionMin) &&
      length < (spec.metaDescriptionMin ?? 0)
    const tooLong =
      Boolean(spec.metaDescriptionMax) &&
      length > (spec.metaDescriptionMax ?? 0)
    if (tooShort || tooLong) {
      issues.push({
        level: 'error',
        field: 'td / meta description',
        message: t('shell.json.metaDescriptionRange', {
          min: spec.metaDescriptionMin ?? 0,
          max: spec.metaDescriptionMax ?? 0,
          length,
        }),
      })
    }
  }

  if (spec?.summaryMin) {
    const summaryValue =
      typeof raw['summary'] === 'string' ? String(raw['summary']).trim() : ''
    if (summaryValue.length < spec.summaryMin) {
      issues.push({
        level: 'error',
        field: 'summary',
        message: t('shell.json.summaryTooShort', {
          min: spec.summaryMin,
          length: summaryValue.length,
        }),
      })
    }
  }

  // ---- 外链规则（社区 / Discord / 用户故事）----
  if (spec?.enforceLinkRules) {
    issues.push(...checkExternalLinks(html))
  }

  // ---- 正文硬规则：禁 h1 / 至少 h2Min 个 h2 / img alt+title / a title ----
  issues.push(
    ...checkPageHtmlRules(html, spec?.h2Min ?? 0, spec?.forbidH2 ?? false)
  )

  // 正文必须逐字包含的固定文案（用户故事要求两句固定段落）
  for (const required of spec?.bodyMustContain ?? []) {
    if (!html.includes(required)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.bodyMustContain', { text: required }),
      })
    }
  }

  // COMPARE 标记对必须各出现恰好一次（VS）
  for (const marker of spec?.requiredMarkerPairs ?? []) {
    const open = `<!-- COMPARE:${marker} -->`
    const close = `<!-- /COMPARE:${marker} -->`
    if (countOccurrences(html, open) !== 1) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.markerOpen', { marker, tag: open }),
      })
    }
    if (countOccurrences(html, close) !== 1) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.markerClose', { marker, tag: close }),
      })
    }
  }

  // 未替换的占位串（VS）
  for (const placeholder of spec?.forbiddenPlaceholders ?? []) {
    if (html.toLowerCase().includes(placeholder.toLowerCase())) {
      issues.push({
        level: 'error',
        field: 'html',
        message: t('shell.json.forbiddenPlaceholder', { placeholder }),
      })
    }
  }

  // published 必须为 true / related_products 必须为空（VS）
  if (spec?.requirePublishedTrue && pickRaw(raw, 'published') === false) {
    issues.push({
      level: 'error',
      field: 'published',
      message: t('shell.json.publishedMustBeTrue'),
    })
  } else if (pickRaw(raw, 'published') === false) {
    issues.push({
      level: 'warning',
      field: 'published',
      message: t('shell.json.publishedFalse'),
    })
  }

  if (spec?.requireEmptyRelatedProducts) {
    const related = pickRaw(raw, 'related_products', 'related products')
    if (Array.isArray(related) && related.length > 0) {
      issues.push({
        level: 'error',
        field: 'related_products',
        message: t('shell.json.relatedProductsMustBeEmpty'),
      })
    }
  }

  // ---- 来源对象（custom.<sourceKey> json metafield） ----
  // 固定栏目用 spec.sourceKey；Custom 栏目用 sourceKeySuffix 自动识别
  // （JSON 里任一 *_source 顶层对象，键名原样作为 metafield key）
  const resolvedSourceKey = resolveSourceKeyFor(raw, spec)

  const rawSource = resolvedSourceKey ? raw[resolvedSourceKey] : undefined
  // 归一化（剥掉 Discord channel_name 的前导 '#'）后再提交给后端
  const source = normalizePageSource(rawSource, spec)

  if (spec?.verified && spec.sourceKey) {
    // 固定栏目：按规格强校验来源字段
    issues.push(...checkPageSource(source, spec))
  } else if (resolvedSourceKey && !source && !spec?.sourceKeySuffix) {
    // 未核对规格的固定栏目：只提示，不阻断
    issues.push({
      level: 'warning',
      field: resolvedSourceKey,
      message: t('shell.json.sourceUnverified', { key: resolvedSourceKey }),
    })
  }
  // Custom 文章（sourceKeySuffix）的来源对象是**可选**的：
  // 有就写成 custom.<key>，没有就不写 —— 所以这里不提示。

  // 可选反链：页面发布后往某篇博客文章追加幂等上下文反链
  const rawBacklink = pickRaw(raw, 'backlink')
  const backlink =
    rawBacklink &&
    typeof rawBacklink === 'object' &&
    !Array.isArray(rawBacklink)
      ? (rawBacklink as Record<string, unknown>)
      : undefined

  return {
    tempId: tempId(`${filePath}#${index}#${handle}`),
    channelId,
    contentType: 'page',
    title,
    handle,
    template,
    bodyHtml: html,
    // MakerWorld 的 summary 是独立必填字段（会写成 custom.maker_summary），
    // 其他栏目没有就用 meta description 兜底
    summary:
      typeof raw['summary'] === 'string' && String(raw['summary']).trim()
        ? String(raw['summary']).trim()
        : metaDescription,
    metaTitle,
    metaDescription,
    author: pick(raw, 'author'),
    // 页面**不使用** related_products：参考脚本刻意不写 custom.related_products，
    // 避免清掉页面上已有的商品列表 metafield
    source,
    sourceKey: resolvedSourceKey,
    backlink,
    sourceFile: filePath,
    sourceIndex: index,
    publishKey: `${channelId}|${basename(filePath)}|${index}|${handle}`,
    issues,
    publishable: !issues.some((issue) => issue.level === 'error'),
  }
}

function basename(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] ?? filePath
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/**
 * 解析一个 JSON 文件的**字符串内容**。
 * 之所以接收字符串而不是 File，是为了同时支持：
 *  - <input type="file"> / 拖拽（FileReader 读出的文本）
 *  - 后端返回的已有内容（历史记录回看）
 *  - 单元测试
 */
export function parseJsonContent(
  text: string,
  filePath: string,
  fallbackChannelId?: string
): ParsedFile {
  const fileName = basename(filePath)

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return {
      fileName,
      filePath,
      detected: 'unknown',
      candidates: [],
      error: t('shell.json.syntaxError', {
        message: (error as Error).message,
      }),
    }
  }

  // --- A. 博客文章数组 ---
  if (looksLikeBlogArticle(data)) {
    const list = data as RawRecord[]
    const candidates: ParsedCandidate[] = []

    // 逐条解析：单条失败不影响其他条目
    list.forEach((item, index) => {
      try {
        const html = pick(item, 'html代码', 'html', 'body_html') ?? ''
        const byClass = matchBlogChannel(extractClassNames(html))
        const { channelId, mismatch } = resolveUploadChannel(
          byClass,
          fallbackChannelId,
          CHANNELS.find((c) => c.contentType === 'blog_article')?.id ??
            'tech-ai-hub'
        )
        const channel = CHANNELS.find((c) => c.id === channelId)
        const candidate = normalizeBlogCandidate(
          item,
          filePath,
          index,
          channelId,
          channel
        )
        candidate.issues.unshift(...mismatchIssue(mismatch))
        candidates.push(candidate)
      } catch (error) {
        candidates.push(
          errorCandidate(
            filePath,
            index,
            fallbackChannelId,
            (error as Error).message
          )
        )
      }
    })

    return { fileName, filePath, detected: 'blog_article', candidates }
  }

  // --- B. 页面单对象 ---
  if (looksLikePage(data)) {
    const record = data as RawRecord
    const byTemplate = matchPageChannel(record)
    const { channelId, mismatch } = resolveUploadChannel(
      byTemplate,
      fallbackChannelId,
      CHANNELS.find((c) => c.contentType === 'page')?.id ?? 'community-post'
    )
    const channel = CHANNELS.find((c) => c.id === channelId)
    try {
      const candidate = normalizePageCandidate(
        record,
        filePath,
        0,
        channelId,
        channel
      )
      candidate.issues.unshift(...mismatchIssue(mismatch))
      return {
        fileName,
        filePath,
        detected: 'page',
        candidates: [candidate],
      }
    } catch (error) {
      return {
        fileName,
        filePath,
        detected: 'page',
        candidates: [],
        error: t('shell.json.parseFailed', {
          message: (error as Error).message,
        }),
      }
    }
  }

  // --- C. 无法识别 ---
  return {
    fileName,
    filePath,
    detected: 'unknown',
    candidates: [],
    error: t('shell.json.unknownStructure'),
  }
}

function errorCandidate(
  filePath: string,
  index: number,
  channelId: string | undefined,
  message: string
): ParsedCandidate {
  const id = channelId ?? 'tech-ai-hub'
  return {
    tempId: tempId(`${filePath}#${index}#error`),
    channelId: id,
    contentType: 'blog_article',
    title: t('shell.json.itemFailed', { n: index + 1 }),
    handle: '',
    bodyHtml: '',
    sourceFile: filePath,
    sourceIndex: index,
    publishKey: `${id}|${basename(filePath)}|${index}|`,
    issues: [
      {
        level: 'error',
        message: t('shell.json.parseFailed', { message }),
      },
    ],
    publishable: false,
  }
}
