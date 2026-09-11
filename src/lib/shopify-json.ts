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
      (channel) =>
        channel.htmlClass && className.includes(channel.htmlClass)
    )
    if (matched) return matched
  }
  return undefined
}

/** 判断页面 schema 属于哪个栏目 */
function matchPageChannel(record: RawRecord): Channel | undefined {
  const template = pick(record, 'template', 'template_suffix')
  if (template) {
    const byTemplate = CHANNELS.find((channel) => channel.template === template)
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
function checkPageHtmlRules(html: string, h2Min = 1): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!html) return issues

  const lower = html.toLowerCase()

  if (lower.includes('<h1')) {
    issues.push({
      level: 'error',
      field: 'html',
      message: '正文包含 <h1>；H1 应由 page.title / Liquid 输出，请改用 <h2>',
    })
  }

  const h2Count = (html.match(/<h2\b/gi) ?? []).length
  if (h2Count < h2Min) {
    issues.push({
      level: 'error',
      field: 'html',
      message: `正文必须至少包含 ${h2Min} 个 <h2> 章节；当前 ${h2Count} 个`,
    })
  }

  const images = html.match(/<img\b[^>]*>/gi) ?? []
  images.forEach((tag, index) => {
    if (!/\balt\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: `第 ${index + 1} 张图片缺少非空 alt 属性`,
      })
    }
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: `第 ${index + 1} 张图片缺少非空 title 属性`,
      })
    }
  })

  const anchors = html.match(/<a\b[^>]*>/gi) ?? []
  anchors.forEach((tag, index) => {
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(tag)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: `第 ${index + 1} 个链接缺少非空 title 属性`,
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
      message: `缺少 ${spec.sourceKey} 来源对象（发布必填）`,
    })
    return issues
  }

  for (const name of spec.sourceFields ?? []) {
    const value = source[name]
    if (typeof value !== 'string') {
      issues.push({
        level: 'error',
        field: field(name),
        message: `${field(name)} 必须是字符串`,
      })
      continue
    }

    const trimmed = value.trim()
    if ((spec.sourceRequiredNonEmpty ?? []).includes(name) && !trimmed) {
      issues.push({
        level: 'error',
        field: field(name),
        message: `${field(name)} 不能为空`,
      })
      continue
    }
    if (!trimmed) continue

    const prefix = spec.sourceFieldPrefixes?.[name]
    if (prefix && !trimmed.startsWith(prefix)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: `必须以 ${prefix} 开头`,
      })
    }

    const pattern = spec.sourceFieldRegexes?.[name]
    if (pattern && !new RegExp(pattern, 'i').test(trimmed)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: `格式不正确（应匹配 ${pattern}）`,
      })
    }

    if ((spec.sourceHttpUrlFields ?? []).includes(name) && !isCompleteHttpUrl(trimmed)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: `必须是完整的 http(s) 链接`,
      })
      continue
    }

    if ((spec.sourceHostAllowlist ?? []).length > 0) {
      try {
        const host = new URL(trimmed).hostname.toLowerCase()
        const allowed = spec.sourceHostAllowlist ?? []
        if (!allowed.some((item) => host === item || host.endsWith(`.${item}`))) {
          issues.push({
            level: 'error',
            field: field(name),
            message: `必须指向 ${allowed.join(' / ')}`,
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
        message: `必须是「${expected}」，当前「${trimmed}」`,
      })
    }

    if ((spec.sourceDigitFields ?? []).includes(name) && !/^\d+$/.test(trimmed)) {
      issues.push({
        level: 'error',
        field: field(name),
        message: '只能包含数字或留空',
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
            message: `必须指向模型页（路径需包含 ${spec.sourcePathContains}）`,
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
export function checkRelatedProductsPlaceholder(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (/\[\[related_products_\d+\]\]/.test(html)) {
    return issues
  }
  const h2Count = (html.match(/<h2\b[^>]*>/gi) ?? []).length
  if (h2Count > 0 && h2Count < 4) {
    issues.push({
      level: 'error',
      field: 'html代码',
      message: `正文只有 ${h2Count} 个 H2，无法插入 [[related_products_1]] 占位符（需要 ≥ 4 个 H2），且正文未自带占位符`,
    })
  } else if (h2Count === 0) {
    issues.push({
      level: 'warning',
      field: 'html代码',
      message:
        '正文没有 H2 标题，无法自动插入关联产品占位符；若模板需要占位符请手动加入 [[related_products_1]]',
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

  if (!title) issues.push({ level: 'error', field: 'blog title', message: '缺少文章标题' })
  if (!handle)
    issues.push({ level: 'error', field: 'url', message: '缺少文章 handle（url）' })
  if (!html)
    issues.push({ level: 'error', field: 'html代码', message: '缺少正文 HTML' })

  // 脚本把这 6 个字段全部视为必填（缺一个就整体报错），所以这里是 error
  if (!metaTitle)
    issues.push({
      level: 'error',
      field: 'meta title',
      message: '缺少 meta title（发布必填）',
    })
  if (!metaDescription)
    issues.push({
      level: 'error',
      field: 'meta description',
      message: '缺少 meta description（发布必填）',
    })
  if (!summary)
    issues.push({
      level: 'error',
      field: 'summary',
      message: '缺少 summary（发布必填）',
    })

  if (metaDescription && metaDescription.length > META_TEXT_MAX_LENGTH) {
    issues.push({
      level: 'error',
      field: 'meta description',
      message: `meta description 超过 ${META_TEXT_MAX_LENGTH} 个字符，当前 ${metaDescription.length}`,
    })
  }
  if (summary && summary.length > META_TEXT_MAX_LENGTH) {
    issues.push({
      level: 'error',
      field: 'summary',
      message: `summary 超过 ${META_TEXT_MAX_LENGTH} 个字符，当前 ${summary.length}`,
    })
  }

  // handle 正则与脚本一致：大写、下划线、中文都会被 Shopify 侧拒绝
  if (handle && !ARTICLE_HANDLE_PATTERN.test(handle)) {
    issues.push({
      level: 'error',
      field: 'url',
      message: `handle 只能包含小写字母、数字和连字符；当前值「${handle}」`,
    })
  }

  if (rawHandle && rawHandle.startsWith('/')) {
    issues.push({
      level: 'warning',
      field: 'url',
      message: `博客文章的 url 应为不带前导斜杠的 handle，已自动规范化为「${handle}」`,
    })
  }

  if (html) issues.push(...checkRelatedProductsPlaceholder(html))

  const resolved = resolveBlogName(html, channel)
  if (resolved.source === 'none') {
    issues.push({
      level: 'error',
      field: 'html代码',
      message:
        '无法确定博客归属：正文缺少 zima-*-article class，且当前栏目没有默认 Blog',
    })
  } else if (resolved.source === 'channel') {
    issues.push({
      level: 'warning',
      field: 'html代码',
      message: `正文未带 zima-*-article class，已按当前栏目默认博客「${resolved.blogName}」发布`,
    })
  }
  if (resolved.blogName && channel?.blogName && resolved.blogName !== channel.blogName) {
    issues.push({
      level: 'warning',
      field: 'html代码',
      message: `正文 class 指向「${resolved.blogName}」，与当前栏目「${channel.blogName}」不一致，将以正文 class 为准`,
    })
  }

  const author = pick(raw, 'author', '作者')
  if (!author) {
    issues.push({
      level: 'warning',
      field: 'author',
      message: '未指定作者，将使用全局设置里的默认作者',
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

  const title = pick(raw, 'title', 'page_title', 'page title', 'blog title') ?? ''
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
    issues.push({ level: 'error', field: 'title', message: '缺少页面标题' })
  }
  if (!bareHandle) {
    issues.push({
      level: 'error',
      field: 'url',
      message: '缺少页面路径（url）',
    })
  } else if (!ARTICLE_HANDLE_PATTERN.test(bareHandle)) {
    issues.push({
      level: 'error',
      field: 'url',
      message: `路径 handle 只能包含小写字母、数字和连字符；当前值「${bareHandle}」`,
    })
  }
  if (!html) {
    issues.push({ level: 'error', field: 'html', message: '缺少页面正文 HTML' })
  }
  if (!metaTitle) {
    issues.push({
      level: 'error',
      field: 'meta title',
      message: '缺少 meta title（发布必填）',
    })
  }
  if (!metaDescription) {
    issues.push({
      level: 'error',
      field: 'td / meta description',
      message: '缺少 meta description（发布必填）',
    })
  }

  // 只填了裸 handle 时给出提示（路径会被推断成 /pages/<handle>）
  if (rawUrl && !rawUrl.startsWith('/') && !/^https?:\/\//i.test(rawUrl)) {
    issues.push({
      level: 'warning',
      field: 'url',
      message: `url 不是完整路径，已按裸 handle 推断为「${handle}」`,
    })
  }

  // ---- 模板必须与栏目一致（脚本是硬错误） ----
  if (!template) {
    issues.push({
      level: 'error',
      field: 'template',
      message: expectedTemplate
        ? `缺少 template，该栏目要求「${expectedTemplate}」`
        : '缺少 template，且该栏目未登记模板规格',
    })
  } else if (expectedTemplate && template !== expectedTemplate) {
    issues.push({
      level: 'error',
      field: 'template',
      message: `template 必须是「${expectedTemplate}」，当前为「${template}」`,
    })
  }

  // ---- meta 长度规则按栏目不同 ----
  // Discord 脚本要求 meta_title ≤ 65、meta description 在 120~170；
  // 社区脚本没有这两条规则，所以只在 spec 声明时才检查。
  if (spec?.metaTitleMax && metaTitle.length > spec.metaTitleMax) {
    issues.push({
      level: 'error',
      field: 'meta title',
      message: `meta title 应在 ${spec.metaTitleMax} 个字符以内；当前 ${metaTitle.length}`,
    })
  }
  if (spec?.metaDescriptionMin || spec?.metaDescriptionMax) {
    const length = metaDescription.length
    const tooShort =
      Boolean(spec.metaDescriptionMin) && length < (spec.metaDescriptionMin ?? 0)
    const tooLong =
      Boolean(spec.metaDescriptionMax) && length > (spec.metaDescriptionMax ?? 0)
    if (tooShort || tooLong) {
      issues.push({
        level: 'error',
        field: 'td / meta description',
        message: `meta description 应在 ${spec.metaDescriptionMin}~${spec.metaDescriptionMax} 字符之间；当前 ${length}`,
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
        message: `summary 应至少 ${spec.summaryMin} 个字符；当前 ${summaryValue.length}`,
      })
    }
  }

  // ---- 正文硬规则：禁 h1 / 至少 h2Min 个 h2 / img alt+title / a title ----
  issues.push(...checkPageHtmlRules(html, spec?.h2Min ?? 1))

  // 正文必须逐字包含的固定文案（用户故事要求两句固定段落）
  for (const required of spec?.bodyMustContain ?? []) {
    if (!html.includes(required)) {
      issues.push({
        level: 'error',
        field: 'html',
        message: `正文必须包含「${required}」`,
      })
    }
  }

  // ---- 来源对象（custom.<sourceKey> json metafield） ----
  const rawSource = channel?.pageSpec?.sourceKey
    ? raw[channel.pageSpec.sourceKey]
    : undefined
  // 归一化（剥掉 Discord channel_name 的前导 '#'）后再提交给后端
  const source = normalizePageSource(rawSource, spec)

  if (spec?.verified) {
    issues.push(...checkPageSource(source, spec))
  } else if (channel?.pageSpec?.sourceKey && !source) {
    issues.push({
      level: 'warning',
      field: channel.pageSpec.sourceKey,
      message: `缺少 ${channel.pageSpec.sourceKey} 来源信息；该栏目规格尚未核对，此处只做提示`,
    })
  }

  // 可选反链：页面发布后往某篇博客文章追加幂等上下文反链
  const rawBacklink = pickRaw(raw, 'backlink')
  const backlink =
    rawBacklink && typeof rawBacklink === 'object' && !Array.isArray(rawBacklink)
      ? (rawBacklink as Record<string, unknown>)
      : undefined

  // 页面 schema 里 published 字段（脚本会解析，但不参与请求构造）
  const published = pickRaw(raw, 'published')
  if (published === false) {
    issues.push({
      level: 'warning',
      field: 'published',
      message:
        'JSON 中 published=false；实际是否上线由你在发布时选择的「发布方式」决定',
    })
  }

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
      error: `JSON 语法错误：${(error as Error).message}`,
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
        const channelId =
          byClass?.id ??
          fallbackChannelId ??
          CHANNELS.find((c) => c.contentType === 'blog_article')?.id ??
          'tech-ai-hub'
        const channel = CHANNELS.find((c) => c.id === channelId)
        candidates.push(
          normalizeBlogCandidate(item, filePath, index, channelId, channel)
        )
      } catch (error) {
        candidates.push(
          errorCandidate(filePath, index, fallbackChannelId, (error as Error).message)
        )
      }
    })

    return { fileName, filePath, detected: 'blog_article', candidates }
  }

  // --- B. 页面单对象 ---
  if (looksLikePage(data)) {
    const record = data as RawRecord
    const byTemplate = matchPageChannel(record)
    const channelId =
      byTemplate?.id ??
      fallbackChannelId ??
      CHANNELS.find((c) => c.contentType === 'page')?.id ??
      'community-post'
    const channel = CHANNELS.find((c) => c.id === channelId)
    try {
      return {
        fileName,
        filePath,
        detected: 'page',
        candidates: [
          normalizePageCandidate(record, filePath, 0, channelId, channel),
        ],
      }
    } catch (error) {
      return {
        fileName,
        filePath,
        detected: 'page',
        candidates: [],
        error: `解析失败：${(error as Error).message}`,
      }
    }
  }

  // --- C. 无法识别 ---
  return {
    fileName,
    filePath,
    detected: 'unknown',
    candidates: [],
    error:
      '无法识别的 JSON 结构。期望：博客文章为数组（含 blog title / url / html代码），页面为单对象（含 url 与 template）。',
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
    title: `(第 ${index + 1} 条解析失败)`,
    handle: '',
    bodyHtml: '',
    sourceFile: filePath,
    sourceIndex: index,
    publishKey: `${id}|${basename(filePath)}|${index}|`,
    issues: [{ level: 'error', message: `解析失败：${message}` }],
    publishable: false,
  }
}
