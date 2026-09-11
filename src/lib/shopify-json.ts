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

import { CHANNELS, type Channel } from '@/config/channels'
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
    if (channel.sourceKey && record[channel.sourceKey] !== undefined) {
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

  if (!metaTitle)
    issues.push({
      level: 'warning',
      field: 'meta title',
      message: '缺少 meta title，将回退使用文章标题',
    })
  if (!metaDescription)
    issues.push({
      level: 'warning',
      field: 'meta description',
      message: '缺少 meta description，会影响搜索摘要展示',
    })
  if (!summary)
    issues.push({
      level: 'warning',
      field: 'summary',
      message: '缺少 summary，Shopify 列表页将无摘要',
    })

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

  const title = pick(raw, 'title', 'blog title') ?? ''
  const html = pick(raw, 'html', 'html代码', 'body_html') ?? ''
  const rawUrl = pick(raw, 'url', 'handle') ?? ''
  const handle = normalizePageHandle(rawUrl)
  const template = pick(raw, 'template', 'template_suffix')

  if (!title) issues.push({ level: 'error', field: 'title', message: '缺少页面标题' })
  if (!handle)
    issues.push({
      level: 'error',
      field: 'url',
      message: '缺少页面路径（url）',
    })
  if (!html)
    issues.push({ level: 'error', field: 'html', message: '缺少页面正文 HTML' })

  if (!template) {
    issues.push({
      level: 'warning',
      field: 'template',
      message: channel?.template
        ? `JSON 未提供 template，将使用栏目默认模板「${channel.template}」`
        : 'JSON 未提供 template，页面将使用主题默认模板',
    })
  } else if (channel?.template && template !== channel.template) {
    issues.push({
      level: 'warning',
      field: 'template',
      message: `JSON 模板「${template}」与栏目默认模板「${channel.template}」不同，将以 JSON 为准`,
    })
  }

  if (rawUrl && !rawUrl.startsWith('/')) {
    issues.push({
      level: 'warning',
      field: 'url',
      message: `页面 url 应为完整路径，已自动补全为「${handle}」`,
    })
  }
  // 页面通常挂在 /pages/ 下；不在该前缀时提醒用户确认，但不擅自改写
  if (handle && !handle.startsWith('/pages/')) {
    issues.push({
      level: 'warning',
      field: 'url',
      message: `路径「${handle}」不在 /pages/ 下，请确认这是期望的发布路径，否则请在 JSON 中填写完整的 /pages/xxx`,
    })
  }

  // 页面 schema 里 published 字段：true 表示上线，false 表示保持草稿
  const published = pickRaw(raw, 'published')
  if (published === false) {
    issues.push({
      level: 'warning',
      field: 'published',
      message: 'JSON 中 published=false，该页面将作为未发布状态创建',
    })
  }

  // 来源信息是否随 JSON 一起提交（用于页面模板渲染）
  if (channel?.sourceKey && raw[channel.sourceKey] === undefined) {
    issues.push({
      level: 'warning',
      field: channel.sourceKey,
      message: `缺少 ${channel.sourceKey} 来源信息，页面模板可能渲染不出引用来源`,
    })
  }

  const imageCount = Array.isArray(raw['images']) ? raw['images'].length : 0
  if (imageCount === 0) {
    issues.push({
      level: 'warning',
      field: 'images',
      message: 'images 为空，页面可能缺少配图',
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
    summary: pick(raw, 'summary', 'meta description'),
    metaTitle: pick(raw, 'meta title', 'meta_title', 'title'),
    metaDescription: pick(raw, 'meta description', 'meta_description'),
    author: pick(raw, 'author'),
    relatedProducts: toStringArray(
      pickRaw(raw, 'related_products', 'related products')
    ),
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
